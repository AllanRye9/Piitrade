import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { sendStoreRenewalReminderEmail } from '../utils/email';

const router = Router();

// Uganda-launch defaults — fees quoted in UGX (the site's default currency).
const STORE_PLANS = {
  FREE_TRIAL: { fee: 0,      currency: 'UGX', durationDays: 3 },
  MONTHLY:    { fee: 60000,  currency: 'UGX', durationDays: 30 },
  ANNUAL:     { fee: 300000, currency: 'UGX', durationDays: 365 },
} as const;

import {
  StoreTier, STORE_TIERS, syncStoreListingsTier, applyRentalUpdate, confirmPendingRenewal, expireStoreRental,
} from '../utils/storeRentalService';
// Kept as re-exports so existing importers (index.ts, other routes) keep working.
export { syncStoreListingsTier, downgradeStoreAfterRentalEnds, expireOverdueStoreRentals } from '../utils/storeRentalService';

// An ANNUAL plan costs this many months of the tier's monthly fee. 5 keeps
// the pre-existing FREE-tier annual price exactly as it was (60,000 x 5 =
// 300,000 UGX) while letting Gold/Platinum scale from the same admin-set
// monthly figure (SiteConfig.tierPricing, see PUT
// /admin/site-config/tier-pricing) instead of needing three more numbers.
const ANNUAL_MONTHS_BILLED = 5;

// Admin-set monthly store fee for a tier, falling back to the pre-existing
// MONTHLY plan price for FREE and to conservative defaults otherwise (the
// same defaults DEFAULT_TIER_PRICING uses in routes/admin.ts).
async function getStoreTierMonthlyFee(tier: StoreTier): Promise<{ fee: number; currency: string }> {
  const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
  const stored = (config?.tierPricing as Record<string, unknown> | null) || {};
  const defaults: Record<StoreTier, number> = { FREE: STORE_PLANS.MONTHLY.fee, GOLD: 150000, PLATINUM: 400000 };
  const key = tier === 'FREE' ? 'storeFreeFee' : tier === 'GOLD' ? 'storeGoldFee' : 'storePlatinumFee';
  const fee = typeof stored[key] === 'number' ? (stored[key] as number) : defaults[tier];
  const currency = typeof stored.currency === 'string' ? stored.currency : 'UGX';
  return { fee, currency };
}

// ─── Public / listing routes ───────────────────────────────────────────────────

// GET /api/store-rentals — list active rentals (public directory)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entityType = req.query.entityType as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20')));
    const skip = (page - 1) * limit;

    const now = new Date();
    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      endDate: { gt: now },
    };
    if (entityType) where.entityType = entityType.toUpperCase();

    const [rentals, total] = await Promise.all([
      prisma.storeRental.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
              country: true,
              role: true,
              companyName: true,
              businessDescription: true,
              website: true,
              store: { select: { id: true, name: true, slug: true, logo: true, banner: true, rating: true, ratingCount: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.storeRental.count({ where }),
    ]);

    res.json({ rentals, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// ─── Authenticated renter routes ───────────────────────────────────────────────

// GET /api/store-rentals/my — current user's active rental
// The number of days before endDate a renewal reminder goes out for a
// given plan — 30 for ANNUAL, 3 for MONTHLY (the free trial never renews,
// it's meant to convert to a paid plan instead, so it gets no reminder).
function getRenewalWindowDays(plan: string): number {
  return plan === 'ANNUAL' ? 30 : 3;
}

/**
 * Self-serve renewal — extends the SAME rental row a store owner already
 * has (active, or recently lapsed and frozen), rather than filing a brand
 * new application. This is deliberately separate from POST / above (which
 * still handles first-time applications and their full admin review): a
 * renewal is the same already-approved store just paying to continue, so
 * it doesn't need a fresh KYC/content review, only payment confirmation
 * for a paid tier — and the store is never frozen or interrupted while
 * that confirmation is pending (see the two branches below).
 *   body: { plan: 'MONTHLY' | 'ANNUAL', tier?: 'FREE' | 'GOLD' | 'PLATINUM' }
 * tier defaults to the rental's current tier (the common "just extend,
 * same plan" case needs no extra input at all).
 */
router.post('/renew', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { plan, tier: tierRaw } = req.body as { plan?: string; tier?: string };
    const selectedPlan = String(plan || '').toUpperCase();
    if (selectedPlan !== 'MONTHLY' && selectedPlan !== 'ANNUAL') {
      return next(createError('plan must be MONTHLY or ANNUAL', 400));
    }

    const rental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!rental) {
      return next(createError('No existing store found to renew — apply for a new store instead', 404));
    }

    const tier = tierRaw ? (String(tierRaw).toUpperCase() as StoreTier) : (rental.tier as StoreTier);
    if (!STORE_TIERS.includes(tier)) {
      return next(createError('tier must be FREE, GOLD, or PLATINUM', 400));
    }

    const durationDays = STORE_PLANS[selectedPlan as 'MONTHLY' | 'ANNUAL'].durationDays;
    const tierPrice = await getStoreTierMonthlyFee(tier);
    const fee = selectedPlan === 'MONTHLY' ? tierPrice.fee : tierPrice.fee * ANNUAL_MONTHS_BILLED;

    // Renewing early doesn't waste the days already paid for — the new
    // period starts from the current endDate (or now, if already
    // lapsed), never from today outright.
    const base = rental.endDate > new Date() ? rental.endDate : new Date();
    const newEndDate = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const existingPlacements = (rental.placements as Record<string, unknown>) || {};

    if (fee === 0) {
      // Free tier: nothing to confirm, applies immediately.
      const updated = await prisma.storeRental.update({
        where: { id: rental.id },
        data: {
          tier, fee: 0, endDate: newEndDate, status: 'ACTIVE', renewalReminderSentAt: null,
          placements: { ...existingPlacements, subscriptionPlan: selectedPlan, paymentStatus: 'WAIVED', pendingRenewal: null },
        },
      });
      await prisma.store.updateMany({ where: { userId: rental.userId }, data: { isActive: true } });
      await syncStoreListingsTier(rental.userId, tier);
      res.json({ rental: updated, requiresPayment: false });
      return;
    }

    // Paid tier: the store keeps running exactly as it is — status,
    // endDate, and tier are untouched — until an admin confirms payment
    // (see PATCH /admin/:id/confirm-renewal below). Nothing about the
    // live store is affected by a renewal request sitting unconfirmed.
    const updated = await prisma.storeRental.update({
      where: { id: rental.id },
      data: {
        placements: {
          ...existingPlacements,
          pendingRenewal: { plan: selectedPlan, tier, newEndDate: newEndDate.toISOString(), fee, currency: tierPrice.currency, requestedAt: new Date().toISOString() },
        },
      },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(admins.map((a) => prisma.notification.create({
      data: {
        userId: a.id,
        type: 'SYSTEM',
        title: 'Store Renewal Pending Payment',
        message: `A store owner requested to renew (${tier} ${selectedPlan}) — confirm payment to apply it.`,
        data: { rentalId: rental.id },
      },
    }).catch(() => {})));

    res.json({ rental: updated, requiresPayment: true, fee, currency: tierPrice.currency });
  } catch (err) {
    next(err);
  }
});

router.get('/my', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const latestRental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestRental) return res.json({ rental: null });

    // The scheduled sweep normally gets to an overdue rental first; this closes the gap so the
    // owner never sees a stale "active" store. Status + downgrade commit together.
    let rental = latestRental;
    if (latestRental.status === 'ACTIVE' && latestRental.endDate <= now) {
      await expireStoreRental(latestRental.id, latestRental.userId)
        .catch((e) => console.error('Failed to expire store rental lazily', e));
      rental = (await prisma.storeRental.findUnique({ where: { id: latestRental.id } })) ?? latestRental;
    }

    res.json({ rental });
  } catch (err) {
    next(err);
  }
});

// POST /api/store-rentals — request a rental (admin approves)
// Any authenticated user can apply; if their role is USER we auto-promote them
// to AGENT (the minimum seller role) so they can post listings after approval.
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { entityType, plan, placements, tier: requestedTierRaw } = req.body;
    const currentRole = req.user!.role;

    // Determine the effective entity type the user wants to register as
    const validEntityTypes = ['USER', 'AGENT', 'COMPANY', 'ORGANIZATION'];
    const rawEntityType = (entityType || currentRole || 'AGENT').toUpperCase();
    // Default USER-role registrants to AGENT unless they specified something else
    const et = rawEntityType === 'USER' ? 'AGENT' : rawEntityType;
    if (!validEntityTypes.includes(et)) {
      return next(createError('Invalid entityType', 400));
    }

    const selectedPlan = String(plan || '').toUpperCase() as keyof typeof STORE_PLANS;
    if (!selectedPlan || !STORE_PLANS[selectedPlan]) {
      return next(createError('plan must be FREE_TRIAL, MONTHLY, or ANNUAL', 400));
    }

    // Auto-promote regular USER accounts to the seller role they selected
    // This happens before the rental is created so the role is available immediately
    const sellerRoles = ['AGENT', 'COMPANY', 'ORGANIZATION'];
    if (!sellerRoles.includes(currentRole) && currentRole !== 'ADMIN') {
      const newRole = sellerRoles.includes(et) ? et : 'AGENT';
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { role: newRole as 'AGENT' | 'COMPANY' | 'ORGANIZATION' },
      });
    }

    const now = new Date();
    const existingActiveOrPending = await prisma.storeRental.findFirst({
      where: {
        userId: req.user!.userId,
        status: { in: ['PENDING', 'ACTIVE'] },
        endDate: { gt: now },
      },
    });
    if (existingActiveOrPending) {
      return next(createError('You already have an active or pending store application', 409));
    }

    const planDef = STORE_PLANS[selectedPlan];
    const end = new Date(now.getTime() + planDef.durationDays * 24 * 60 * 60 * 1000);

    // Subscription tier (Free/Gold/Platinum) — priced from the admin-set
    // catalog rather than hard-coded. The 3-day trial is always FREE tier
    // and free of charge; MONTHLY bills the tier's monthly fee, ANNUAL
    // bills ANNUAL_MONTHS_BILLED months of it.
    const requestedTier = String(requestedTierRaw || 'FREE').toUpperCase() as StoreTier;
    if (!STORE_TIERS.includes(requestedTier)) {
      return next(createError('tier must be FREE, GOLD, or PLATINUM', 400));
    }
    if (selectedPlan === 'FREE_TRIAL' && requestedTier !== 'FREE') {
      return next(createError('The free trial is only available on the Free tier', 400));
    }
    const tierPrice = await getStoreTierMonthlyFee(requestedTier);
    const computedFee =
      selectedPlan === 'FREE_TRIAL' ? 0
      : selectedPlan === 'MONTHLY' ? tierPrice.fee
      : tierPrice.fee * ANNUAL_MONTHS_BILLED;

    const rental = await prisma.storeRental.create({
      data: {
        userId: req.user!.userId,
        entityType: et as 'USER' | 'AGENT' | 'COMPANY' | 'ORGANIZATION',
        tier: requestedTier,
        fee: computedFee,
        currency: tierPrice.currency as 'UGX',
        startDate: now,
        endDate: end,
        placements: {
          ...(placements || {}),
          subscriptionPlan: selectedPlan,
          paymentStatus: computedFee === 0 ? 'WAIVED' : 'PENDING',
          renewalDate: end.toISOString(),
        },
        status: 'PENDING',
      },
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: 'SYSTEM',
          title: 'New Store Application',
          message: `A user requested a ${requestedTier} ${selectedPlan.replace('_', ' ')} store plan.`,
          data: { rentalId: rental.id, userId: req.user!.userId, plan: selectedPlan },
        })),
      });
    }

    res.status(201).json({
      rental,
      message: 'Store application submitted for admin review.',
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/store-rentals/my/placements — update placement preferences
router.patch('/my/placements', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { placements } = req.body;
    const now = new Date();
    const rental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId, status: 'ACTIVE', endDate: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    if (!rental) return next(createError('No active rental found', 404));

    if (placements == null || typeof placements !== 'object' || Array.isArray(placements)) {
      return next(createError('placements must be an object', 400));
    }
    // A registered store can use at most 3 placement zones.
    const MAX_PLACEMENT_ZONES = 3;
    if (placements.positions !== undefined) {
      if (!Array.isArray(placements.positions)) return next(createError('placements.positions must be an array', 400));
      if (new Set(placements.positions).size > MAX_PLACEMENT_ZONES) {
        return next(createError(`A store can use at most ${MAX_PLACEMENT_ZONES} placement zones`, 400));
      }
    }

    // Merge instead of replacing, so saving preferences never wipes the
    // rental's plan / renewal bookkeeping stored in the same JSON column.
    const existingPlacements = (rental.placements as Record<string, unknown> | null) || {};
    const updated = await prisma.storeRental.update({
      where: { id: rental.id },
      data: { placements: { ...existingPlacements, ...placements } },
    });

    res.json({ rental: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/store-rentals/admin/all — list all rentals
router.get('/admin/all', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20')));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status.toUpperCase();

    const [rentals, total] = await Promise.all([
      prisma.storeRental.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true, companyName: true, isKycVerified: true, kycStatus: true } },
        },
        // ID-verified applicants are reviewed first (priority queue);
        // within each group the existing newest-first order is unchanged.
        orderBy: [{ user: { isKycVerified: 'desc' } }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.storeRental.count({ where }),
    ]);

    res.json({ rentals, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/store-rentals/admin/:id — approve/reject/update a rental
router.patch('/admin/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // One transaction: validates the change, then (for ACTIVE) role + store listing-subscription +
    // Store record + tier cascade + notification, or (for ending) freezes the store and downgrades
    // the listings — all or nothing. See utils/storeRentalService.ts.
    const { rental, store, entitlement, activating, ending, listingsUpdated } = await applyRentalUpdate(req.params.id, req.body ?? {});
    res.json({
      rental,
      // Extra, additive fields: the resulting operational state, so the admin UI can confirm it.
      store: store ? { id: store.id, slug: store.slug, name: store.name, isActive: store.isActive } : null,
      entitlement,
      effect: { activated: activating, deactivated: ending, listingsUpdated },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirms payment for a pending renewal (see POST /renew above) and
 * applies it: extends endDate, updates tier if it changed, keeps status
 * ACTIVE (or reactivates a frozen store if the renewal came in after
 * expiry). Separate from the general PATCH /admin/:id above for the same
 * reason PUT /admin/listings/:id/tier is separate from .../approve — this
 * is specifically a payment confirmation, not a general-purpose field edit.
 */
router.patch('/admin/:id/confirm-renewal', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rental } = await confirmPendingRenewal(req.params.id);
    res.json({ rental });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/store-rentals/admin/:id — delete a rental
router.delete('/admin/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.storeRental.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Rental not found', 404));
    await prisma.storeRental.delete({ where: { id: req.params.id } });
    res.json({ message: 'Rental deleted' });
  } catch (err) {
    next(err);
  }
});

/**
 * Scheduled sweep (registered in src/index.ts, runs hourly): emails a
 * renewal reminder to every ACTIVE, non-admin store rental that has just
 * entered its plan's renewal window (30 days out for ANNUAL, 3 for
 * MONTHLY — see getRenewalWindowDays above) and hasn't been reminded for
 * this particular expiry yet (renewalReminderSentAt). One email per
 * upcoming expiry, not one per hourly run — see the field's own comment in
 * schema.prisma for how it resets on renewal so the *next* expiry still
 * gets reminded. A rental with no user.email or unreadable plan is skipped
 * rather than failing the whole batch.
 */
export async function sendStoreRenewalReminders(): Promise<void> {
  const candidates = await prisma.storeRental.findMany({
    where: {
      status: 'ACTIVE',
      renewalReminderSentAt: null,
      user: { role: { not: 'ADMIN' } },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const now = new Date();
  for (const rental of candidates) {
    try {
      const plan = String((rental.placements as Record<string, unknown> | null)?.subscriptionPlan || '').toUpperCase();
      if (plan !== 'MONTHLY' && plan !== 'ANNUAL') continue; // free trials don't get a renewal reminder — see getRenewalWindowDays

      const daysRemaining = Math.ceil((rental.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysRemaining < 0 || daysRemaining > getRenewalWindowDays(plan)) continue;

      const storeName = (await prisma.store.findFirst({ where: { userId: rental.userId }, select: { name: true } }))?.name || 'your store';
      await sendStoreRenewalReminderEmail(
        rental.user.email, rental.user.name, storeName,
        rental.tier as StoreTier, plan as 'MONTHLY' | 'ANNUAL', Math.max(daysRemaining, 0), rental.endDate,
      );
      await prisma.storeRental.update({ where: { id: rental.id }, data: { renewalReminderSentAt: now } });
    } catch (err) {
      console.error(`Failed to send renewal reminder for store rental ${rental.id}`, err);
    }
  }
}

export default router;
