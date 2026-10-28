import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';
import { validateAndLogServiceConfig } from './utils/serviceConfig';
import { assertSecureSecrets } from './utils/secretsGuard';
import { expireOverdueListings, expireOverdueListingTiers } from './utils/expireListings';
import { sendStoreRenewalReminders } from './routes/storeRentals';
import { startLifecycleJobs } from './utils/lifecycleJobs';
import { startNotificationDispatcher } from './utils/notificationDispatch';
import { startAlertWorker } from './utils/alertWorker';
import { runExclusive } from './utils/jobLock';
import { startPaymentReconciler } from './utils/momo/reconciler';
import { logMomoConfigStatus } from './utils/momo/config';
import { isProductionRuntime } from './utils/runtimeEnv';

// Last-resort safety net: log and keep the process alive instead of letting
// an unhandled rejection or a stray async error (e.g. a stream 'error' event
// with no listener) crash the whole server for every in-flight request.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

const PORT = parseInt(process.env.PORT ?? '', 10) || 5000;
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
const shouldAutoMigrate =
  process.env.AUTO_MIGRATE_ON_START
    ? process.env.AUTO_MIGRATE_ON_START.toLowerCase() !== 'false'
    : isProductionRuntime();

async function main() {
  // Hard stop (even on Railway, where config errors below are only logged): never
  // serve production traffic with placeholder / short JWT or admin secrets.
  try {
    assertSecureSecrets();
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }

  try {
    validateAndLogServiceConfig();
  } catch (err) {
    logger.error(String(err));
    if (!isRailway) {
      process.exit(1);
    }
  }

  if (shouldAutoMigrate) {
    logger.info('Running database setup (prisma migrations + hotfixes)...');
    try {
      await new Promise<void>((resolve, reject) => {
        const setupProcess = spawn('npx', ['ts-node', '--transpile-only', 'scripts/db-setup.ts'], {
          stdio: 'inherit',
          env: process.env,
          shell: process.platform === 'win32',
        });

        setupProcess.on('error', reject);
        setupProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`db-setup exited with code ${code}`));
        });
      });
      logger.info('Database setup completed');
    } catch (err) {
      logger.error('Database setup failed during startup', err);
      throw err;
    }
  }

  await prisma.$connect();
  logger.info('Database connected');

  // Run the listing expiry job once on startup, then every hour.
  // (Background jobs run under a Postgres advisory lock, so with several instances only one runs each.)
  const listingExpiry = () => runExclusive('listing-expiry', expireOverdueListings).catch((err) => logger.error('Listing expiry job failed', err));
  listingExpiry();
  setInterval(listingExpiry, 60 * 60 * 1000);

  // Subscriptions + store rentals: expiry, freezing lapsed stores and "ending soon" reminders run
  // every 5 minutes (utils/lifecycleJobs.ts) — access itself is decided from the dates at request
  // time, this keeps stored state and notifications close behind.
  startLifecycleJobs();

  // Web Push + WhatsApp delivery of in-app notifications created anywhere in the app (utils/notificationDispatch.ts).
  // Does nothing until VAPID_* / WHATSAPP_* variables are configured.
  startNotificationDispatcher();
  // Instant listing alerts: drains the alert queue the moment a listing goes live (LISTEN/NOTIFY, with
  // polling as the fallback) and relays alert events between instances (utils/alertWorker.ts).
  startAlertWorker();

  // MTN MoMo payments: startup status line + a 30s reconciler that settles/retries anything the
  // callback or the payer's polling did not (utils/momo/reconciler.ts). Does nothing while MTN_ENABLED is off.
  logMomoConfigStatus();
  startPaymentReconciler();

  // Tier expiry: Gold/Platinum listings lapse back to FREE (hourly is plenty).
  const runTierAndStoreExpiry = () => {
    runExclusive('tier-expiry', expireOverdueListingTiers).catch((err) => logger.error('Tier expiry job failed', err));
    // Renewal reminders — 30 days out for ANNUAL, 3 for MONTHLY (see
    // getRenewalWindowDays in routes/storeRentals.ts). Runs on the same
    // hourly cadence; the job itself is idempotent per-expiry
    // (renewalReminderSentAt), so an hourly check is frequent enough to
    // catch a rental entering its window without ever double-sending.
    runExclusive('store-renewal-reminders', sendStoreRenewalReminders).catch((err) => logger.error('Store renewal reminder job failed', err));
  };
  runTierAndStoreExpiry();
  setInterval(runTierAndStoreExpiry, 60 * 60 * 1000);

  const { default: app } = await import('./app');
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });
}

main().catch((err) => {
  logger.error(
    'Failed to start server. Ensure DATABASE_URL (or DATABASE_PRIVATE_URL on Railway) is set and migrations are applied.',
    err
  );
  process.exit(1);
});
