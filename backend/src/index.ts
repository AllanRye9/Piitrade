import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';
import { validateAndLogServiceConfig } from './utils/serviceConfig';
import { expireOverdueListings, expireOverdueListingTiers } from './utils/expireListings';
import { expireOverdueStoreRentals, sendStoreRenewalReminders } from './routes/storeRentals';

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
    : process.env.NODE_ENV === 'production';

async function main() {
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
  expireOverdueListings().catch((err) => logger.error('Initial expiry job failed', err));
  setInterval(() => {
    expireOverdueListings().catch((err) => logger.error('Scheduled expiry job failed', err));
  }, 60 * 60 * 1000);

  // Tier + store-subscription expiry: Gold/Platinum lapse back to FREE, and
  // a lapsed store is frozen and dropped to FREE (see expireOverdueStoreRentals).
  const runTierAndStoreExpiry = () => {
    expireOverdueListingTiers().catch((err) => logger.error('Tier expiry job failed', err));
    expireOverdueStoreRentals().catch((err) => logger.error('Store rental expiry job failed', err));
    // Renewal reminders — 30 days out for ANNUAL, 3 for MONTHLY (see
    // getRenewalWindowDays in routes/storeRentals.ts). Runs on the same
    // hourly cadence; the job itself is idempotent per-expiry
    // (renewalReminderSentAt), so an hourly check is frequent enough to
    // catch a rental entering its window without ever double-sending.
    sendStoreRenewalReminders().catch((err) => logger.error('Store renewal reminder job failed', err));
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
