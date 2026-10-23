/**
 * lifecycleJobs.ts — keeps stored subscription / store state in step with the calendar.
 *
 * Access decisions never wait for this (they read the dates at request time — see
 * subscriptionService.isCurrent and the rental checks), so a lapsed plan stops granting access the
 * second its end date passes. This sweep makes the *stored* flags, notifications, frozen stores and
 * reminders follow within minutes instead of the old hourly cadence. Each step is independent (one
 * failing never blocks the others) and runs are never overlapped.
 */
import { runExclusive } from './jobLock';
import { logger } from './logger';
import { expireOverdueSubscriptions, sendSubscriptionReminders } from './subscriptionService';
import { expireOverdueStoreRentals } from './storeRentalService';
import { runSavedSearchAlerts } from './savedSearches';

export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface SweepResult {
  skipped: boolean;
  subscriptionsExpired: number;
  subscriptionReminders: number;
  storesExpired: number;
  storesRepaired: number;
  savedSearchAlerts: number;
  errors: string[];
}

let running = false;

export async function runLifecycleSweep(): Promise<SweepResult> {
  const result: SweepResult = { skipped: false, subscriptionsExpired: 0, subscriptionReminders: 0, storesExpired: 0, storesRepaired: 0, savedSearchAlerts: 0, errors: [] };
  if (running) return { ...result, skipped: true };
  running = true;
  try {
    const step = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (err) {
        result.errors.push(`${name}: ${String(err)}`);
        logger.error(`Lifecycle sweep step "${name}" failed`, err);
      }
    };
    await step('subscriptions.expire', async () => { result.subscriptionsExpired = await expireOverdueSubscriptions(); });
    await step('subscriptions.remind', async () => { result.subscriptionReminders = await sendSubscriptionReminders(); });
    await step('stores.expire', async () => {
      const r = await expireOverdueStoreRentals();
      result.storesExpired = r.expired;
      result.storesRepaired = r.repaired;
    });
    await step('savedSearches.alert', async () => { result.savedSearchAlerts = await runSavedSearchAlerts(); });
    if (result.savedSearchAlerts || result.subscriptionsExpired || result.subscriptionReminders || result.storesExpired || result.storesRepaired) {
      logger.info(`Lifecycle sweep: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    running = false;
  }
}

export function startLifecycleJobs(intervalMs = SWEEP_INTERVAL_MS): NodeJS.Timeout {
  // Only one instance sweeps at a time (utils/jobLock.ts), so reminders are not sent once per instance.
  const sweep = () => runExclusive('lifecycle-sweep', runLifecycleSweep).catch((err) => logger.error('Lifecycle sweep failed', err));
  sweep();
  const handle = setInterval(sweep, intervalMs);
  handle.unref?.();
  return handle;
}
