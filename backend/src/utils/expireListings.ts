import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from './prisma';
import { logger } from './logger';
import { sendListingExpiredEmail } from './email';

/**
 * Finds all ACTIVE listings whose `expiresAt` has passed, marks them as
 * EXPIRED, sends a renewal email to each owner, and creates an in-app
 * notification. Designed to be called on a recurring schedule (e.g. hourly).
 */
export async function expireOverdueListings(): Promise<void> {
  const now = new Date();

  try {
    // Fetch listings that are ACTIVE but past their expiresAt.
    // Admin-owned listings are excluded — they persist indefinitely by default
    // unless the admin explicitly sets an expiresAt date.
    const overdueListings = await prisma.listing.findMany({
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

    if (overdueListings.length === 0) return;

    logger.info(`Expiry job: found ${overdueListings.length} overdue listing(s)`);

    for (const listing of overdueListings) {
      try {
        // Mark listing as EXPIRED
        await prisma.listing.update({
          where: { id: listing.id },
          data: { status: 'EXPIRED' },
        });

        // In-app notification
        await prisma.notification.create({
          data: {
            userId: listing.user.id,
            type: 'LISTING_EXPIRED',
            title: 'Listing Expired',
            message: `Your listing "${listing.title}" has expired and is no longer visible to buyers. Renew your subscription to reactivate it.`,
            data: { listingId: listing.id, listingTitle: listing.title },
          },
        });

        // Renewal email
        await sendListingExpiredEmail(listing.user.email, listing.user.name, listing.title);

        logger.info(`Expired listing ${listing.id} ("${listing.title}") for user ${listing.user.id}`);
      } catch (innerErr) {
        logger.error(`Failed to expire listing ${listing.id}: ${String(innerErr)}`);
      }
    }
  } catch (err) {
    if (
      err instanceof PrismaClientKnownRequestError &&
      (err.code === 'P2021' || err.message.includes('does not exist in the current database'))
    ) {
      logger.warn('Listing expiry job skipped because the Listing table is not present in the current database.');
      return;
    }

    logger.error(`Listing expiry job error: ${String(err)}`);
  }
}
