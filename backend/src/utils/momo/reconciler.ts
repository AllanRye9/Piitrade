/**
 * momo/reconciler.ts — safety net for MoMo payments. Runs every 30s on every instance.
 *
 * Real-time confirmation normally comes from MTN's callback and from the payer's own status
 * polling; this job guarantees that nothing is ever left half-done when those don't happen
 * (callback never arrives, browser closed, server restarted mid-payment, provisioning crashed):
 *
 *  1. PENDING payments that are due for a check (quick at first, then every minute) are verified.
 *  2. EXPIRED payments (given up locally) keep being re-checked for 24h, so a very late approval
 *     is still honoured instead of silently swallowing the money.
 *  3. SUCCESSFUL payments whose access was not granted are retried; after 30 minutes of failing
 *     they are escalated to admins (NEEDS_REVIEW).
 *  4. Abandoned MoMo-originated subscription requests are cancelled after 24h so they stop
 *     blocking the user's next attempt. Requests that arrived via the manual flow are never touched.
 *
 * Subscription/store EXPIRY and downgrades are NOT here — they stay in utils/lifecycleJobs.ts.
 * Everything is multi-instance safe: verification is idempotent and uses conditional updates/leases.
 */
import { runExclusive } from '../jobLock';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { canSettleMomo } from './config';
import { isDueForCheck, EXPIRED_RECHECK_MS, LATE_SUCCESS_WINDOW_MS } from './rules';
import { verifyPayment, notifyAdmins, PROVISION_ESCALATE_MS } from './paymentService';
import { retryPendingReceipts } from './receipt';

export const RECONCILE_INTERVAL_MS = 30_000;
const BATCH = 100;
const CONCURRENCY = 5;
/** A MoMo-originated pending subscription with no payment activity for this long is cancelled. */
export const STALE_SUBSCRIPTION_MS = 24 * 60 * 60 * 1000;

export interface ReconcileResult {
  skipped: boolean;
  checked: number;
  provisioningRetried: number;
  escalated: number;
  staleSubscriptionsCancelled: number;
  errors: string[];
}

let running = false;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch (err) { logger.error('MoMo reconciler: item failed', err); }
    }
  }));
}

async function cancelStaleSubscriptions(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SUBSCRIPTION_MS);
  const subs = await prisma.sellerSubscription.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true, userId: true, package: { select: { name: true } } },
    take: 200,
  });
  if (subs.length === 0) return 0;
  const attempts = await prisma.paymentTransaction.findMany({
    where: { purpose: { in: ['SUBSCRIPTION', 'SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_UPGRADE'] }, targetId: { in: subs.map((s) => s.id) } },
    select: { targetId: true, status: true, createdAt: true },
  });
  const byTarget = new Map<string, typeof attempts>();
  for (const a of attempts) byTarget.set(a.targetId, [...(byTarget.get(a.targetId) ?? []), a]);

  let cancelled = 0;
  for (const sub of subs) {
    const mine = byTarget.get(sub.id);
    if (!mine || mine.length === 0) continue; // manual-flow request: an admin confirms it — never ours to cancel
    const inFlightOrPaid = mine.some((a) => a.status === 'PENDING' || a.status === 'SUCCESSFUL' || a.status === 'NEEDS_REVIEW');
    const recent = mine.some((a) => a.createdAt.getTime() > cutoff.getTime());
    if (inFlightOrPaid || recent) continue;
    const res = await prisma.sellerSubscription.updateMany({ where: { id: sub.id, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED', cancelledAt: now } });
    if (res.count === 1) {
      cancelled++;
      await prisma.notification.create({
        data: {
          userId: sub.userId, type: 'SUBSCRIPTION_EXPIRED', title: 'Subscription request cancelled',
          message: `Your "${sub.package.name}" subscription request was cancelled because the mobile money payment was not completed. You can start again at any time.`,
          data: { subscriptionId: sub.id },
        },
      }).catch((err) => logger.error('MoMo reconciler: notification failed', err));
    }
  }
  return cancelled;
}

export async function runPaymentReconciler(now: Date = new Date()): Promise<ReconcileResult> {
  const result: ReconcileResult = { skipped: false, checked: 0, provisioningRetried: 0, escalated: 0, staleSubscriptionsCancelled: 0, errors: [] };
  if (running || !canSettleMomo()) return { ...result, skipped: true };
  running = true;
  try {
    const step = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (err) {
        result.errors.push(`${name}: ${String(err)}`);
        logger.error(`MoMo reconciler step "${name}" failed`, err);
      }
    };

    await step('pending', async () => {
      const rows = await prisma.paymentTransaction.findMany({ where: { status: 'PENDING' }, orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }], take: BATCH });
      const due = rows.filter((r) => isDueForCheck(r, now));
      await mapLimit(due, CONCURRENCY, async (r) => { await verifyPayment(r.id, now); result.checked++; });
    });

    await step('late-success', async () => {
      const windowStart = new Date(now.getTime() - LATE_SUCCESS_WINDOW_MS);
      const staleBefore = new Date(now.getTime() - EXPIRED_RECHECK_MS);
      const rows = await prisma.paymentTransaction.findMany({
        where: { status: 'EXPIRED', createdAt: { gt: windowStart }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: staleBefore } }] },
        orderBy: { createdAt: 'desc' }, take: BATCH,
      });
      await mapLimit(rows, CONCURRENCY, async (r) => { await verifyPayment(r.id, now); result.checked++; });
    });

    await step('unprovisioned', async () => {
      const rows = await prisma.paymentTransaction.findMany({ where: { status: 'SUCCESSFUL', provisionedAt: null }, orderBy: { updatedAt: 'asc' }, take: BATCH });
      await mapLimit(rows, CONCURRENCY, async (r) => {
        const since = r.lastCheckedAt ?? r.updatedAt;
        if (now.getTime() - since.getTime() > PROVISION_ESCALATE_MS) {
          const res = await prisma.paymentTransaction.updateMany({
            where: { id: r.id, status: 'SUCCESSFUL', provisionedAt: null },
            data: { status: 'NEEDS_REVIEW', provisionNote: `Access could not be granted automatically after repeated attempts: ${r.provisionNote ?? 'no details'}`.slice(0, 500) },
          });
          if (res.count === 1) {
            result.escalated++;
            logger.error(`MoMo reconciler: payment ${r.id} escalated — provisioning kept failing`);
            await notifyAdmins('Payment needs review', `A mobile money payment was received but access could not be granted automatically. Reference ${r.referenceId}.`, { paymentId: r.id });
          }
          return;
        }
        await verifyPayment(r.id, now); // retries provisioning once the previous lease has lapsed
        result.provisioningRetried++;
      });
    });

    await step('receipts', async () => { await retryPendingReceipts(); });

    await step('stale-subscriptions', async () => { result.staleSubscriptionsCancelled = await cancelStaleSubscriptions(now); });

    if (result.checked || result.escalated || result.staleSubscriptionsCancelled || result.errors.length) {
      logger.info(`MoMo reconciler: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    running = false;
  }
}

export function startPaymentReconciler(intervalMs = RECONCILE_INTERVAL_MS): NodeJS.Timeout {
  const tick = () => runExclusive('payment-reconciler', runPaymentReconciler, 5 * 60 * 1000).catch((err) => logger.error('Payment reconciler failed', err));
  setTimeout(tick, 5_000).unref?.(); // first pass shortly after boot, not during startup
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return handle;
}
