import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { sendStoreRenewalReminderEmail } from '../utils/email';

const router = Router();

import {
  StoreTier, syncStoreListingsTier, applyRentalUpdate, confirmPendingRenewal, expireStoreRental,
  MAX_STORE_LISTINGS, renewalWindowDays,
} from '../utils/storeRentalService';
// Kept as re-exports so existing importers (index.ts, other routes) keep working.
export { syncStoreListingsTier, downgradeStoreAfterRentalEnds, expireOverdueStoreRentals } from '../utils/storeRentalService';

// Webstore plans are admin-managed packages (Admin → Packages, scope "Webstore"). Nothing about a
// plan's price, length, listing cap or tier is defined in code: it is read from the package the
// applicant picks, and copied onto the rental so later package edits never change a running store.
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadStorePackage(packageId: unknown) {
  if (typeof packageId !== 'string' || !packageId) throw createError('packageId is required — choose a Webstore package', 400);
  const pkg = await prisma.sellerPackage.findUnique({ where: { id: packageId } });
  if (!pkg || pkg.scope !== 'STORE' || !pkg.isActive) throw createError('That Webstore package is not available', 404);
  return pkg;
}

function storeTerms(pkg: { isFree: boolean; price: number; currency: string; storeTier: string | null; durationDays: number; maxListings: number | null; id: string; name: string }) {
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    fee: pkg.isFree ? 0 : pkg.price,
    currency: pkg.currency,
    tier: (pkg.storeTier ?? 'FREE') as StoreTier,
    durationDays: pkg.durationDays,
    maxListings: pkg.maxListings ?? MAX_STORE_LISTINGS,
  };
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
/**
 * Self-serve renewal — extends the SAME rental row a store owner already
 * has (active, or recently lapsed and frozen), rather than filing a brand
 * new application. This is deliberately separate from POST / above (which
 * still handles first-time applications and their full admin review): a
 * renewal is the same already-approved store just paying to continue, so
 * it doesn't need a fresh KYC/content review, only payment confirmation
 * for a paid tier — and the store is never frozen or interrupted while
 * that confirmation is pending (see the two branches below).
 *   body: { packageId? } — defaults to the package the store is already on. Price, length and
 *   tier all come from that package.
 */
router.post('/renew', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!rental) {
      return next(createError('No existing store found to renew — apply for a new store instead', 404));
    }

    const chosenId = req.body?.packageId ?? rental.packageId;
    if (!chosenId) return next(createError('Choose a Webstore package to renew with', 400));
    const pkg = await loadStorePackage(chosenId);
    if (pkg.isFree) return next(createError('A free package cannot be renewed. Choose a paid Webstore package.', 400));
    const t = storeTerms(pkg);

    // Renewing early doesn't waste the days already paid for — the new period starts from the
    // current endDate (or now, if already lapsed), never from today outright.
    const base = rental.endDate > new Date() ? rental.endDate : new Date();
    const newEndDate = new Date(base.getTime() + t.durationDays * DAY_MS);
    const existingPlacements = (rental.placements as Record<string, unknown>) || {};

    // The store keeps running exactly as it is — status, endDate, tier — until an admin confirms
    // payment (PATCH /admin/:id/confirm-renewal). The request is recorded with the package's terms.
    const updated = await prisma.storeRental.update({
      where: { id: rental.id },
      data: {
        placements: {
          ...existingPlacements,
          pendingRenewal: {
            plan: t.packageName, packageId: t.packageId, packageName: t.packageName, tier: t.tier,
            durationDays: t.durationDays, maxListings: t.maxListings,
            newEndDate: newEndDate.toISOString(), fee: t.fee, currency: t.currency, requestedAt: new Date().toISOString(),
          },
        },
      },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(admins.map((a) => prisma.notification.create({
      data: {
        userId: a.id,
        type: 'SYSTEM',
        title: 'Store Renewal Pending Payment',
        message: `A store owner requested to renew with "${t.packageName}" — confirm payment to apply it.`,
        data: { rentalId: rental.id },
      },
    }).catch(() => {})));

    res.json({ rental: updated, requiresPayment: true, fee: t.fee, currency: t.currency });
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
    const { entityType, packageId, placements } = req.body;
    const currentRole = req.user!.role;

    // Determine the effective entity type the user wants to register as
    const validEntityTypes = ['USER', 'AGENT', 'COMPANY', 'ORGANIZATION'];
    const rawEntityType = (entityType || currentRole || 'AGENT').toUpperCase();
    // Default USER-role registrants to AGENT unless they specified something else
    const et = rawEntityType === 'USER' ? 'AGENT' : rawEntityType;
    if (!validEntityTypes.includes(et)) {
      return next(createError('Invalid entityType', 400));
    }

    const pkg = await loadStorePackage(packageId);
    const terms = storeTerms(pkg);

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

    // Webstore applicants must already have submitted KYC (form + documents) so the admin has what they
    // need to review; activation itself still requires it to be APPROVED (see planRentalUpdate).
    const kyc = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { kycStatus: true } });
    if (currentRole !== 'ADMIN' && kyc?.kycStatus !== 'PENDING' && kyc?.kycStatus !== 'APPROVED') {
      return next(createError(
        kyc?.kycStatus === 'REJECTED'
          ? 'Your KYC verification was rejected. Resubmit it with the corrected details and documents before applying for a Webstore.'
          : 'KYC verification is required before you can apply for a Webstore. Complete the short form and upload your documents first.',
        403,
      ));
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

    // A free package is a one-time offer per account, otherwise "free" could be chained forever.
    if (pkg.isFree) {
      const usedFree = await prisma.storeRental.findFirst({ where: { userId: req.user!.userId, packageId: pkg.id }, select: { id: true } });
      if (usedFree) return next(createError('You have already used this free package. Choose a paid Webstore package.', 409));
    }

    const end = new Date(now.getTime() + terms.durationDays * DAY_MS);

    const rental = await prisma.storeRental.create({
      data: {
        userId: req.user!.userId,
        entityType: et as 'USER' | 'AGENT' | 'COMPANY' | 'ORGANIZATION',
        tier: terms.tier,
        fee: terms.fee,
        currency: terms.currency as 'UGX',
        startDate: now,
        endDate: end,
        maxListings: terms.maxListings,
        packageId: terms.packageId,
        packageName: terms.packageName,
        durationDays: terms.durationDays,
        placements: {
          ...(placements || {}),
          subscriptionPlan: terms.packageName,
          paymentStatus: terms.fee === 0 ? 'WAIVED' : 'PENDING',
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
          message: `A user applied for the "${terms.packageName}" Webstore package.`,
          data: { rentalId: rental.id, userId: req.user!.userId, packageId: terms.packageId },
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
 * entered its package's renewal window (10% of the package length, 1–30 days — see
 * renewalWindowDays) and hasn't been reminded for
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
      if (!(rental.fee > 0)) continue; // free packages don't renew, so they get no reminder
      const length = rental.durationDays ?? Math.max(1, Math.round((rental.endDate.getTime() - rental.startDate.getTime()) / DAY_MS));
      const planName = rental.packageName || 'Webstore';

      const daysRemaining = Math.ceil((rental.endDate.getTime() - now.getTime()) / DAY_MS);
      if (daysRemaining < 0 || daysRemaining > renewalWindowDays(length)) continue;

      const storeName = (await prisma.store.findFirst({ where: { userId: rental.userId }, select: { name: true } }))?.name || 'your store';
      await sendStoreRenewalReminderEmail(
        rental.user.email, rental.user.name, storeName,
        rental.tier as StoreTier, planName, Math.max(daysRemaining, 0), rental.endDate,
      );
      await prisma.storeRental.update({ where: { id: rental.id }, data: { renewalReminderSentAt: now } });
    } catch (err) {
      console.error(`Failed to send renewal reminder for store rental ${rental.id}`, err);
    }
  }
}

export default router;
