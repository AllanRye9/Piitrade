"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireOverdueListings = expireOverdueListings;
exports.expireOverdueListingTiers = expireOverdueListingTiers;
const prisma_1 = require("./prisma");
const logger_1 = require("./logger");
const email_1 = require("./email");
/**
 * Finds all ACTIVE listings whose `expiresAt` has passed, marks them as
 * EXPIRED, sends a renewal email to each owner, and creates an in-app
 * notification. Designed to be called on a recurring schedule (e.g. hourly).
 */
async function expireOverdueListings() {
    const now = new Date();
    try {
        // Fetch listings that are ACTIVE but past their expiresAt.
        // Admin-owned listings are excluded — they persist indefinitely by default
        // unless the admin explicitly sets an expiresAt date.
        const overdueListings = await prisma_1.prisma.listing.findMany({
            where: {
                status: 'ACTIVE',
                expiresAt: { lt: now, not: null },
                // Only expire listings whose owner is NOT an admin
                user: { role: { not: 'ADMIN' } },
            },
            include: {
                user: { select: { id: true, name: true, email: true } },
            },
        });
        if (overdueListings.length === 0)
            return;
        logger_1.logger.info(`Expiry job: found ${overdueListings.length} overdue listing(s)`);
        for (const listing of overdueListings) {
            try {
                // Mark listing as EXPIRED
                await prisma_1.prisma.listing.update({
                    where: { id: listing.id },
                    data: { status: 'EXPIRED' },
                });
                // In-app notification
                await prisma_1.prisma.notification.create({
                    data: {
                        userId: listing.user.id,
                        type: 'LISTING_EXPIRED',
                        title: 'Listing Expired',
                        message: `Your listing "${listing.title}" has expired and is no longer visible to buyers. Renew your subscription to reactivate it.`,
                        data: { listingId: listing.id, listingTitle: listing.title },
                    },
                });
                // Renewal email
                await (0, email_1.sendListingExpiredEmail)(listing.user.email, listing.user.name, listing.title);
                logger_1.logger.info(`Expired listing ${listing.id} ("${listing.title}") for user ${listing.user.id}`);
            }
            catch (innerErr) {
                logger_1.logger.error(`Failed to expire listing ${listing.id}: ${String(innerErr)}`);
            }
        }
    }
    catch (err) {
        logger_1.logger.error(`Listing expiry job error: ${String(err)}`);
    }
}
/**
 * Gold/Platinum expiry for ordinary users' per-listing tiers: any non-admin
 * listing whose `tierExpiresAt` has passed drops back to FREE and loses its
 * premium standing — the listing itself (status, content, expiresAt) is
 * left exactly as it was. Store-owned listings never have a tierExpiresAt
 * (their tier follows the store's rental, see syncStoreListingsTier), and
 * admin listings are excluded outright: admin content never downgrades.
 */
async function expireOverdueListingTiers() {
    try {
        const result = await prisma_1.prisma.listing.updateMany({
            where: {
                tier: { not: 'FREE' },
                tierExpiresAt: { lt: new Date(), not: null },
                user: { role: { not: 'ADMIN' } },
            },
            data: { tier: 'FREE', tierExpiresAt: null },
        });
        if (result.count > 0)
            logger_1.logger.info(`Tier expiry job: downgraded ${result.count} listing(s) to FREE`);
    }
    catch (err) {
        logger_1.logger.error(`Listing tier expiry job error: ${String(err)}`);
    }
}
//# sourceMappingURL=expireListings.js.map