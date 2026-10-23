/**
 * adminAlerts.ts — one cheap, pollable payload that tells the admin dashboard what needs attention.
 *
 * Powers alert badges and animations: every queue reports how many items are waiting, how many
 * arrived since the caller last looked (`newSince` → pulse/animate), how long the oldest has been
 * waiting (`overdue` → escalate), plus a merged recent-activity feed and a few "watch" items that
 * are about to become tasks (store rentals / subscriptions about to lapse).
 *
 * Each queue is a single indexed COUNT/MIN query; table, column and predicate fragments are
 * compile-time constants (never user input) and `since` is a bound parameter.
 */
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from './prisma';
import { STORE_OWNER_PACKAGE_NAME } from './subscriptionService';

export const OVERDUE_AFTER_HOURS = 24;

export type Severity = 'none' | 'info' | 'warning' | 'critical';

export interface QueueDef {
  key: string;
  label: string;
  /** Frontend admin route that resolves this queue. */
  href: string;
  /** Raw SQL fragments — constants defined in this file. */
  table: string;
  where: string;
  time: string;
}

export const QUEUES: QueueDef[] = [
  { key: 'listings',      label: 'Listings awaiting approval',  href: '/admin/listings',       table: '"Listing"',            where: `"status" = 'PENDING'`,          time: '"createdAt"' },
  { key: 'images',        label: 'Images awaiting review',      href: '/admin/images',         table: '"ProductImage"',       where: `"status" = 'PENDING'`,          time: '"uploadedAt"' },
  { key: 'kyc',           label: 'ID verifications to review',  href: '/admin/kyc',            table: '"User"',               where: `"kycStatus" = 'PENDING'`,       time: 'COALESCE("kycSubmittedAt", "createdAt")' },
  { key: 'storeRentals',  label: 'Store applications',          href: '/admin/store-rentals',  table: '"StoreRental"',        where: `"status" = 'PENDING'`,          time: '"createdAt"' },
  { key: 'renewals',      label: 'Store renewals to confirm',   href: '/admin/store-rentals',  table: '"StoreRental"',        where: `jsonb_typeof("placements" -> 'pendingRenewal') = 'object'`, time: '"updatedAt"' },
  { key: 'subscriptions', label: 'Payments to confirm',         href: '/admin/subscriptions',  table: '"SellerSubscription"', where: `"status" = 'PENDING_PAYMENT'`,  time: '"createdAt"' },
  { key: 'reports',       label: 'Open reports',                href: '/admin/reports',        table: '"Report"',             where: `"status" = 'OPEN'`,             time: '"createdAt"' },
  { key: 'reviews',       label: 'Reviews awaiting moderation', href: '/admin/reviews',        table: '"ProductReview"',      where: `"status" = 'PENDING'`,          time: '"createdAt"' },
  { key: 'support',       label: 'Support requests',            href: '/admin/support-requests', table: '"SupportRequest"',   where: `"status" = 'OPEN'`,             time: '"createdAt"' },
];

export interface QueueAlert {
  key: string;
  label: string;
  href: string;
  count: number;
  /** Items that arrived after the caller's `since` (0 when no `since` was given). */
  newSince: number;
  oldestAt: string | null;
  /** The oldest item has waited longer than OVERDUE_AFTER_HOURS. */
  overdue: boolean;
  severity: Severity;
  /** Convenience for the UI: animate this badge. */
  pulse: boolean;
}

/** Pure: how loudly should a queue shout? */
export function severityFor(count: number, oldestAt: Date | null, now: Date): Severity {
  if (count <= 0) return 'none';
  if (oldestAt && now.getTime() - oldestAt.getTime() > OVERDUE_AFTER_HOURS * 3_600_000) return 'critical';
  return count >= 10 ? 'warning' : 'info';
}

export function toQueueAlert(
  def: Pick<QueueDef, 'key' | 'label' | 'href'>,
  row: { count: number; newSince: number; oldest: Date | null },
  now: Date,
): QueueAlert {
  const overdue = !!row.oldest && row.count > 0 && now.getTime() - row.oldest.getTime() > OVERDUE_AFTER_HOURS * 3_600_000;
  return {
    key: def.key, label: def.label, href: def.href,
    count: row.count,
    newSince: row.newSince,
    oldestAt: row.count > 0 && row.oldest ? row.oldest.toISOString() : null,
    overdue,
    severity: severityFor(row.count, row.oldest, now),
    pulse: row.newSince > 0,
  };
}

/** Pure: parse the optional `since` query value; invalid/future/absurdly old values are ignored. */
export function parseSince(raw: unknown, now: Date): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 60_000) return null;
  if (now.getTime() - d.getTime() > 31 * 24 * 3_600_000) return new Date(now.getTime() - 31 * 24 * 3_600_000);
  return d;
}

async function queueRow(def: QueueDef, since: Date | null): Promise<{ count: number; newSince: number; oldest: Date | null }> {
  const table = Prisma.raw(def.table);
  const where = Prisma.raw(def.where);
  const time = Prisma.raw(def.time);
  const newSince = since ? Prisma.sql`COUNT(*) FILTER (WHERE ${time} > ${since})::int` : Prisma.sql`0::int`;
  const rows = await prisma.$queryRaw<Array<{ count: number; newSince: number; oldest: Date | null }>>(Prisma.sql`
    SELECT COUNT(*)::int AS "count", ${newSince} AS "newSince", MIN(${time}) AS "oldest"
    FROM ${table} WHERE ${where}`);
  return rows[0] ?? { count: 0, newSince: 0, oldest: null };
}

export interface ActivityItem { type: string; id: string; title: string; at: string; href: string; isNew: boolean }

async function recentActivity(since: Date | null, limit: number): Promise<ActivityItem[]> {
  const take = Math.min(limit, 10);
  const [users, listings, reports, rentals, kyc, subs, support] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
    prisma.listing.findMany({ select: { id: true, title: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
    prisma.report.findMany({ select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
    prisma.storeRental.findMany({ select: { id: true, status: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take }),
    prisma.user.findMany({ where: { kycSubmittedAt: { not: null } }, select: { id: true, name: true, kycSubmittedAt: true }, orderBy: { kycSubmittedAt: 'desc' }, take }),
    prisma.sellerSubscription.findMany({ select: { id: true, status: true, createdAt: true, user: { select: { name: true } }, package: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take }),
    prisma.supportRequest.findMany({ select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take }),
  ]);
  const item = (type: string, id: string, title: string, at: Date, href: string): ActivityItem => ({
    type, id, title, at: at.toISOString(), href, isNew: !!since && at.getTime() > since.getTime(),
  });
  const all: ActivityItem[] = [
    ...users.map((u) => item('user', u.id, `${u.name || 'New user'} registered`, u.createdAt, '/admin/users')),
    ...listings.map((l) => item('listing', l.id, `Listing "${l.title}" (${l.status.toLowerCase()})`, l.createdAt, '/admin/listings')),
    ...reports.map((r) => item('report', r.id, 'A listing was reported', r.createdAt, '/admin/reports')),
    ...rentals.map((r) => item('storeRental', r.id, `${r.user.name || 'A user'} requested a store (${r.status.toLowerCase()})`, r.createdAt, '/admin/store-rentals')),
    ...kyc.map((k) => item('kyc', k.id, `${k.name || 'A user'} submitted ID verification`, k.kycSubmittedAt as Date, '/admin/kyc')),
    ...subs.map((s) => item('subscription', s.id, `${s.user.name || 'A user'} — ${s.package.name} (${s.status.toLowerCase().replace('_', ' ')})`, s.createdAt, '/admin/subscriptions')),
    ...support.map((s) => item('support', s.id, 'New support request', s.createdAt, '/admin/support-requests')),
  ];
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface AdminAlerts {
  serverTime: string;
  since: string | null;
  totals: { pending: number; newSince: number; overdueQueues: number; severity: Severity };
  queues: QueueAlert[];
  watch: { expiringStoreRentals7d: number; expiringSubscriptions3d: number };
  activity: ActivityItem[];
  /** Hash of everything that matters for animation — equal hash ⇒ nothing changed. Also the ETag. */
  etag: string;
}

export async function getAdminAlerts(opts: { since?: unknown; activityLimit?: number; now?: Date } = {}): Promise<AdminAlerts> {
  const now = opts.now ?? new Date();
  const since = parseSince(opts.since, now);
  const limit = Math.max(1, Math.min(opts.activityLimit ?? 15, 30));

  const [rows, activity, expiringRentals, expiringSubs] = await Promise.all([
    Promise.all(QUEUES.map((q) => queueRow(q, since))),
    recentActivity(since, limit),
    prisma.storeRental.count({ where: { status: 'ACTIVE', endDate: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) }, user: { role: { not: 'ADMIN' } } } }),
    prisma.sellerSubscription.count({ where: { status: 'ACTIVE', endDate: { gt: now, lte: new Date(now.getTime() + 3 * 86_400_000) }, package: { isFree: false, NOT: { name: STORE_OWNER_PACKAGE_NAME } } } }),
  ]);

  const queues = QUEUES.map((q, i) => toQueueAlert(q, rows[i], now));
  const order: Severity[] = ['none', 'info', 'warning', 'critical'];
  const severity = queues.reduce<Severity>((worst, q) => (order.indexOf(q.severity) > order.indexOf(worst) ? q.severity : worst), 'none');
  const totals = {
    pending: queues.reduce((n, q) => n + q.count, 0),
    newSince: queues.reduce((n, q) => n + q.newSince, 0),
    overdueQueues: queues.filter((q) => q.overdue).length,
    severity,
  };
  const stable = { c: queues.map((q) => [q.key, q.count, q.newSince, q.overdue]), a: activity.map((a) => a.id), w: [expiringRentals, expiringSubs] };
  const etag = '"' + createHash('sha1').update(JSON.stringify(stable)).digest('hex').slice(0, 16) + '"';

  return {
    serverTime: now.toISOString(),
    since: since ? since.toISOString() : null,
    totals, queues,
    watch: { expiringStoreRentals7d: expiringRentals, expiringSubscriptions3d: expiringSubs },
    activity, etag,
  };
}
