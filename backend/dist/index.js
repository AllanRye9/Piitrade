"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const child_process_1 = require("child_process");
const logger_1 = require("./utils/logger");
const prisma_1 = require("./utils/prisma");
const serviceConfig_1 = require("./utils/serviceConfig");
const expireListings_1 = require("./utils/expireListings");
const storeRentals_1 = require("./routes/storeRentals");
// Last-resort safety net: log and keep the process alive instead of letting
// an unhandled rejection or a stray async error (e.g. a stream 'error' event
// with no listener) crash the whole server for every in-flight request.
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception:', err);
});
const PORT = parseInt(process.env.PORT ?? '', 10) || 5000;
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
const shouldAutoMigrate = process.env.AUTO_MIGRATE_ON_START
    ? process.env.AUTO_MIGRATE_ON_START.toLowerCase() !== 'false'
    : process.env.NODE_ENV === 'production';
async function main() {
    try {
        (0, serviceConfig_1.validateAndLogServiceConfig)();
    }
    catch (err) {
        logger_1.logger.error(String(err));
        if (!isRailway) {
            process.exit(1);
        }
    }
    if (shouldAutoMigrate) {
        logger_1.logger.info('Running database setup (prisma migrations + hotfixes)...');
        try {
            await new Promise((resolve, reject) => {
                const setupProcess = (0, child_process_1.spawn)('npx', ['ts-node', '--transpile-only', 'scripts/db-setup.ts'], {
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
            logger_1.logger.info('Database setup completed');
        }
        catch (err) {
            logger_1.logger.error('Database setup failed during startup', err);
            throw err;
        }
    }
    await prisma_1.prisma.$connect();
    logger_1.logger.info('Database connected');
    // Run the listing expiry job once on startup, then every hour.
    (0, expireListings_1.expireOverdueListings)().catch((err) => logger_1.logger.error('Initial expiry job failed', err));
    setInterval(() => {
        (0, expireListings_1.expireOverdueListings)().catch((err) => logger_1.logger.error('Scheduled expiry job failed', err));
    }, 60 * 60 * 1000);
    // Tier + store-subscription expiry: Gold/Platinum lapse back to FREE, and
    // a lapsed store is frozen and dropped to FREE (see expireOverdueStoreRentals).
    const runTierAndStoreExpiry = () => {
        (0, expireListings_1.expireOverdueListingTiers)().catch((err) => logger_1.logger.error('Tier expiry job failed', err));
        (0, storeRentals_1.expireOverdueStoreRentals)().catch((err) => logger_1.logger.error('Store rental expiry job failed', err));
        // Renewal reminders — 30 days out for ANNUAL, 3 for MONTHLY (see
        // getRenewalWindowDays in routes/storeRentals.ts). Runs on the same
        // hourly cadence; the job itself is idempotent per-expiry
        // (renewalReminderSentAt), so an hourly check is frequent enough to
        // catch a rental entering its window without ever double-sending.
        (0, storeRentals_1.sendStoreRenewalReminders)().catch((err) => logger_1.logger.error('Store renewal reminder job failed', err));
    };
    runTierAndStoreExpiry();
    setInterval(runTierAndStoreExpiry, 60 * 60 * 1000);
    const { default: app } = await Promise.resolve().then(() => __importStar(require('./app')));
    app.listen(PORT, '0.0.0.0', () => {
        logger_1.logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
}
main().catch((err) => {
    logger_1.logger.error('Failed to start server. Ensure DATABASE_URL (or DATABASE_PRIVATE_URL on Railway) is set and migrations are applied.', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map