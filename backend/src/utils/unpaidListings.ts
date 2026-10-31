/**
 * unpaidListings.ts — listings posted with a Gold/Platinum visibility request whose MoMo payment was
 * never completed (Listing.requestedTier is only cleared when the payment succeeds or an admin decides).
 *
 *  • listUnpaidListings: feeds the in-app reminder popup (GET /listings/unpaid).
 *  • sendUnpaidListingReminders: one follow-up email + in-app notification per listing, an hour after posting.
 */
import { prisma } from './prisma';
import { logger } from './logger';
import { sendUnpaidListingReminderEmail } from './email';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const REMINDER_AFTER_MS = HOUR_MS;
const MAX_AGE_MS = 14 * DAY_MS; // stop nagging about very old listings

export async function listUnpaidListings(userId: string) {
  return prisma.listing.findMany({
    where: { userId, requestedTier: { not: null }, status: { in: ['PENDING', 'ACTIVE'] }, createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) } },
    select: { id: true, title: true, requestedTier: true, createdAt: true, images: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}

export async function sendUnpaidListingReminders(now = new Date()): Promise<number> {
  const candidates = await prisma.listing.findMany({
    where: {
      requestedTier: { in: ['GOLD', 'PLATINUM'] },
      paymentReminderSentAt: null,
      status: { in: ['PENDING', 'ACTIVE'] },
      createdAt: { lte: new Date(now.getTime() - REMINDER_AFTER_MS), gte: new Date(now.getTime() - MAX_AGE_MS) },
    },
    select: { id: true, title: true, requestedTier: true, userId: true, user: { select: { email: true, name: true } } },
    take: 200,
  });
  let sent = 0;
  for (const l of candidates) {
    try {
      // Claim first so two overlapping sweeps can never double-send.
      const claim = await prisma.listing.updateMany({ where: { id: l.id, paymentReminderSentAt: null, requestedTier: { not: null } }, data: { paymentReminderSentAt: now } });
      if (claim.count !== 1) continue;
      const tier = l.requestedTier as 'GOLD' | 'PLATINUM';
      await prisma.notification.create({
        data: {
          userId: l.userId,
          type: 'SYSTEM',
          title: 'Payment not completed',
          message: `Your ${tier === 'PLATINUM' ? 'Platinum' : 'Gold'} visibility payment for "${l.title}" is still pending. Pay now to switch it on.`,
          data: { kind: 'LISTING_PAYMENT_PENDING', listingId: l.id, tier },
        },
      });
      if (l.user?.email) {
        await sendUnpaidListingReminderEmail(l.user.email, l.user.name, l.title, tier, l.id);
      }
      sent++;
    } catch (err) {
      logger.error(`Failed to send unpaid-listing reminder ${l.id}`, err);
    }
  }
  return sent;
}
