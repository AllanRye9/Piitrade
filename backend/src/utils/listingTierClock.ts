import { prisma } from './prisma';
import { logger } from './logger';

/**
 * A seller may pay for Gold/Platinum visibility while the ad is still PENDING moderation. The payment
 * applies the tier straight away (so nothing is lost if the ad is approved later), but the paid days
 * must not be used up while nobody can see the ad. utils/momo/paymentService.ts marks such a payment
 * `awaitingApproval`; when an admin approves the listing this restarts the visibility window so the
 * seller gets the FULL paid period from the moment the ad goes live.
 *
 * Safe to call for any set of listings, any number of times, and never throws (approval must not fail
 * because of this): a payment is consumed once, and listings without such a payment are untouched.
 */
export async function startPaidTierOnApproval(listingIds: string[], now: Date = new Date()): Promise<number> {
  if (listingIds.length === 0) return 0;
  let restarted = 0;
  try {
    const payments = await prisma.paymentTransaction.findMany({
      where: {
        purpose: 'LISTING_TIER',
        status: 'SUCCESSFUL',
        targetId: { in: listingIds },
        metadata: { path: ['awaitingApproval'], equals: true },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const p of payments) {
      const meta = (p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata) ? p.metadata : {}) as Record<string, unknown>;
      const days = Number(meta.durationDays);
      const listing = await prisma.listing.findUnique({ where: { id: p.targetId }, select: { id: true, status: true, tier: true, tierExpiresAt: true } });
      // Only a live listing that still has the paid tier running; anything else just clears the marker.
      if (listing && listing.status === 'ACTIVE' && listing.tier !== 'FREE' && listing.tierExpiresAt && days > 0) {
        const next = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        if (next > listing.tierExpiresAt) {
          await prisma.listing.update({ where: { id: listing.id }, data: { tierExpiresAt: next } });
          restarted++;
        }
      }
      if (listing && listing.status !== 'PENDING') {
        await prisma.paymentTransaction.update({
          where: { id: p.id },
          data: { metadata: { ...meta, awaitingApproval: false, tierStartedAt: now.toISOString() } },
        });
      }
    }
  } catch (err) {
    logger.error('startPaidTierOnApproval failed', err);
  }
  return restarted;
}
