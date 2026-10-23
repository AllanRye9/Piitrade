/**
 * subscriptionService.ts — the single place that decides what a subscription IS
 * right now and how it may change.
 *
 * Why this exists: subscription state used to be scattered. Status was flipped lazily
 * inside GET handlers (only for whoever happened to call them), the admin PUT allowed
 * any status -> any status with unvalidated dates, creation was race-prone (two quick
 * requests could both pass the "no active subscription" check), nothing renewed or
 * cancelled, and nothing enforced a package's listing cap. Everything now goes through
 * here:
 *
 *   • PURE rules (no database)  — status machine, term/renewal dates, "is it current right
 *     now", reminder window, and listing-entitlement resolution. Unit-tested.
 *   • DB operations             — subscribe / renew / activate / cancel / admin update, each
 *     in ONE transaction guarded by a per-user advisory lock, plus the scheduled sweeps.
 *
 * "Real time" means: access is decided from the dates at the moment of the request
 * (isCurrent), never from a status column that only a background job keeps fresh. The
 * sweep merely keeps the stored status, notifications and reminders in step.
 *
 * PACKAGE SNAPSHOTS: a subscription records the package's name, price, currency, duration and
 * listing cap at the moment it is requested (see packageSnapshot / termsOf). Everything that
 * follows — the entitlement, the admin approval screen, revenue — reads that snapshot, so an
 * admin editing a package changes what NEW subscribers get and never rewrites a running term.
 *
 * UPGRADES: moving to a longer/larger package is requested with requestUpgrade() in one of two
 * modes — AFTER_EXPIRY (the new term is chained to start the moment the current one ends) or
 * IMMEDIATE (the current term is cancelled when an admin confirms payment and the new one starts
 * at once). Nothing about the current plan changes until payment is confirmed.
 *
 * NOTE: nothing here touches User.isVerified. That flag is EMAIL confirmation (login is
 * refused without it), and the previous admin handler cleared it when a paid subscription
 * ended — locking the customer out of their own account.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { createError } from '../middleware/errorHandler';
import { logger } from './logger';

export type SubStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING_PAYMENT';
export type PackageScope = 'LISTING' | 'CV' | 'STORE';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Owners are reminded once when this many days (or fewer) remain. */
export const EXPIRY_REMINDER_DAYS = 3;
/** Internal package granted to approved store owners — never reminded/billed as a normal plan. */
export const STORE_OWNER_PACKAGE_NAME = 'Store Owner — Unlimited Listings';

type Db = typeof prisma | Prisma.TransactionClient;

// ─────────────────────────────── PURE RULES ───────────────────────────────

export interface SubLike { status: SubStatus | string; startDate: Date; endDate: Date }

/** True only while the subscription is ACTIVE *and* inside its term, evaluated at `now`. */
export function isCurrent(sub: SubLike, now: Date = new Date()): boolean {
  return sub.status === 'ACTIVE' && sub.startDate.getTime() <= now.getTime() && sub.endDate.getTime() > now.getTime();
}

/** The status the customer should be shown/held to at `now` (an ACTIVE row past its end is EXPIRED). */
export function effectiveStatus(sub: SubLike, now: Date = new Date()): SubStatus {
  if (sub.status === 'ACTIVE' && sub.endDate.getTime() <= now.getTime()) return 'EXPIRED';
  return sub.status as SubStatus;
}

/** Whole days left, rounded up; 0 once the term has ended. */
export function daysRemaining(endDate: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS));
}

const USER_TRANSITIONS: Record<SubStatus, SubStatus[]> = {
  PENDING_PAYMENT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
};

/**
 * May a subscription move `from` -> `to`? Same-status is always a no-op. Admins may also revive
 * an EXPIRED/CANCELLED subscription (e.g. a payment arrived late), but only with a future end date
 * — enforced by the caller.
 */
export function canTransition(from: SubStatus, to: SubStatus, asAdmin = false): boolean {
  if (from === to) return true;
  if (USER_TRANSITIONS[from]?.includes(to)) return true;
  return asAdmin && (from === 'EXPIRED' || from === 'CANCELLED') && to === 'ACTIVE';
}

/**
 * Term for a (re)newal: starts now, or — when the customer still has time left — right where the
 * current term ends, so renewing early never wastes paid days.
 */
export function computeTerm(now: Date, durationDays: number, currentEnd?: Date | null): { startDate: Date; endDate: Date } {
  const startDate = currentEnd && currentEnd.getTime() > now.getTime() ? new Date(currentEnd) : new Date(now);
  return { startDate, endDate: new Date(startDate.getTime() + durationDays * DAY_MS) };
}

export function needsReminder(
  sub: SubLike & { reminderSentAt: Date | null },
  pkg: { name: string },
  now: Date = new Date(),
): boolean {
  if (sub.status !== 'ACTIVE' || sub.reminderSentAt) return false;
  if (pkg.name === STORE_OWNER_PACKAGE_NAME) return false; // follows the store rental, which has its own reminder
  if (!isCurrent(sub, now)) return false;
  return daysRemaining(sub.endDate, now) <= EXPIRY_REMINDER_DAYS;
}

// ── Package snapshot & upgrade rules (pure) ──────────────────────────────────

/**
 * The ONLY case where a subscription is live without an admin confirming payment: the package is
 * ticked "Free" AND its price is 0. Everything else — CV packages included — starts
 * PENDING_PAYMENT, needs a payment reference, and is approved by an admin.
 */
export function startsActiveImmediately(pkg: { isFree: boolean; price: number }): boolean {
  return pkg.isFree === true && !(pkg.price > 0);
}

export type ChangeKind = 'NEW' | 'RENEWAL' | 'UPGRADE';
export type UpgradeMode = 'AFTER_EXPIRY' | 'IMMEDIATE';
export const UPGRADE_MODES: UpgradeMode[] = ['AFTER_EXPIRY', 'IMMEDIATE'];

export interface PackageLike {
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  maxListings: number | null;
  isFree?: boolean;
}

/** The terms a subscription is held to — always what was agreed, never the live package. */
export interface SubTerms {
  packageName: string;
  price: number;
  currency: string;
  durationDays: number;
  /** null = unlimited */
  maxListings: number | null;
}

/** The columns to store on a new subscription so it keeps the package exactly as it is now. */
export function packageSnapshot(pkg: PackageLike, now: Date = new Date()) {
  return {
    snapshotAt: now,
    packageName: pkg.name,
    pricePaid: pkg.price,
    currency: pkg.currency as 'UGX',
    durationDays: pkg.durationDays,
    maxListings: pkg.maxListings ?? null,
  };
}

export interface SnapshotFields {
  snapshotAt?: Date | null;
  packageName?: string | null;
  pricePaid?: number | null;
  currency?: string | null;
  durationDays?: number | null;
  maxListings?: number | null;
}

/** Snapshot if the row has one, otherwise (legacy / internal rows) the package it points at. */
export function termsOf(sub: SnapshotFields & { package: PackageLike }): SubTerms {
  if (sub.snapshotAt) {
    return {
      packageName: sub.packageName ?? sub.package.name,
      price: sub.pricePaid ?? sub.package.price,
      currency: sub.currency ?? sub.package.currency,
      durationDays: sub.durationDays ?? sub.package.durationDays,
      maxListings: sub.maxListings ?? null,
    };
  }
  return {
    packageName: sub.package.name,
    price: sub.package.price,
    currency: sub.package.currency,
    durationDays: sub.package.durationDays,
    maxListings: sub.package.maxListings ?? null,
  };
}

const capRank = (n: number | null) => (n === null ? Number.POSITIVE_INFINITY : n);

/**
 * Is `target` an upgrade of `current`? Longer duration is always one (7 → 30 days, 30 days → 1 year);
 * at equal-or-longer duration a bigger listing allowance or a higher tier price also counts.
 * A free package is never an upgrade, and neither is the same or a smaller one.
 */
export function isUpgrade(current: Pick<SubTerms, 'durationDays' | 'maxListings' | 'price'>, target: Pick<SubTerms, 'durationDays' | 'maxListings' | 'price'> & { isFree?: boolean }): boolean {
  if (target.isFree) return false;
  if (target.durationDays > current.durationDays) return true;
  if (target.durationDays < current.durationDays) return false;
  return capRank(target.maxListings) > capRank(current.maxListings) || target.price > current.price;
}

/**
 * Where an upgrade's term sits. AFTER_EXPIRY chains onto the current term's end (no paid days lost);
 * IMMEDIATE starts now. Both use the SNAPSHOT duration.
 */
export function computeUpgradeTerm(now: Date, mode: UpgradeMode, durationDays: number, currentEnd?: Date | null) {
  return mode === 'AFTER_EXPIRY' ? computeTerm(now, durationDays, currentEnd) : computeTerm(now, durationDays, null);
}

/** Does an approval request match the snapshot the admin was shown? Returns the list of mismatches. */
export function reviewMismatches(
  snapshot: SubTerms & { packageId: string },
  review: { packageId?: unknown; price?: unknown; currency?: unknown; durationDays?: unknown; maxListings?: unknown },
): string[] {
  const out: string[] = [];
  if (review.packageId !== snapshot.packageId) out.push('package');
  if (Number(review.price) !== snapshot.price) out.push('price');
  if (String(review.currency) !== snapshot.currency) out.push('currency');
  if (Number(review.durationDays) !== snapshot.durationDays) out.push('duration');
  const rl = review.maxListings === null || review.maxListings === undefined ? null : Number(review.maxListings);
  if (rl !== snapshot.maxListings) out.push('listing limit');
  return out;
}

export interface ListingEntitlement {
  source: 'STORE' | 'SUBSCRIPTION' | 'ORDINARY';
  /** null = unlimited */
  maxListings: number | null;
  /** When this entitlement lapses (null for the ordinary baseline). */
  expiresAt: Date | null;
  label: string;
}

/**
 * What may this account post right now? Best source wins in this order:
 *   1. an ACTIVE web-store rental (capped by the rental's maxListings),
 *   2. a current LISTING subscription (capped by the package's maxListings; null = unlimited),
 *   3. the ordinary-user baseline.
 */
export function resolveListingEntitlement(input: {
  rental: { status: string; endDate: Date; maxListings: number | null } | null;
  subscription: (SubLike & SnapshotFields & { package: PackageLike }) | null;
  ordinaryCap: number;
  now?: Date;
}): ListingEntitlement {
  const now = input.now ?? new Date();
  const { rental, subscription } = input;
  if (rental && rental.status === 'ACTIVE' && rental.endDate.getTime() > now.getTime()) {
    return { source: 'STORE', maxListings: rental.maxListings ?? null, expiresAt: rental.endDate, label: 'Web store' };
  }
  if (subscription && isCurrent(subscription, now)) {
    const t = termsOf(subscription);
    return { source: 'SUBSCRIPTION', maxListings: t.maxListings, expiresAt: subscription.endDate, label: t.packageName };
  }
  return { source: 'ORDINARY', maxListings: input.ordinaryCap, expiresAt: null, label: 'Ordinary account' };
}

export function ordinaryListingCap(): number {
  return Math.max(1, parseInt(process.env.ORDINARY_USER_MAX_LISTINGS || '10', 10) || 10);
}

// ─────────────────────────────── DB OPERATIONS ───────────────────────────────

async function lockUserScope(tx: Prisma.TransactionClient, userId: string, scope: string): Promise<void> {
  // Serialises concurrent subscribe/renew/activate calls for the same user+scope so the
  // "already has one?" check and the insert can't interleave.
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, which Prisma cannot
  // deserialize as a result column (P2010). We only need the side effect.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sub:${userId}:${scope}`}))`;
}

/** The subscription currently granting access for a scope (real time, from dates). */
export async function getCurrentSubscription(userId: string, scope: PackageScope, db: Db = prisma, now = new Date()) {
  return db.sellerSubscription.findFirst({
    where: { userId, status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now }, package: { scope } },
    include: { package: true },
    orderBy: { endDate: 'desc' },
  });
}

export async function loadListingEntitlement(userId: string, db: Db = prisma, now = new Date()): Promise<ListingEntitlement> {
  const [rental, subscription] = await Promise.all([
    db.storeRental.findFirst({
      where: { userId, status: 'ACTIVE', endDate: { gt: now } },
      orderBy: { endDate: 'desc' },
      select: { status: true, endDate: true, maxListings: true },
    }),
    getCurrentSubscription(userId, 'LISTING', db, now),
  ]);
  return resolveListingEntitlement({ rental, subscription, ordinaryCap: ordinaryListingCap(), now });
}

export interface SubscriptionView {
  id: string;
  status: SubStatus;
  /** Raw stored status — differs from `status` only in the seconds before the sweep runs. */
  storedStatus: string;
  isCurrent: boolean;
  /** ACTIVE (paid/approved) but its term has not begun yet — an upgrade queued behind the current plan. */
  isScheduled: boolean;
  daysRemaining: number;
  startDate: Date;
  endDate: Date;
  paymentRef: string | null;
  changeKind: string;
  upgradeMode: string | null;
  /** What this subscription is actually held to (snapshot, else package). */
  terms: SubTerms;
  package: unknown;
}

export function toSubscriptionView(
  sub: { id: string; status: string; startDate: Date; endDate: Date; paymentRef: string | null; package: PackageLike; changeKind?: string | null; upgradeMode?: string | null } & SnapshotFields,
  now = new Date(),
): SubscriptionView {
  return {
    id: sub.id,
    status: effectiveStatus(sub, now),
    storedStatus: sub.status,
    isCurrent: isCurrent(sub, now),
    isScheduled: sub.status === 'ACTIVE' && sub.startDate.getTime() > now.getTime(),
    daysRemaining: isCurrent(sub, now) ? daysRemaining(sub.endDate, now) : 0,
    startDate: sub.startDate,
    endDate: sub.endDate,
    paymentRef: sub.paymentRef,
    changeKind: sub.changeKind ?? 'NEW',
    upgradeMode: sub.upgradeMode ?? null,
    terms: termsOf(sub),
    package: sub.package,
  };
}

function cleanPaymentRef(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
    throw createError('paymentRef must be a short text reference', 400);
  }
  return value.trim();
}

async function notify(tx: Db, userId: string, type: 'SUBSCRIPTION_ACTIVATED' | 'SUBSCRIPTION_EXPIRED' | 'SUBSCRIPTION_PENDING' | 'SYSTEM', title: string, message: string, data: Record<string, unknown>) {
  await tx.notification.create({ data: { userId, type, title, message, data: data as Prisma.InputJsonValue } });
}

/** Subscriptions that are approved but have not started yet (an upgrade waiting for the current plan to end). */
async function getScheduledSubscription(userId: string, scope: PackageScope, db: Db, now: Date) {
  return db.sellerSubscription.findFirst({
    where: { userId, status: 'ACTIVE', startDate: { gt: now }, package: { scope } },
    include: { package: true },
    orderBy: { startDate: 'asc' },
  });
}

async function assertNoOutstandingChange(tx: Prisma.TransactionClient, userId: string, scope: PackageScope, now: Date) {
  const pending = await tx.sellerSubscription.findFirst({
    where: { userId, status: 'PENDING_PAYMENT', package: { scope } },
    select: { id: true },
  });
  if (pending) throw createError('You already have a subscription request awaiting payment confirmation. Cancel it first if you want to choose a different plan.', 409);
  const scheduled = await getScheduledSubscription(userId, scope, tx, now);
  if (scheduled) {
    throw createError(`You already have "${termsOf(scheduled).packageName}" scheduled to start on ${scheduled.startDate.toLocaleDateString()}. Cancel it first to choose a different plan.`, 409);
  }
}

/**
 * Create a subscription for `userId`. Only a package that is both ticked Free and priced at 0 starts
 * ACTIVE (see startsActiveImmediately); every paid package, CV ones included, starts PENDING_PAYMENT
 * and is activated by a confirmed MoMo payment, or, while MoMo is off, by an admin confirming the
 * payment reference. Someone who already has a current plan must use requestUpgrade / requestRenewal
 * instead.
 */
export async function subscribeToPackage(userId: string, packageId: string, rawPaymentRef: unknown, now = new Date()) {
  const paymentRef = cleanPaymentRef(rawPaymentRef);
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.sellerPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw createError('Package not found or inactive', 404);
    if (pkg.scope === 'STORE') throw createError('Webstore packages are chosen when you apply for a Webstore.', 400);
    if (!startsActiveImmediately(pkg) && !paymentRef) throw createError('paymentRef is required for paid packages', 400);

    await lockUserScope(tx, userId, pkg.scope);

    if (pkg.isFree) {
      // A free package is a one-time trial per account; without this a user could chain
      // "free" subscriptions forever.
      const usedFree = await tx.sellerSubscription.findFirst({
        where: { userId, package: { scope: pkg.scope, isFree: true } },
        select: { id: true },
      });
      if (usedFree) throw createError('You have already used a free package. Please choose a paid package.', 409);
    }

    const current = await getCurrentSubscription(userId, pkg.scope as PackageScope, tx, now);
    if (current) throw createError(`You already have an active ${pkg.scope.toLowerCase()} subscription. Choose "Upgrade" to move to a bigger package, or "Renew" to extend it.`, 409);
    await assertNoOutstandingChange(tx, userId, pkg.scope as PackageScope, now);

    const { startDate, endDate } = computeTerm(now, pkg.durationDays);
    const startsActive = startsActiveImmediately(pkg);
    const subscription = await tx.sellerSubscription.create({
      data: {
        userId, packageId, status: startsActive ? 'ACTIVE' : 'PENDING_PAYMENT', startDate, endDate, paymentRef,
        changeKind: 'NEW', ...packageSnapshot(pkg, now), ...(startsActive ? { approvedAt: now } : {}),
      },
      include: { package: true },
    });

    if (startsActive) {
      await notify(tx, userId, 'SUBSCRIPTION_ACTIVATED', 'Subscription Activated',
        `Your "${pkg.name}" package is now active until ${endDate.toLocaleDateString()}.`,
        { subscriptionId: subscription.id, packageName: pkg.name });
    } else {
      await notify(tx, userId, 'SUBSCRIPTION_PENDING', 'Subscription Pending Approval',
        `Your "${pkg.name}" subscription request has been received and is awaiting payment confirmation.`,
        { subscriptionId: subscription.id, packageName: pkg.name });
    }
    return { subscription, activated: startsActive };
  });
}

/** Ask to extend a paid subscription: creates a PENDING_PAYMENT term that an admin confirms. */
export async function requestRenewal(userId: string, subscriptionId: string, rawPaymentRef: unknown, now = new Date()) {
  const paymentRef = cleanPaymentRef(rawPaymentRef);
  if (!paymentRef) throw createError('paymentRef is required to renew', 400);
  return prisma.$transaction(async (tx) => {
    const base = await tx.sellerSubscription.findUnique({ where: { id: subscriptionId }, include: { package: true } });
    if (!base || base.userId !== userId) throw createError('Subscription not found', 404);
    if (base.package.isFree) throw createError('Free packages cannot be renewed. Choose a paid package instead.', 400);
    if (!base.package.isActive) throw createError('This package is no longer offered. Please choose another.', 409);
    if (base.status === 'CANCELLED' || base.status === 'PENDING_PAYMENT') throw createError('Only an active or expired subscription can be renewed', 409);

    await lockUserScope(tx, userId, base.package.scope);
    await assertNoOutstandingChange(tx, userId, base.package.scope as PackageScope, now);

    const current = await getCurrentSubscription(userId, base.package.scope as PackageScope, tx, now);
    // A renewal is quoted at the package's terms TODAY (the customer is paying today's price).
    const { startDate, endDate } = computeTerm(now, base.package.durationDays, current?.endDate);
    const subscription = await tx.sellerSubscription.create({
      data: {
        userId, packageId: base.packageId, status: 'PENDING_PAYMENT', startDate, endDate, paymentRef,
        changeKind: 'RENEWAL', replacesId: base.id, ...packageSnapshot(base.package, now),
      },
      include: { package: true },
    });
    await notify(tx, userId, 'SUBSCRIPTION_PENDING', 'Renewal Pending Confirmation',
      `Your renewal of "${base.package.name}" is awaiting payment confirmation.`,
      { subscriptionId: subscription.id, renewsSubscriptionId: base.id });
    return subscription;
  });
}

/**
 * Ask to move from the current plan to a bigger one.
 *   AFTER_EXPIRY — keep the current plan to its end; the new term starts the moment it ends.
 *   IMMEDIATE    — switch now: when an admin confirms payment the current plan is cancelled and the
 *                  new one starts at once (unused days of the old plan are not credited).
 * Either way the request is PENDING_PAYMENT and the current plan is untouched until it is approved.
 */
export async function requestUpgrade(userId: string, packageId: string, rawMode: unknown, rawPaymentRef: unknown, now = new Date()) {
  const mode = String(rawMode ?? '').toUpperCase() as UpgradeMode;
  if (!UPGRADE_MODES.includes(mode)) throw createError('mode must be AFTER_EXPIRY or IMMEDIATE', 400);
  const paymentRef = cleanPaymentRef(rawPaymentRef);
  if (!paymentRef) throw createError('paymentRef is required to upgrade', 400);

  return prisma.$transaction(async (tx) => {
    const target = await tx.sellerPackage.findUnique({ where: { id: packageId } });
    if (!target || !target.isActive) throw createError('Package not found or inactive', 404);
    if (target.isFree) throw createError('A free package is not an upgrade.', 400);
    const scope = target.scope as PackageScope;

    await lockUserScope(tx, userId, scope);
    const current = await getCurrentSubscription(userId, scope, tx, now);
    if (!current) throw createError('You have no active plan to upgrade. Choose a plan to subscribe instead.', 409);
    await assertNoOutstandingChange(tx, userId, scope, now);

    const cur = termsOf(current);
    if (current.packageId === target.id || !isUpgrade(cur, { ...target, maxListings: target.maxListings ?? null })) {
      throw createError('That package is not an upgrade of your current plan. Pick one with a longer duration or a higher allowance.', 400);
    }

    const { startDate, endDate } = computeUpgradeTerm(now, mode, target.durationDays, current.endDate);
    const subscription = await tx.sellerSubscription.create({
      data: {
        userId, packageId: target.id, status: 'PENDING_PAYMENT', startDate, endDate, paymentRef,
        changeKind: 'UPGRADE', upgradeMode: mode, replacesId: current.id, ...packageSnapshot(target, now),
      },
      include: { package: true },
    });
    await notify(tx, userId, 'SUBSCRIPTION_PENDING', 'Upgrade Pending Confirmation',
      mode === 'AFTER_EXPIRY'
        ? `Your upgrade to "${target.name}" is awaiting payment confirmation. It will start when "${cur.packageName}" ends on ${current.endDate.toLocaleDateString()}.`
        : `Your upgrade to "${target.name}" is awaiting payment confirmation. When it is confirmed it replaces "${cur.packageName}" immediately.`,
      { subscriptionId: subscription.id, upgradesSubscriptionId: current.id, mode });
    return subscription;
  });
}

/**
 * Owner cancels one of their own subscriptions — the running plan, a queued upgrade, or a request
 * still awaiting payment (there is no auto-renewal). Cancelling the RUNNING plan while an approved
 * upgrade is queued behind it makes that upgrade start now, so the customer never falls into a gap.
 */
export async function cancelOwnSubscription(userId: string, subscriptionId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.sellerSubscription.findUnique({ where: { id: subscriptionId }, include: { package: true } });
    if (!sub || sub.userId !== userId) throw createError('Subscription not found', 404);
    const status = effectiveStatus(sub, now);
    if (!canTransition(status, 'CANCELLED')) throw createError(`A ${status.toLowerCase().replace('_', ' ')} subscription cannot be cancelled`, 409);
    const wasRunning = isCurrent(sub, now);
    const res = await tx.sellerSubscription.updateMany({
      where: { id: sub.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    if (res.count === 0) throw createError('Subscription changed in the meantime — please refresh', 409);

    if (wasRunning) {
      await lockUserScope(tx, userId, sub.package.scope);
      const queued = await getScheduledSubscription(userId, sub.package.scope as PackageScope, tx, now);
      if (queued) {
        const t = termsOf(queued);
        await tx.sellerSubscription.update({
          where: { id: queued.id },
          data: { startDate: now, endDate: new Date(now.getTime() + t.durationDays * DAY_MS), reminderSentAt: null },
        });
        await notify(tx, userId, 'SUBSCRIPTION_ACTIVATED', 'Upgrade Started',
          `Your "${t.packageName}" plan has started now that "${termsOf(sub).packageName}" was cancelled.`, { subscriptionId: queued.id });
      }
    }
    await notify(tx, userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Cancelled',
      `Your "${termsOf(sub).packageName}" subscription has been cancelled.`, { subscriptionId: sub.id });
    return tx.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id }, include: { package: true } });
  });
}

export interface AdminSubscriptionInput {
  status?: unknown;
  endDate?: unknown;
  /** The package details the admin reviewed — REQUIRED to approve a PENDING_PAYMENT request. */
  review?: unknown;
  /** Why a request was declined (shown to the customer). */
  note?: unknown;
}

/**
 * Admin changes a subscription's status and/or end date. Validated against the status machine.
 *
 * APPROVING a PENDING_PAYMENT request (-> ACTIVE) is deliberately strict — it must carry the package
 * details the admin was shown (`review`), they must match what the customer requested (the snapshot),
 * a paid request must have its payment reference, and the term is computed from the snapshot, not the
 * live package. For an upgrade it either chains after the current term or replaces it, per the mode
 * the customer chose.
 */
export async function adminUpdateSubscription(
  subscriptionId: string,
  input: AdminSubscriptionInput,
  adminId: string | null = null,
  now = new Date(),
) {
  const allowed: SubStatus[] = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'];
  if (input.status !== undefined && !allowed.includes(input.status as SubStatus)) throw createError('Invalid status', 400);
  let endDate: Date | undefined;
  if (input.endDate !== undefined && input.endDate !== null) {
    endDate = new Date(input.endDate as string);
    if (Number.isNaN(endDate.getTime())) throw createError('endDate is not a valid date', 400);
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  return prisma.$transaction(async (tx) => {
    const sub = await tx.sellerSubscription.findUnique({
      where: { id: subscriptionId },
      include: { package: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!sub) throw createError('Subscription not found', 404);
    await lockUserScope(tx, sub.userId, sub.package.scope);

    const from = sub.status as SubStatus;
    const to = (input.status as SubStatus | undefined) ?? from;
    if (!canTransition(from, to, true)) throw createError(`Cannot change a ${from} subscription to ${to}`, 409);

    const terms = termsOf(sub);
    const scope = sub.package.scope as PackageScope;
    const data: Prisma.SellerSubscriptionUpdateInput = {};
    let activatedNow = false;
    let endedNow = false;
    let declinedNow = false;
    let replaced: { id: string; name: string } | null = null;

    if (to === 'ACTIVE' && from !== 'ACTIVE') {
      activatedNow = true;
      if (from === 'PENDING_PAYMENT') {
        // ── Approval gate: the package details must come with the approval ──────────
        if (!sub.snapshotAt) throw createError('This request has no package details recorded, so it cannot be approved. Cancel it and ask the customer to submit it again.', 409);
        if (terms.price > 0 && !sub.paymentRef) throw createError('This is a paid package but no payment reference was submitted — it cannot be approved.', 409);
        const review = input.review as Record<string, unknown> | undefined;
        if (!review || typeof review !== 'object') {
          throw createError('Approval must include the package details being approved (packageId, price, currency, durationDays, maxListings).', 400);
        }
        const bad = reviewMismatches({ ...terms, packageId: sub.packageId }, review);
        if (bad.length) throw createError(`The package details you reviewed no longer match this request (${bad.join(', ')}). Reload the page and review it again.`, 409);

        const mode = (sub.upgradeMode as UpgradeMode | null) ?? null;
        let term: { startDate: Date; endDate: Date };
        if (sub.changeKind === 'UPGRADE' && mode === 'IMMEDIATE') {
          // Switch now: the plan being replaced ends; the new term starts today.
          const old = sub.replacesId
            ? await tx.sellerSubscription.findUnique({ where: { id: sub.replacesId }, include: { package: true } })
            : await getCurrentSubscription(sub.userId, scope, tx, now);
          if (old && old.id !== sub.id && old.status === 'ACTIVE') {
            await tx.sellerSubscription.update({ where: { id: old.id }, data: { status: 'CANCELLED', cancelledAt: now } });
            replaced = { id: old.id, name: termsOf(old).packageName };
          }
          term = computeTerm(now, terms.durationDays, null);
        } else {
          // NEW / RENEWAL / UPGRADE-after-expiry: chain after whatever is still running.
          const current = await getCurrentSubscription(sub.userId, scope, tx, now);
          term = computeTerm(now, terms.durationDays, current && current.id !== sub.id ? current.endDate : null);
        }
        if (endDate && endDate.getTime() <= now.getTime()) throw createError('endDate must be in the future', 400);
        data.startDate = term.startDate;
        data.endDate = endDate ?? term.endDate;
        data.approvedAt = now;
        if (adminId) data.approvedById = adminId;
        if (note) data.adminNote = note;
      } else {
        // Reviving an expired/cancelled one needs an explicit future end date.
        if (!endDate || endDate.getTime() <= now.getTime()) throw createError('Provide a future endDate to reactivate this subscription', 400);
        data.endDate = endDate;
        data.startDate = now;
      }
      data.status = 'ACTIVE';
      data.cancelledAt = null;
      data.reminderSentAt = null;
    } else if (to !== from) {
      data.status = to;
      if (to === 'CANCELLED') {
        data.cancelledAt = now;
        declinedNow = from === 'PENDING_PAYMENT';
        if (note) data.adminNote = note;
      }
      endedNow = to === 'EXPIRED' || to === 'CANCELLED';
    }

    if (endDate && !activatedNow) {
      if (to === 'ACTIVE' && endDate.getTime() <= now.getTime()) throw createError('An active subscription needs an endDate in the future (set the status to EXPIRED to end it)', 400);
      data.endDate = endDate;
      if (to === 'ACTIVE') data.reminderSentAt = null; // extended: remind again for the new end
    }

    const updated = await tx.sellerSubscription.update({
      where: { id: sub.id }, data,
      include: { package: true, user: { select: { id: true, name: true, email: true } } },
    });

    if (declinedNow) {
      await notify(tx, sub.userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Request Declined',
        `Your request for "${terms.packageName}" was not approved${note ? `: ${note}` : '.'}${terms.price > 0 ? ' Contact support if you have already paid.' : ''}`,
        { subscriptionId: sub.id });
    } else if (endedNow) {
      await notify(tx, sub.userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Ended',
        `Your "${terms.packageName}" package subscription has been ${to.toLowerCase()}.`, { subscriptionId: sub.id });
    } else if (activatedNow) {
      const scheduled = updated.startDate.getTime() > now.getTime();
      await notify(tx, sub.userId, 'SUBSCRIPTION_ACTIVATED', scheduled ? 'Upgrade Approved' : 'Subscription Activated',
        scheduled
          ? `Your "${terms.packageName}" upgrade is confirmed and will start on ${updated.startDate.toLocaleDateString()}, when your current plan ends. It runs until ${updated.endDate.toLocaleDateString()}.`
          : `Your "${terms.packageName}" package has been activated until ${updated.endDate.toLocaleDateString()}.${replaced ? ` It replaces "${replaced.name}".` : ''}`,
        { subscriptionId: sub.id });
    }
    return { subscription: updated, activatedNow, replaced, terms };
  });
}

// ─────────────────────────────── SCHEDULED SWEEPS ───────────────────────────────

/**
 * Flip every ACTIVE subscription past its end date to EXPIRED and tell the owner — once.
 * The conditional updateMany makes it safe to run on several instances at the same time:
 * only the run that actually changed the row sends the notification.
 */
export async function expireOverdueSubscriptions(now = new Date(), batch = 500): Promise<number> {
  let expired = 0;
  for (let round = 0; round < 20; round++) {
    const overdue = await prisma.sellerSubscription.findMany({
      where: { status: 'ACTIVE', endDate: { lte: now } },
      select: { id: true, userId: true, packageName: true, package: { select: { name: true } } },
      take: batch,
    });
    if (overdue.length === 0) break;
    for (const sub of overdue) {
      try {
        const res = await prisma.sellerSubscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
        if (res.count === 1) {
          expired++;
          await notify(prisma, sub.userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Expired',
            `Your "${sub.packageName ?? sub.package.name}" subscription has expired. Renew to keep your benefits.`, { subscriptionId: sub.id });
        }
      } catch (err) {
        logger.error(`Failed to expire subscription ${sub.id}`, err);
      }
    }
    if (overdue.length < batch) break;
  }
  return expired;
}

/** One in-app reminder per subscription when it enters its final days. */
export async function sendSubscriptionReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * DAY_MS);
  const candidates = await prisma.sellerSubscription.findMany({
    where: { status: 'ACTIVE', reminderSentAt: null, startDate: { lte: now }, endDate: { gt: now, lte: horizon } },
    include: { package: { select: { name: true } } },
    take: 1000,
  });
  let sent = 0;
  for (const sub of candidates) {
    if (!needsReminder(sub, sub.package, now)) continue;
    try {
      const res = await prisma.sellerSubscription.updateMany({ where: { id: sub.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (res.count !== 1) continue;
      sent++;
      const days = daysRemaining(sub.endDate, now);
      await notify(prisma, sub.userId, 'SYSTEM', 'Subscription Expiring Soon',
        `Your "${sub.packageName ?? sub.package.name}" subscription ends in ${days} day${days === 1 ? '' : 's'}. Renew now to avoid interruption.`,
        { kind: 'SUBSCRIPTION_EXPIRING', subscriptionId: sub.id, daysRemaining: days });
    } catch (err) {
      logger.error(`Failed to send subscription reminder ${sub.id}`, err);
    }
  }
  return sent;
}
