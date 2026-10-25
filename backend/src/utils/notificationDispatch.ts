/**
 * notificationDispatch.ts — turns in-app Notification rows into Web Push and WhatsApp messages.
 *
 * Two entry points share one code path:
 *   • dispatchNotificationById(): called right after a notification is created (new chat message,
 *     price-offer events) so delivery is immediate.
 *   • runNotificationDispatchSweep(): a 15-second background sweep that picks up recent notifications
 *     created anywhere else in the app (listing approvals, KYC, subscriptions, saved-search alerts…)
 *     without every call site having to know about push or WhatsApp.
 *
 * Exactly-once: before sending on a channel, a NotificationDelivery row is claimed with a unique
 * (notificationId, channel) key. Whoever inserts it first sends; everyone else (another instance, the
 * sweep racing the immediate dispatch) gets a unique-violation and skips. A crash between claim and
 * send therefore loses one alert rather than duplicating it, which is the right trade for alerts.
 */
import type { Notification } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { runExclusive } from './jobLock';
import { isPushConfigured, sendPush } from './webPush';
import { isWhatsAppConfigured, sendWhatsAppAlert } from './whatsapp';

type NotificationRow = Pick<Notification, 'id' | 'userId' | 'type' | 'title' | 'message' | 'data' | 'createdAt'>;

/** Only notifications created within this window are considered by the sweep (so a deploy never replays history). */
export const DISPATCH_WINDOW_MS = 5 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 15 * 1000;
const SWEEP_BATCH = 200;
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** WhatsApp messages cost money, so only events a user would act on promptly go there. */
export const WHATSAPP_TYPES: ReadonlySet<string> = new Set([
  'MESSAGE_RECEIVED', 'OFFER_RECEIVED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'OFFER_COUNTERED',
  'LISTING_APPROVED', 'LISTING_REJECTED',
]);
export const WHATSAPP_DAILY_CAP = 20;
export const WHATSAPP_MESSAGE_GAP_MS = 30 * 60 * 1000;
/** Someone active on the site in the last couple of minutes sees the alert in-app already. */
export const WHATSAPP_ONLINE_WINDOW_MS = 2 * 60 * 1000;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Site-relative page a notification should open. Never returns an external or protocol-relative URL. */
export function notificationUrl(type: string, data: unknown): string {
  const d = asRecord(data);
  const href = str(d.href);
  if (href && href.startsWith('/') && !href.startsWith('//')) return href;
  if (type === 'MESSAGE_RECEIVED') {
    const sender = str(d.senderId);
    if (!sender) return '/messages';
    return `/messages?with=${encodeURIComponent(sender)}&listing=${encodeURIComponent(str(d.listingId) ?? 'none')}`;
  }
  return '/notifications';
}

export function absoluteUrl(path: string): string {
  const base = (process.env.FRONTEND_URL?.trim() || 'https://piitrade.com').replace(/\/+$/, '');
  return `${base}${path}`;
}

/** Same tag => the device replaces the earlier notification instead of stacking (one per chat partner / offer). */
export function notificationTag(n: Pick<NotificationRow, 'id' | 'type' | 'data'>): string {
  const d = asRecord(n.data);
  if (n.type === 'MESSAGE_RECEIVED' && str(d.senderId)) return `msg-${str(d.senderId)}`;
  if (n.type.startsWith('OFFER_') && str(d.offerId)) return `offer-${str(d.offerId)}`;
  return n.id;
}

export interface WhatsAppDecisionInput {
  type: string;
  notifyMessages: boolean;
  verified: boolean;
  lastActiveAt: Date | null;
  now: Date;
  sentLast24h: number;
  lastMessageAlertAt: Date | null;
}

export type Decision = { send: true } | { send: false; reason: string };

/** Pure policy for whether this user should get this notification on WhatsApp right now. */
export function decideWhatsApp(i: WhatsAppDecisionInput): Decision {
  if (!WHATSAPP_TYPES.has(i.type)) return { send: false, reason: 'type-not-eligible' };
  if (!i.verified) return { send: false, reason: 'number-not-verified' };
  if (i.type === 'MESSAGE_RECEIVED' && !i.notifyMessages) return { send: false, reason: 'messages-muted' };
  if (i.lastActiveAt && i.now.getTime() - i.lastActiveAt.getTime() < WHATSAPP_ONLINE_WINDOW_MS) return { send: false, reason: 'user-online' };
  if (i.sentLast24h >= WHATSAPP_DAILY_CAP) return { send: false, reason: 'daily-cap' };
  if (i.type === 'MESSAGE_RECEIVED' && i.lastMessageAlertAt && i.now.getTime() - i.lastMessageAlertAt.getTime() < WHATSAPP_MESSAGE_GAP_MS) {
    return { send: false, reason: 'message-gap' };
  }
  return { send: true };
}

/** Inserts the claim row; returns its id, or null when another sender already claimed this (notification, channel). */
async function claim(n: Pick<NotificationRow, 'id' | 'userId' | 'type'>, channel: 'PUSH' | 'WHATSAPP'): Promise<string | null> {
  try {
    const row = await prisma.notificationDelivery.create({
      data: { notificationId: n.id, userId: n.userId, channel, type: n.type, status: 'PENDING' },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return null;
    throw err;
  }
}

async function settle(id: string, status: 'SENT' | 'FAILED' | 'SKIPPED', detail?: string): Promise<void> {
  await prisma.notificationDelivery.update({ where: { id }, data: { status, detail: detail?.slice(0, 300) } })
    .catch((err) => logger.warn(`Could not record delivery result: ${String(err)}`));
}

async function pushChannel(n: NotificationRow): Promise<void> {
  if (!isPushConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: n.userId, createdAt: { lte: n.createdAt } }, // never replay older alerts to a newly added device
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (!subs.length) return;
  const claimId = await claim(n, 'PUSH');
  if (!claimId) return;
  const r = await sendPush(subs, { title: n.title, body: n.message, url: notificationUrl(n.type, n.data), tag: notificationTag(n) });
  await settle(claimId, r.sent > 0 ? 'SENT' : 'FAILED', `sent=${r.sent} failed=${r.failed} removed=${r.removed}`);
}

async function whatsappChannel(n: NotificationRow, prefs: { notifyMessages: boolean; whatsappNumber: string | null; whatsappVerifiedAt: Date | null } | null): Promise<void> {
  if (!isWhatsAppConfigured() || !WHATSAPP_TYPES.has(n.type)) return;
  if (!prefs?.whatsappVerifiedAt || !prefs.whatsappNumber) return;
  // Only alerts that happened after the number was verified; never replay older ones the user already saw in-app.
  if (n.createdAt < prefs.whatsappVerifiedAt) return;

  const now = new Date();
  const [user, sentLast24h, lastMessageAlert] = await Promise.all([
    prisma.user.findUnique({ where: { id: n.userId }, select: { lastActiveAt: true } }),
    prisma.notificationDelivery.count({ where: { userId: n.userId, channel: 'WHATSAPP', status: 'SENT', createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    prisma.notificationDelivery.findFirst({
      where: { userId: n.userId, channel: 'WHATSAPP', status: 'SENT', type: 'MESSAGE_RECEIVED' },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    }),
  ]);
  const decision = decideWhatsApp({
    type: n.type, notifyMessages: prefs.notifyMessages, verified: true,
    lastActiveAt: user?.lastActiveAt ?? null, now, sentLast24h, lastMessageAlertAt: lastMessageAlert?.createdAt ?? null,
  });
  // Someone who was active a moment ago is probably still looking at the site. Hold the alert (leave it
  // unclaimed) so the sweep retries it until they have been away for a couple of minutes. If they stay on
  // the site until the sweep window closes, they saw it in the app and it is simply dropped.
  if (decision.send === false && decision.reason === 'user-online') return;

  const claimId = await claim(n, 'WHATSAPP');
  if (!claimId) return;
  if (decision.send === false) return settle(claimId, 'SKIPPED', decision.reason);

  const r = await sendWhatsAppAlert(prefs.whatsappNumber, { title: n.title, message: n.message, url: absoluteUrl(notificationUrl(n.type, n.data)) });
  await settle(claimId, r.ok ? 'SENT' : 'FAILED', r.error);
}

/** Delivers one notification on every channel the user has enabled. `claimed` holds "id:CHANNEL" keys already handled. */
export async function dispatchNotification(n: NotificationRow, claimed: ReadonlySet<string> = new Set()): Promise<void> {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId: n.userId },
    select: { notifyMessages: true, whatsappNumber: true, whatsappVerifiedAt: true },
  });
  if (n.type === 'MESSAGE_RECEIVED' && prefs?.notifyMessages === false) return;

  const results = await Promise.allSettled([
    claimed.has(`${n.id}:PUSH`) ? Promise.resolve() : pushChannel(n),
    claimed.has(`${n.id}:WHATSAPP`) ? Promise.resolve() : whatsappChannel(n, prefs),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') logger.error(`Notification dispatch failed for ${n.id}`, r.reason);
  }
}

/** Fire-and-forget friendly: never rejects. */
export async function dispatchNotificationById(id: string): Promise<void> {
  try {
    const n = await prisma.notification.findUnique({
      where: { id }, select: { id: true, userId: true, type: true, title: true, message: true, data: true, createdAt: true },
    });
    if (n) await dispatchNotification(n);
  } catch (err) {
    logger.error(`Immediate notification dispatch failed for ${id}`, err);
  }
}

let lastPrune = 0;

/** One pass of the background sweep. Returns how many notifications were examined. */
export async function runNotificationDispatchSweep(now: Date = new Date()): Promise<number> {
  if (!isPushConfigured() && !isWhatsAppConfigured()) return 0;

  if (now.getTime() - lastPrune > 60 * 60 * 1000) {
    lastPrune = now.getTime();
    await prisma.notificationDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) } } })
      .catch((err) => logger.warn(`Delivery log prune failed: ${String(err)}`));
  }

  const recent = await prisma.notification.findMany({
    where: { createdAt: { gt: new Date(now.getTime() - DISPATCH_WINDOW_MS) } },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, userId: true, type: true, title: true, message: true, data: true, createdAt: true },
  });
  if (!recent.length) return 0;

  const userIds = [...new Set(recent.map((n) => n.userId))];
  const [subs, waUsers, existing] = await Promise.all([
    prisma.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true }, distinct: ['userId'] }),
    prisma.notificationPreference.findMany({ where: { userId: { in: userIds }, whatsappVerifiedAt: { not: null } }, select: { userId: true } }),
    prisma.notificationDelivery.findMany({ where: { notificationId: { in: recent.map((n) => n.id) } }, select: { notificationId: true, channel: true } }),
  ]);
  const interested = new Set([...subs.map((s) => s.userId), ...waUsers.map((p) => p.userId)]);
  const claimed = new Set(existing.map((d) => `${d.notificationId}:${d.channel}`));

  let examined = 0;
  for (const n of recent) {
    if (!interested.has(n.userId)) continue;
    examined += 1;
    await dispatchNotification(n, claimed);
  }
  return examined;
}

export function startNotificationDispatcher(intervalMs: number = SWEEP_INTERVAL_MS): NodeJS.Timeout {
  // runExclusive: with several instances only one sweeps at a time (the claim rows are the second line of defence).
  const sweep = async () => {
    // Nothing configured: do not even open a database transaction every few seconds.
    if (!isPushConfigured() && !isWhatsAppConfigured()) return;
    try {
      await runExclusive('notification-dispatch', () => runNotificationDispatchSweep());
    } catch (err) {
      logger.error('Notification dispatch sweep failed', err);
    }
  };
  const handle = setInterval(sweep, intervalMs);
  handle.unref?.();
  return handle;
}
