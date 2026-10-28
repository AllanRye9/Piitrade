/**
 * listingAlerts.ts — instant listing alerts.
 *
 * A user's alert is a SavedSearch with `emailAlert` (the master switch) on: category, price range,
 * keyword, location, condition, photos, verified sellers. When a listing goes live (or its price
 * changes while live) the worker (alertWorker.ts) calls `dispatchListingAlerts(listingId)`, which:
 *
 *   1. loads the listing and finds candidate alerts (pre-filtered by category in SQL),
 *   2. applies each alert's criteria (cheap checks in memory; a keyword needs one indexed DB check),
 *   3. keeps ONE alert per user per listing (the one with the most channels on),
 *   4. for each, atomically records the delivery (unique per listing + user — the exactly-once
 *      guard that makes racing instances, retries and later price edits safe) and creates the
 *      profile notification,
 *   5. after commit, pushes it to the user's open browser tabs (sound flag included) and queues
 *      the e-mail (verified addresses only, capped per user per day).
 *
 * Price rules are in UGX: a listing quoted in another currency never matches an alert that has a
 * price bound (no exchange rates are applied), but still matches alerts without one.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { parseSearchQuery, hasSearchTerms, buildSearchWhere } from './search';
import { sanitizeParams, hasAnyFilter, type SavedSearchParams } from './savedSearches';
import { publishAlertEvent, type AlertEvent } from './alertHub';
import { sendListingAlertEmail } from './email';

export const MAX_ALERT_EMAILS_PER_USER_PER_DAY = 20;
export const MAX_CANDIDATE_ALERTS = 5_000;
const EMAIL_CONCURRENCY = 3;

/** The slice of a Listing the rules need. */
export interface AlertListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  priceUnit: string;
  location: string;
  condition: string | null;
  images: string[];
  userId: string;
  status: string;
  expiresAt: Date | null;
  category: { slug: string; parent: { slug: string } | null };
  user: { isKycVerified: boolean };
}

/** Everything except a keyword (which needs the database). Pure, so it is easy to test. */
export function matchesCheapCriteria(listing: AlertListing, p: SavedSearchParams): boolean {
  if (p.category && p.category !== listing.category.slug && p.category !== listing.category.parent?.slug) return false;
  if (p.location && !listing.location.toLowerCase().includes(p.location.toLowerCase())) return false;
  if (p.condition && listing.condition !== p.condition) return false;
  if (p.verifiedOnly && !listing.user.isKycVerified) return false;
  if (p.withPhotos && listing.images.length === 0) return false;
  if (p.priceMin || p.priceMax) {
    if (listing.currency !== 'UGX') return false;
    if (p.priceMin && listing.price < parseFloat(p.priceMin)) return false;
    if (p.priceMax && listing.price > parseFloat(p.priceMax)) return false;
  }
  return true;
}

export function isLive(listing: Pick<AlertListing, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return listing.status === 'ACTIVE' && (!listing.expiresAt || listing.expiresAt > now);
}

export function formatAlertPrice(price: number, currency: string, priceUnit: string): string {
  const unit = priceUnit === 'KG' ? ' per kg' : priceUnit === 'TONNE' ? ' per tonne' : '';
  return `${currency} ${Math.round(price).toLocaleString('en-UG')}${unit}`;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function keywordMatches(listingId: string, q: string, cache: Map<string, boolean>): Promise<boolean> {
  const hit = cache.get(q);
  if (hit !== undefined) return hit;
  const parsed = parseSearchQuery(q);
  const ok = !hasSearchTerms(parsed)
    ? true
    : (await prisma.listing.count({ where: { AND: [{ id: listingId }, buildSearchWhere(parsed)] } })) > 0;
  cache.set(q, ok);
  return ok;
}

type Candidate = Prisma.SavedSearchGetPayload<{
  include: { user: { select: { id: true; email: true; name: true; isVerified: true; isBanned: true } } };
}>;

export interface DispatchResult {
  listingId: string;
  evaluated: number;
  delivered: number;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Evaluate every alert against one listing and deliver the matches. Safe to call repeatedly. */
export async function dispatchListingAlerts(listingId: string, now = new Date()): Promise<DispatchResult> {
  const result: DispatchResult = { listingId, evaluated: 0, delivered: 0 };
  const row = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true, title: true, price: true, currency: true, priceUnit: true, location: true, condition: true,
      images: true, userId: true, status: true, expiresAt: true,
      category: { select: { slug: true, parent: { select: { slug: true } } } },
      user: { select: { isKycVerified: true } },
    },
  });
  if (!row) return result;
  const listing = row as unknown as AlertListing;
  if (!isLive(listing, now)) return result;

  const slugs = [listing.category.slug, listing.category.parent?.slug].filter((s): s is string => !!s);
  const candidates: Candidate[] = await prisma.savedSearch.findMany({
    where: {
      emailAlert: true,
      userId: { not: listing.userId }, // never alert a seller about their own listing
      user: { isBanned: false },
      OR: [{ categorySlug: null }, { categorySlug: { in: slugs } }],
    },
    include: { user: { select: { id: true, email: true, name: true, isVerified: true, isBanned: true } } },
    orderBy: { createdAt: 'asc' },
    take: MAX_CANDIDATE_ALERTS,
  });
  if (candidates.length >= MAX_CANDIDATE_ALERTS) logger.warn(`Alert candidates hit the cap (${MAX_CANDIDATE_ALERTS}) for listing ${listingId}`);

  // The alert with the most channels on wins when one user has several matching alerts.
  const channels = (c: Candidate) => Number(c.notifyEmail) + Number(c.notifySound);
  candidates.sort((a, b) => channels(b) - channels(a));

  const kwCache = new Map<string, boolean>();
  const winners = new Map<string, { alert: Candidate }>();
  for (const alert of candidates) {
    if (winners.has(alert.userId)) continue;
    result.evaluated += 1;
    const params = sanitizeParams(alert.filters);
    if (!hasAnyFilter(params) || !matchesCheapCriteria(listing, params)) continue;
    if (params.q && !(await keywordMatches(listing.id, params.q, kwCache))) continue;
    winners.set(alert.userId, { alert });
  }

  for (const { alert } of winners.values()) {
    try {
      if (await deliver(listing, alert, now)) result.delivered += 1;
    } catch (err) {
      logger.error(`Alert delivery failed (alert ${alert.id}, listing ${listing.id}): ${String(err)}`);
    }
  }
  return result;
}

async function deliver(listing: AlertListing, alert: Candidate, now: Date): Promise<boolean> {
  const priceText = formatAlertPrice(listing.price, listing.currency, listing.priceUnit);
  const title = `New match: ${truncate(listing.title, 80)}`;
  const message = `${priceText}${listing.location ? ` · ${truncate(listing.location, 40)}` : ''} — matches “${truncate(alert.name, 60)}”`;
  const href = `/listings/${listing.id}`;
  const image = listing.images[0] ?? null;

  let created: { notificationId: string; deliveryId: string; createdAt: Date };
  try {
    created = await prisma.$transaction(async (tx) => {
      // The unique (listingId, userId) key is the exactly-once guard: a racing instance, a retry
      // or a later price edit hits P2002 here and does nothing.
      const delivery = await tx.listingAlertDelivery.create({ data: { savedSearchId: alert.id, listingId: listing.id, userId: alert.userId } });
      const n = await tx.notification.create({
        data: {
          userId: alert.userId,
          type: 'LISTING_ALERT',
          title,
          message,
          data: { kind: 'LISTING_ALERT', alertId: alert.id, alertName: alert.name, listingId: listing.id, href, price: listing.price, currency: listing.currency, location: listing.location, image, sound: alert.notifySound },
        },
      });
      await tx.listingAlertDelivery.update({ where: { id: delivery.id }, data: { notificationId: n.id } });
      await tx.savedSearch.update({ where: { id: alert.id }, data: { lastAlertAt: now } });
      return { notificationId: n.id, deliveryId: delivery.id, createdAt: n.createdAt };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }

  const event: AlertEvent = {
    id: created.notificationId, listingId: listing.id, alertName: alert.name, title, message, href, image,
    sound: alert.notifySound, createdAt: created.createdAt.toISOString(),
  };
  await publishAlertEvent(alert.userId, event);

  if (alert.notifyEmail && alert.user.isVerified && alert.user.email) {
    queueAlertEmail({
      deliveryId: created.deliveryId, userId: alert.userId, to: alert.user.email, name: alert.user.name,
      email: { alertName: alert.name, listingTitle: listing.title, priceText, location: listing.location, listingId: listing.id },
    });
  }
  return true;
}

// ── E-mail queue (in-process, small concurrency, daily cap per user) ───────────────────────────
interface QueuedEmail { deliveryId: string; userId: string; to: string; name: string; email: Parameters<typeof sendListingAlertEmail>[2] }
const emailQueue: QueuedEmail[] = [];
let emailWorkers = 0;
let emailIdleResolvers: Array<() => void> = [];

function queueAlertEmail(item: QueuedEmail): void {
  emailQueue.push(item);
  while (emailWorkers < EMAIL_CONCURRENCY && emailQueue.length > 0) {
    emailWorkers += 1;
    void runEmailWorker();
  }
}

async function runEmailWorker(): Promise<void> {
  try {
    for (let item = emailQueue.shift(); item; item = emailQueue.shift()) {
      try {
        const since = new Date(Date.now() - 24 * 3_600_000);
        const sentToday = await prisma.listingAlertDelivery.count({ where: { userId: item.userId, emailedAt: { gte: since } } });
        if (sentToday >= MAX_ALERT_EMAILS_PER_USER_PER_DAY) continue; // still in the profile feed and the bell
        await sendListingAlertEmail(item.to, item.name, item.email);
        await prisma.listingAlertDelivery.update({ where: { id: item.deliveryId }, data: { emailedAt: new Date() } });
      } catch (err) {
        logger.error(`Alert e-mail to user ${item.userId} failed: ${String(err)}`);
      }
    }
  } finally {
    emailWorkers -= 1;
    if (emailWorkers === 0 && emailQueue.length === 0) { const r = emailIdleResolvers; emailIdleResolvers = []; r.forEach((f) => f()); }
  }
}

/** Resolves when the e-mail queue is empty (used by tests and graceful shutdown). */
export function waitForAlertEmails(): Promise<void> {
  if (emailWorkers === 0 && emailQueue.length === 0) return Promise.resolve();
  return new Promise((resolve) => { emailIdleResolvers.push(resolve); });
}
