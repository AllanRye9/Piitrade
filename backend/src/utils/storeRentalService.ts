/**
 * storeRentalService.ts — what "the admin set this store to Active" actually does.
 *
 * Before: PATCH /store-rentals/admin/:id wrote the rental row and then, as a chain of separate
 * un-transacted writes, granted the role, a listing subscription, the Store record and the
 * tier cascade. If anything after the first write failed (or two admins clicked at once) the
 * rental read ACTIVE while the owner had no store, no subscription or the wrong tier — and the
 * request still looked half-successful. Activating a rental whose end date had already passed
 * "worked" for a moment and was then undone by the next hourly expiry sweep. The expiry sweep
 * itself marked a rental EXPIRED *before* freezing the store, so a failure in between left a
 * lapsed store online forever (it was never ACTIVE again, so never retried).
 *
 * Now every state change is ONE transaction, serialised per rental with a row lock:
 *
 *   ACTIVE  → rental row + seller role + store listing-subscription + Store record (created or
 *             re-opened) + tier cascade onto the owner's listings + notification, together.
 *   ending  → (EXPIRED / CANCELLED / PENDING) rental row + store frozen + listing-subscription
 *             ended + tier reset and zone placements released + notification, together.
 *
 * Everything is idempotent: re-activating an already-ACTIVE rental repairs whatever is missing,
 * and the downgrade can be run twice harmlessly. Access checks elsewhere (listing cap, store
 * editing) already read the rental's dates at request time, so the change is enforced the
 * moment the transaction commits; the sweep only keeps stored flags in step.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { createError } from '../middleware/errorHandler';
import { invalidateAccountStatus } from '../middleware/auth';
import { loadListingEntitlement, STORE_OWNER_PACKAGE_NAME } from './subscriptionService';
import { logger } from './logger';

export type StoreTier = 'FREE' | 'GOLD' | 'PLATINUM';
export const STORE_TIERS: StoreTier[] = ['FREE', 'GOLD', 'PLATINUM'];
export type RentalStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
export const RENTAL_STATUSES: RentalStatus[] = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'];

type Db = typeof prisma | Prisma.TransactionClient;

const SELLER_ROLES = ['AGENT', 'COMPANY', 'ORGANIZATION', 'SELLER'];

// ─────────────────────────────── PURE PLANNER ───────────────────────────────

export interface RentalSnapshot {
  status: RentalStatus;
  endDate: Date;
  tier: StoreTier;
  fee: number;
  maxListings: number;
}

export interface RentalUpdateInput {
  status?: unknown;
  tier?: unknown;
  fee?: unknown;
  endDate?: unknown;
  maxListings?: unknown;
}

export type RentalPlan =
  | { ok: false; httpStatus: number; message: string }
  | {
      ok: true;
      data: { status: RentalStatus; tier: StoreTier; fee: number; endDate: Date; maxListings: number };
      /** The rental is ACTIVE after this update (whether or not it was before). */
      finalActive: boolean;
      /** It was not ACTIVE before and is now — announce, reset the reminder flag. */
      activating: boolean;
      /** It was ACTIVE and no longer is — freeze the store. */
      ending: boolean;
    };

/**
 * Validate an admin update and decide what it implies. Pure: the same inputs always give the same
 * plan, nothing is written. `kycVerified` is the applicant's ID-verification state.
 */
export function planRentalUpdate(
  existing: RentalSnapshot,
  input: RentalUpdateInput,
  ctx: { now: Date; kycVerified: boolean },
): RentalPlan {
  const fail = (message: string, httpStatus = 400): RentalPlan => ({ ok: false, httpStatus, message });

  let status: RentalStatus = existing.status;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    const s = typeof input.status === 'string' ? input.status.toUpperCase() : '';
    if (!RENTAL_STATUSES.includes(s as RentalStatus)) return fail('Invalid status');
    status = s as RentalStatus;
  }

  let tier: StoreTier = existing.tier;
  if (input.tier !== undefined && input.tier !== null && input.tier !== '') {
    const t = typeof input.tier === 'string' ? input.tier.toUpperCase() : '';
    if (!STORE_TIERS.includes(t as StoreTier)) return fail('tier must be FREE, GOLD, or PLATINUM');
    tier = t as StoreTier;
  }

  let fee = existing.fee;
  if (input.fee !== undefined && input.fee !== null && input.fee !== '') {
    const n = Number(input.fee);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return fail('fee must be a non-negative number');
    fee = n;
  }

  let maxListings = existing.maxListings;
  if (input.maxListings !== undefined && input.maxListings !== null && input.maxListings !== '') {
    const n = Number(input.maxListings);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) return fail('maxListings must be a whole number between 0 and 100000');
    maxListings = n;
  }

  let endDate = existing.endDate;
  if (input.endDate !== undefined && input.endDate !== null && input.endDate !== '') {
    const d = new Date(input.endDate as string);
    if (Number.isNaN(d.getTime())) return fail('endDate is not a valid date');
    endDate = d;
  }

  const wasActive = existing.status === 'ACTIVE';
  const finalActive = status === 'ACTIVE';

  if (finalActive && !wasActive && !ctx.kycVerified) {
    return fail('This applicant has not passed ID verification yet. Approve their KYC first — a store cannot be activated until it does.');
  }
  if (finalActive && endDate.getTime() <= ctx.now.getTime()) {
    // Otherwise the store would flip to ACTIVE and be frozen again by the next expiry sweep.
    return fail('The rental end date has already passed. Set a new end date in the future to activate this store.');
  }

  return {
    ok: true,
    data: { status, tier, fee, endDate, maxListings },
    finalActive,
    activating: finalActive && !wasActive,
    ending: wasActive && !finalActive,
  };
}

// ─────────────────────────────── CASCADES ───────────────────────────────

/**
 * Sets `tier` on every non-admin listing a store owner has, so a store's subscription tier is what
 * its listings render at. With `clearPlacements` the two store-assignable zones are released too
 * (Flash Deals are admin-curated and never touched). Listing *status* is never changed.
 */
export async function syncStoreListingsTier(
  userId: string,
  tier: StoreTier,
  opts: { clearPlacements?: boolean } = {},
  db: Db = prisma,
): Promise<number> {
  const result = await db.listing.updateMany({
    where: { userId, user: { role: { not: 'ADMIN' } } },
    data: { tier, tierExpiresAt: null, requestedTier: null },
  });
  if (opts.clearPlacements) {
    await db.listing.updateMany({
      where: { userId, user: { role: { not: 'ADMIN' } }, placement: { in: ['LATEST_COLLECTIONS', 'FEATURED_DEAL'] } },
      data: { placement: 'NONE', placementExpiresAt: null },
    });
  }
  return result.count;
}

/**
 * Everything that happens when a store stops being operational: the store page is frozen, the
 * listing subscription granted with the rental ends, listings drop to FREE and lose store-only
 * zones. Role and listings are left alone — the owner becomes an ordinary user. Idempotent.
 */
export async function downgradeStoreAfterRentalEnds(
  userId: string,
  rentalId: string,
  reason: 'expired' | 'cancelled' | 'suspended',
  db: Db = prisma,
): Promise<void> {
  await db.store.updateMany({ where: { userId }, data: { isActive: false } });
  await db.sellerSubscription.updateMany({
    where: { userId, status: 'ACTIVE', package: { scope: 'LISTING', name: STORE_OWNER_PACKAGE_NAME } },
    data: { status: reason === 'cancelled' ? 'CANCELLED' : 'EXPIRED', ...(reason === 'cancelled' ? { cancelledAt: new Date() } : {}) },
  });
  await syncStoreListingsTier(userId, 'FREE', { clearPlacements: true }, db);
  const verb = reason === 'expired' ? 'expired' : reason === 'cancelled' ? 'been cancelled' : 'been suspended pending review';
  await db.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title: 'Store Deactivated',
      message: `Your store subscription has ${verb} and your store page is paused. Your existing listings stay online, but store features and premium placement are switched off until it is renewed.`,
      data: { rentalId } as Prisma.InputJsonValue,
    },
  });
}

async function findOrCreateStorePackage(db: Db) {
  const existing = await db.sellerPackage.findFirst({ where: { scope: 'LISTING', name: STORE_OWNER_PACKAGE_NAME } });
  if (existing) return existing;
  // A dedicated zero-price package. (Previously ANY unlimited paid package was reused, which made
  // the admin Transactions report count that package's price as revenue for every approved store.)
  return db.sellerPackage.create({
    data: {
      name: STORE_OWNER_PACKAGE_NAME,
      description: 'Granted automatically to approved store owners for the duration of their store rental.',
      scope: 'LISTING', isFree: false, price: 0, currency: 'UGX', durationDays: 3650, maxListings: null, isActive: false,
    },
  });
}

async function createStoreWithUniqueSlug(db: Db, userId: string, name: string, description: string | null) {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'store') + '-' + userId.slice(0, 6);
  for (let attempt = 1; attempt <= 8; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    if (await db.store.findUnique({ where: { slug }, select: { id: true } })) continue;
    return db.store.create({ data: { userId, name, slug, description, isActive: true } });
  }
  throw createError('Could not allocate a unique store address. Please try again.', 409);
}

type RentalRow = { id: string; userId: string; entityType: string; tier: StoreTier | string; endDate: Date; maxListings: number; placements: Prisma.JsonValue };

/**
 * Make an ACTIVE rental fully operational. Safe to call repeatedly: it repairs whatever is missing
 * (role, subscription, Store record, tier) and does not duplicate anything.
 */
export async function ensureStoreOperational(
  tx: Prisma.TransactionClient,
  rental: RentalRow,
  user: { id: string; name: string | null; role: string },
  opts: { announce: boolean },
) {
  const userId = rental.userId;

  // 1. Permissions: a store owner needs a seller role.
  if (user.role !== 'ADMIN' && !SELLER_ROLES.includes(user.role)) {
    const target = SELLER_ROLES.includes(rental.entityType) ? rental.entityType : 'AGENT';
    await tx.user.update({ where: { id: userId }, data: { role: target as 'AGENT' | 'COMPANY' | 'ORGANIZATION' | 'SELLER' } });
  }

  // 2. Listing access: one internal subscription tied to the rental's end date. The owner's OTHER
  //    subscriptions are left alone — entitlement resolution prefers the store while it is live, and
  //    anything the user paid for separately is still theirs when the store lapses.
  const pkg = await findOrCreateStorePackage(tx);
  const mine = await tx.sellerSubscription.findFirst({ where: { userId, status: 'ACTIVE', packageId: pkg.id } });
  if (mine) {
    await tx.sellerSubscription.update({ where: { id: mine.id }, data: { endDate: rental.endDate } });
  } else {
    await tx.sellerSubscription.create({
      data: { userId, packageId: pkg.id, status: 'ACTIVE', startDate: new Date(), endDate: rental.endDate },
    });
  }

  // 3. Visibility: the Store record exists and is open.
  let store = await tx.store.findUnique({ where: { userId } });
  if (!store) {
    const meta = (rental.placements as Record<string, unknown> | null) || {};
    const name = (typeof meta.storeName === 'string' && meta.storeName.trim()) || user.name || 'My Store';
    const description = typeof meta.storeDescription === 'string' && meta.storeDescription.trim() ? meta.storeDescription.trim() : null;
    store = await createStoreWithUniqueSlug(tx, userId, name, description);
  } else if (!store.isActive) {
    store = await tx.store.update({ where: { userId }, data: { isActive: true } });
  }

  // 4. Listings: render at the store's tier.
  const listingsUpdated = await syncStoreListingsTier(userId, rental.tier as StoreTier, {}, tx);

  // 5. Tell the owner (only on the actual transition, not on a repair run).
  if (opts.announce) {
    await tx.notification.create({
      data: {
        userId,
        type: 'SUBSCRIPTION_ACTIVATED',
        title: '🎉 Your Store is Now Active!',
        message: `Your store has been approved and is live until ${rental.endDate.toLocaleDateString()}. You can now keep up to ${rental.maxListings} active listings.`,
        data: { rentalId: rental.id } as Prisma.InputJsonValue,
      },
    });
  }
  return { store, listingsUpdated };
}

// ─────────────────────────────── ADMIN UPDATE ───────────────────────────────

const rentalInclude = { user: { select: { id: true, name: true, email: true, role: true, isKycVerified: true } } } as const;

/**
 * Apply an admin's change to a rental atomically and return the fully-resolved operational state.
 * Throws createError() with the right HTTP status for validation problems.
 */
export async function applyRentalUpdate(rentalId: string, input: RentalUpdateInput, now = new Date()) {
  const out = await prisma.$transaction(async (tx) => {
    // Serialise concurrent admin actions on the same rental (a second click waits, then re-plans).
    await tx.$queryRaw`SELECT "id" FROM "StoreRental" WHERE "id" = ${rentalId} FOR UPDATE`;
    const existing = await tx.storeRental.findUnique({ where: { id: rentalId }, include: rentalInclude });
    if (!existing) throw createError('Rental not found', 404);

    const plan = planRentalUpdate(
      { status: existing.status as RentalStatus, endDate: existing.endDate, tier: existing.tier as StoreTier, fee: existing.fee, maxListings: existing.maxListings },
      input,
      { now, kycVerified: existing.user.isKycVerified },
    );
    if (plan.ok === false) throw createError(plan.message, plan.httpStatus);

    const rental = await tx.storeRental.update({
      where: { id: rentalId },
      data: { ...plan.data, ...(plan.activating ? { renewalReminderSentAt: null } : {}) },
      include: rentalInclude,
    });

    let store: Awaited<ReturnType<typeof ensureStoreOperational>>['store'] | null = null;
    let listingsUpdated = 0;
    if (plan.finalActive) {
      const res = await ensureStoreOperational(tx, rental, existing.user, { announce: plan.activating });
      store = res.store;
      listingsUpdated = res.listingsUpdated;
    } else if (plan.ending) {
      const reason = plan.data.status === 'CANCELLED' ? 'cancelled' : plan.data.status === 'EXPIRED' ? 'expired' : 'suspended';
      await downgradeStoreAfterRentalEnds(rental.userId, rental.id, reason, tx);
    }
    return { rental, store, listingsUpdated, userId: rental.userId, activating: plan.activating, ending: plan.ending };
  }, { timeout: 20_000, maxWait: 10_000 });

  // The account's role may have changed: drop any cached account status so it applies instantly.
  invalidateAccountStatus(out.userId);
  const entitlement = await loadListingEntitlement(out.userId);
  return { ...out, entitlement };
}

/** Confirm a pending renewal payment (extends endDate/tier and re-opens the store) atomically. */
export async function confirmPendingRenewal(rentalId: string, now = new Date()) {
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StoreRental" WHERE "id" = ${rentalId} FOR UPDATE`;
    const existing = await tx.storeRental.findUnique({ where: { id: rentalId }, include: rentalInclude });
    if (!existing) throw createError('Rental not found', 404);
    const pending = (existing.placements as Record<string, unknown> | null)?.pendingRenewal as
      | { plan: string; tier: StoreTier; newEndDate: string; fee: number; currency: string } | undefined;
    if (!pending) throw createError('This rental has no pending renewal to confirm', 400);
    const newEnd = new Date(pending.newEndDate);
    if (Number.isNaN(newEnd.getTime()) || newEnd.getTime() <= now.getTime()) throw createError('The pending renewal has an invalid end date', 400);

    const rental = await tx.storeRental.update({
      where: { id: rentalId },
      data: {
        tier: pending.tier, fee: pending.fee, currency: pending.currency as 'UGX', endDate: newEnd, status: 'ACTIVE', renewalReminderSentAt: null,
        placements: { ...((existing.placements as Record<string, unknown>) || {}), subscriptionPlan: pending.plan, paymentStatus: 'CONFIRMED', pendingRenewal: null } as Prisma.InputJsonValue,
      },
      include: rentalInclude,
    });
    const { store } = await ensureStoreOperational(tx, rental, existing.user, { announce: false });
    await tx.notification.create({
      data: {
        userId: rental.userId, type: 'SYSTEM', title: 'Store Renewal Confirmed',
        message: `Your store renewal has been confirmed — active until ${newEnd.toLocaleDateString()}.`,
        data: { rentalId } as Prisma.InputJsonValue,
      },
    });
    return { rental, store, userId: rental.userId };
  }, { timeout: 20_000, maxWait: 10_000 });
  invalidateAccountStatus(out.userId);
  return out;
}

// ─────────────────────────────── EXPIRY ───────────────────────────────

/**
 * Expire one overdue rental: status and downgrade commit together (or not at all), and only the
 * caller whose conditional update actually flipped the row runs the downgrade.
 */
export async function expireStoreRental(rentalId: string, userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.storeRental.updateMany({ where: { id: rentalId, status: 'ACTIVE', endDate: { lte: new Date() } }, data: { status: 'EXPIRED' } });
    if (res.count !== 1) return false;
    await downgradeStoreAfterRentalEnds(userId, rentalId, 'expired', tx);
    return true;
  });
}

/**
 * Scheduled sweep: expire every overdue ACTIVE rental, then repair any store that is still open
 * although its owner has no live rental (e.g. left behind by an interrupted older expiry).
 * Admin accounts are never affected.
 */
export async function expireOverdueStoreRentals(): Promise<{ expired: number; repaired: number }> {
  const now = new Date();
  const overdue = await prisma.storeRental.findMany({
    where: { status: 'ACTIVE', endDate: { lte: now }, user: { role: { not: 'ADMIN' } } },
    select: { id: true, userId: true },
    take: 500,
  });
  let expired = 0;
  for (const r of overdue) {
    try {
      if (await expireStoreRental(r.id, r.userId)) {
        expired++;
        invalidateAccountStatus(r.userId);
      }
    } catch (err) {
      logger.error(`Failed to expire store rental ${r.id}`, err);
    }
  }
  const repaired = await prisma.store.updateMany({
    where: {
      isActive: true,
      user: { role: { not: 'ADMIN' }, storeRentals: { none: { status: 'ACTIVE', endDate: { gt: now } } } },
    },
    data: { isActive: false },
  });
  if (repaired.count > 0) logger.warn(`Store sweep: closed ${repaired.count} store(s) that had no live rental`);
  return { expired, repaired: repaired.count };
}
