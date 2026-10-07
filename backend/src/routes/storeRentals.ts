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

type StoreTier = 'FREE' | 'GOLD' | 'PLATINUM';
const STORE_TIERS: StoreTier[] = ['FREE', 'GOLD', 'PLATINUM'];

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

/**
 * Sets `tier` on every non-admin listing a store owner has, so a store's
 * subscription tier is what its listings render at (see ListingTier in
 * schema.prisma) rather than something set listing-by-listing. Called
 * whenever the store's tier changes and whenever its rental lapses.
 * `tierExpiresAt` is cleared for these — the rental's own endDate is the
 * source of truth for when a store's tier lapses, not a per-listing timer.
 * With `clearPlacements` (used on downgrade), the three seller-assignable
 * zones (LATEST_COLLECTIONS/FEATURED_DEAL/FLASH_SALE) are also released,
 * since only a Registered Store may hold them. BACK_TO_SCHOOL is left
 * alone — it's admin-curated, not something a store rental grants.
 * Listing *status* is never touched: existing items stay exactly as they
 * were, per the "already-added items remain untouched" rule.
 */
export async function syncStoreListingsTier(
  userId: string,
  tier: StoreTier,
  opts: { clearPlacements?: boolean } = {},
): Promise<number> {
  const result = await prisma.listing.updateMany({
    where: { userId, user: { role: { not: 'ADMIN' } } },
    data: { tier, tierExpiresAt: null, requestedTier: null },
  });
  if (opts.clearPlacements) {
    await prisma.listing.updateMany({
      where: {
        userId,
        user: { role: { not: 'ADMIN' } },
        placement: { in: ['LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE'] },
      },
      data: { placement: 'NONE', placementExpiresAt: null },
    });
  }
  return result.count;
}

/**
 * Everything that happens when a store's subscription ends (expiry or
 * cancellation): the store page is frozen (isActive false), the unlimited
 * listing subscription granted with the rental lapses, and every listing
 * drops back to the FREE tier and loses store-only zone placements — so the
 * owner is, in practice, an ordinary user again until they renew. Their
 * Role and all existing listings/data are deliberately left untouched;
 * they can keep using every ordinary-user feature meanwhile. Idempotent.
 */
export async function downgradeStoreAfterRentalEnds(userId: string, rentalId: string, reason: 'expired' | 'cancelled'): Promise<void> {
  await prisma.store.updateMany({ where: { userId }, data: { isActive: false } });
  await prisma.sellerSubscription.updateMany({
    where: { userId, status: 'ACTIVE', package: { scope: 'LISTING' } },
    data: { status: 'EXPIRED' },
  });
  await syncStoreListingsTier(userId, 'FREE', { clearPlacements: true });
  await prisma.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title: 'Store Deactivated',
      message: `Your store subscription has ${reason === 'expired' ? 'expired' : 'been cancelled'} and your store page is paused. Your existing listings stay online, and you can keep posting as an ordinary user — renew your store subscription any time to restore the Store Dashboard and your tier.`,
      data: { rentalId },
    },
  }).catch(() => {});
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

    const shouldExpire = latestRental.status === 'ACTIVE' && latestRental.endDate <= now;
    const rental = shouldExpire
      ? await prisma.storeRental.update({
          where: { id: latestRental.id },
          data: { status: 'EXPIRED' },
        })
      : latestRental;
    // The scheduled job (expireOverdueStoreRentals, see index.ts) normally
    // gets to an expired rental first; this covers the window before its
    // next run so the owner never sees a stale "active" store.
    if (shouldExpire) {
      await downgradeStoreAfterRentalEnds(latestRental.userId, latestRental.id, 'expired')
        .catch((e) => console.error('Failed to downgrade store after lazy expiry', e));
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
        currency: tierPrice.currency as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD',
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

    const updated = await prisma.storeRental.update({
      where: { id: rental.id },
      data: { placements },
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
    const { status, fee, endDate, maxListings, tier: tierRaw } = req.body;
    const existing = await prisma.storeRental.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, role: true, isKycVerified: true } } },
    });
    if (!existing) return next(createError('Rental not found', 404));

    const newTier = tierRaw !== undefined ? String(tierRaw).toUpperCase() as StoreTier : undefined;
    if (newTier && !STORE_TIERS.includes(newTier)) {
      return next(createError('tier must be FREE, GOLD, or PLATINUM', 400));
    }

    const validStatuses = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
    if (status && !validStatuses.includes(status.toUpperCase())) {
      return next(createError('Invalid status', 400));
    }

    const newStatus = status ? status.toUpperCase() as 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' : undefined;

    // A store can't be fully activated until ID verification has passed —
    // KYC is part of the store application, not an optional extra. Checked
    // before anything is written so a blocked approval leaves the rental
    // exactly as it was (still PENDING, still in the queue).
    if (newStatus === 'ACTIVE' && existing.status !== 'ACTIVE' && !existing.user.isKycVerified) {
      return next(createError('This applicant has not passed ID verification yet. Approve their KYC first — a store cannot be activated until it does.', 400));
    }

    const updated = await prisma.storeRental.update({
      where: { id: req.params.id },
      data: {
        ...(newStatus && { status: newStatus }),
        ...(newTier && { tier: newTier }),
        ...(fee !== undefined && { fee: Number(fee) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(maxListings !== undefined && { maxListings: Number(maxListings) }),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // ── When a rental is APPROVED (ACTIVE): grant store owner unlimited listing access ──
    // This removes the subscription requirement: store owners who paid the store fee
    // ($100 USD) should not need a separate listing subscription.
    if (newStatus === 'ACTIVE' && existing.status !== 'ACTIVE') {
      const userId = existing.userId;

      // Ensure the user has the correct seller role
      const sellerRoles = ['AGENT', 'COMPANY', 'ORGANIZATION', 'SELLER'];
      if (!sellerRoles.includes(existing.user.role) && existing.user.role !== 'ADMIN') {
        const targetRole = sellerRoles.includes(existing.entityType) ? existing.entityType : 'AGENT';
        await prisma.user.update({
          where: { id: userId },
          data: { role: targetRole as 'AGENT' | 'COMPANY' | 'ORGANIZATION' | 'SELLER' },
        });
      }

      // Find or create an unlimited/store listing package
      let storePkg = await prisma.sellerPackage.findFirst({
        where: { scope: 'LISTING', isFree: false, maxListings: null, isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      // If no unlimited package exists, create one specifically for store owners
      if (!storePkg) {
        storePkg = await prisma.sellerPackage.create({
          data: {
            name: 'Store Owner — Unlimited Listings',
            description: 'Granted automatically to approved store owners. Includes unlimited listings for the duration of their store rental.',
            scope: 'LISTING',
            isFree: false,
            price: 0,
            currency: 'UGX',
            durationDays: 3650, // 10 years — effectively permanent
            maxListings: null,   // null = unlimited
            isActive: true,
          },
        });
      }

      // Cancel any existing listing subscriptions to avoid conflicts
      await prisma.sellerSubscription.updateMany({
        where: { userId, status: 'ACTIVE', package: { scope: 'LISTING' } },
        data: { status: 'EXPIRED' },
      });

      // Grant a new unlimited subscription tied to the store rental end date
      const rentalEndDate = endDate ? new Date(endDate) : existing.endDate;
      await prisma.sellerSubscription.create({
        data: {
          userId,
          packageId: storePkg.id,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: rentalEndDate,
        },
      });

      // Notify the store owner
      await prisma.notification.create({
        data: {
          userId,
          type: 'SUBSCRIPTION_ACTIVATED',
          title: '🎉 Your Store is Now Active!',
          message: `Congratulations! Your store has been approved. You can now list up to ${existing.maxListings} active listings — no additional subscription required.`,
          data: { rentalId: existing.id },
        },
      }).catch(() => {});

      // Provision a Store record if it doesn't exist yet
      const existingStore = await prisma.store.findUnique({ where: { userId } });
      if (!existingStore) {
        const placementsData = (existing.placements as Record<string, unknown> | null) || {};
        const providedName = typeof placementsData.storeName === 'string' ? placementsData.storeName.trim() : '';
        const providedDescription = typeof placementsData.storeDescription === 'string' ? placementsData.storeDescription.trim() : '';

        const baseName = providedName || existing.user.name || 'My Store';
        const baseSlug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + userId.slice(0, 6);

        // Guarantee slug uniqueness — try base slug, then append -2, -3, etc.
        let finalSlug = baseSlug;
        let attempt = 1;
        while (await prisma.store.findUnique({ where: { slug: finalSlug } })) {
          attempt++;
          finalSlug = `${baseSlug}-${attempt}`;
        }

        await prisma.store.create({
          data: {
            userId,
            name: baseName,
            slug: finalSlug,
            description: providedDescription || null,
            isActive: true,
          },
        });
      } else if (!existingStore.isActive) {
        // Re-activate the store if it was previously deactivated
        await prisma.store.update({
          where: { userId },
          data: { isActive: true },
        });
      }
    }

    // ── Tier cascade: an ACTIVE store's tier is what its listings render at ──
    // Runs when the rental becomes ACTIVE (approval/renewal) or when an
    // already-ACTIVE rental's tier is changed. Never for a rental that is
    // ending — that's the downgrade path just below.
    const rentalIsEndingNow = newStatus === 'CANCELLED' || newStatus === 'EXPIRED';
    if (!rentalIsEndingNow && updated.status === 'ACTIVE' && (newStatus === 'ACTIVE' || newTier)) {
      await syncStoreListingsTier(existing.userId, updated.tier);
    }

    // ── When a rental is CANCELLED/EXPIRED: freeze the store, drop to FREE tier ──
    if (rentalIsEndingNow && existing.status === 'ACTIVE') {
      await downgradeStoreAfterRentalEnds(existing.userId, existing.id, newStatus === 'CANCELLED' ? 'cancelled' : 'expired');
    }

    res.json({ rental: updated });
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
    const existing = await prisma.storeRental.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Rental not found', 404));

    const pending = (existing.placements as Record<string, unknown> | null)?.pendingRenewal as
      | { plan: string; tier: StoreTier; newEndDate: string; fee: number; currency: string }
      | undefined;
    if (!pending) return next(createError('This rental has no pending renewal to confirm', 400));

    const updated = await prisma.storeRental.update({
      where: { id: existing.id },
      data: {
        tier: pending.tier,
        fee: pending.fee,
        currency: pending.currency as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD',
        endDate: new Date(pending.newEndDate),
        status: 'ACTIVE',
        renewalReminderSentAt: null,
        placements: { ...(existing.placements as Record<string, unknown>), subscriptionPlan: pending.plan, paymentStatus: 'CONFIRMED', pendingRenewal: null },
      },
    });

    await prisma.store.updateMany({ where: { userId: existing.userId }, data: { isActive: true } });
    await syncStoreListingsTier(existing.userId, pending.tier);
    await prisma.notification.create({
      data: {
        userId: existing.userId,
        type: 'SYSTEM',
        title: 'Store Renewal Confirmed',
        message: `Your store renewal has been confirmed — active until ${new Date(pending.newEndDate).toLocaleDateString()}.`,
        data: { rentalId: existing.id },
      },
    }).catch(() => {});

    res.json({ rental: updated });
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
 * Scheduled sweep (registered in src/index.ts): finds ACTIVE store rentals
 * whose endDate has passed, marks them EXPIRED, and runs the same downgrade
 * a manual expiry does — so a lapsed store is frozen and its listings drop
 * out of premium tiers promptly, not only whenever the owner next opens
 * their own dashboard (the only other place expiry was noticed before).
 * Admin accounts are never affected: they are excluded outright.
 */
export async function expireOverdueStoreRentals(): Promise<void> {
  const overdue = await prisma.storeRental.findMany({
    where: { status: 'ACTIVE', endDate: { lte: new Date() }, user: { role: { not: 'ADMIN' } } },
    select: { id: true, userId: true },
  });
  for (const rental of overdue) {
    try {
      await prisma.storeRental.update({ where: { id: rental.id }, data: { status: 'EXPIRED' } });
      await downgradeStoreAfterRentalEnds(rental.userId, rental.id, 'expired');
    } catch (err) {
      console.error(`Failed to expire store rental ${rental.id}`, err);
    }
  }
}

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
