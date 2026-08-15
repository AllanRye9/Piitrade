import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';
import { validateAndLogServiceConfig } from './utils/serviceConfig';
import { expireOverdueListings } from './utils/expireListings';

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

const runPrismaMigrateDeploy = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const migrateProcess = spawn('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    });

    migrateProcess.on('error', reject);
    migrateProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`prisma migrate deploy exited with code ${code}`));
    });
  });
};

const runHotfixFile = async (relativeFilePath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const hotfixProcess = spawn(
      'npx',
      ['prisma', 'db', 'execute', '--file', relativeFilePath, '--schema', 'prisma/schema.prisma'],
      {
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
      }
    );

    hotfixProcess.on('error', reject);
    hotfixProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`hotfix ${relativeFilePath} exited with code ${code}`));
    });
  });
};

// Every .sql file under prisma/hotfixes/ is an idempotent (ADD COLUMN IF NOT
// EXISTS / CREATE TABLE IF NOT EXISTS) compatibility fix for a specific table.
// Previously only ensure_listing_inventory_columns.sql was ever executed here,
// so drift-recovery fixes written for other tables (SiteConfig, SiteStat,
// etc.) sat unused and never actually ran — e.g. SiteConfig missing a column
// that a later migration added would make every /admin/settings call 500.
//
// IMPORTANT: a single hotfix failing must never take the whole server down.
// This used to re-throw on the first failing file, which propagated out of
// main() and hit `process.exit(1)` before app.listen() was ever reached —
// so one broken/inapplicable SQL file (e.g. referencing a table that
// doesn't exist yet on this environment) made the *entire* API unreachable
// on every restart. From the browser that looks identical to a CORS
// failure: no process listening = a platform-level 404 with no
// Access-Control-Allow-Origin header, even though app.ts's actual CORS
// config is correct. deploy.sh already treats several of these same
// hotfixes as best-effort (`|| echo ... continuing anyway`); this mirrors
// that tolerance here so a single bad hotfix degrades one feature instead
// of taking the whole site offline.
const runAllHotfixes = async (): Promise<void> => {
  const hotfixesDir = path.join(__dirname, '..', 'prisma', 'hotfixes');
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(hotfixesDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    logger.warn('Could not read prisma/hotfixes directory, skipping hotfixes', err);
    return;
  }

  const failures: string[] = [];
  for (const file of files) {
    const relativePath = path.join('prisma', 'hotfixes', file);
    try {
      await runHotfixFile(relativePath);
    } catch (err) {
      logger.error(`Compatibility hotfix failed: ${file} — continuing with remaining hotfixes`, err);
      failures.push(file);
    }
  }

  if (failures.length > 0) {
    logger.warn(
      `${failures.length} compatibility hotfix(es) failed and were skipped: ${failures.join(', ')}. ` +
      'The features backed by those tables/columns may not work correctly until this is resolved, ' +
      'but the server will still start.'
    );
  }
};

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
    logger.info('Running startup database migrations (prisma migrate deploy)...');
    try {
      await runPrismaMigrateDeploy();
      logger.info('Startup database migrations completed');
    } catch (err) {
      logger.error('Startup database migrations failed', err);
      if (!isRailway) {
        throw err;
      }

      logger.warn('Attempting compatibility hotfixes on Railway...');
      await runAllHotfixes();
      logger.info('Compatibility hotfixes completed');
    }

    logger.info('Ensuring compatibility columns/tables exist...');
    await runAllHotfixes();
    logger.info('Compatibility check completed');
  }

  await prisma.$connect();
  logger.info('Database connected');

  // Run the listing expiry job once on startup, then every hour.
  expireOverdueListings().catch((err) => logger.error('Initial expiry job failed', err));
  setInterval(() => {
    expireOverdueListings().catch((err) => logger.error('Scheduled expiry job failed', err));
  }, 60 * 60 * 1000);

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
