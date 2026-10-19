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
 * NOTE: nothing here touches User.isVerified. That flag is EMAIL confirmation (login is
 * refused without it), and the previous admin handler cleared it when a paid subscription
 * ended — locking the customer out of their own account.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { createError } from '../middleware/errorHandler';
import { logger } from './logger';

export type SubStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING_PAYMENT';
export type PackageScope = 'LISTING' | 'CV';

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
  if (pkg.name.startsWith('Store Owner')) return false; // follows the store rental, which has its own reminder
  if (!isCurrent(sub, now)) return false;
  return daysRemaining(sub.endDate, now) <= EXPIRY_REMINDER_DAYS;
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
  subscription: (SubLike & { package: { name: string; maxListings: number | null } }) | null;
  ordinaryCap: number;
  now?: Date;
}): ListingEntitlement {
  const now = input.now ?? new Date();
  const { rental, subscription } = input;
  if (rental && rental.status === 'ACTIVE' && rental.endDate.getTime() > now.getTime()) {
    return { source: 'STORE', maxListings: rental.maxListings ?? null, expiresAt: rental.endDate, label: 'Web store' };
  }
  if (subscription && isCurrent(subscription, now)) {
    return { source: 'SUBSCRIPTION', maxListings: subscription.package.maxListings ?? null, expiresAt: subscription.endDate, label: subscription.package.name };
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
  daysRemaining: number;
  startDate: Date;
  endDate: Date;
  paymentRef: string | null;
  package: unknown;
}

export function toSubscriptionView(sub: { id: string; status: string; startDate: Date; endDate: Date; paymentRef: string | null; package: unknown }, now = new Date()): SubscriptionView {
  return {
    id: sub.id,
    status: effectiveStatus(sub, now),
    storedStatus: sub.status,
    isCurrent: isCurrent(sub, now),
    daysRemaining: isCurrent(sub, now) ? daysRemaining(sub.endDate, now) : 0,
    startDate: sub.startDate,
    endDate: sub.endDate,
    paymentRef: sub.paymentRef,
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

/**
 * Create a subscription for `userId`. Free packages and paid CV packages (legacy behaviour —
 * see the payment note in SECURITY_AUDIT.md) start ACTIVE; paid LISTING packages start
 * PENDING_PAYMENT until an admin confirms payment.
 */
export async function subscribeToPackage(userId: string, packageId: string, rawPaymentRef: unknown, now = new Date()) {
  const paymentRef = cleanPaymentRef(rawPaymentRef);
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.sellerPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw createError('Package not found or inactive', 404);
    if (!pkg.isFree && !paymentRef) throw createError('paymentRef is required for paid packages', 400);

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
    if (current) throw createError(`You already have an active ${pkg.scope.toLowerCase()} subscription. Use renew to extend it.`, 409);
    const pending = await tx.sellerSubscription.findFirst({
      where: { userId, status: 'PENDING_PAYMENT', package: { scope: pkg.scope } },
      select: { id: true },
    });
    if (pending) throw createError('You already have a subscription request awaiting payment confirmation.', 409);

    const { startDate, endDate } = computeTerm(now, pkg.durationDays);
    const startsActive = pkg.isFree || pkg.scope === 'CV';
    const subscription = await tx.sellerSubscription.create({
      data: { userId, packageId, status: startsActive ? 'ACTIVE' : 'PENDING_PAYMENT', startDate, endDate, paymentRef },
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
    const pending = await tx.sellerSubscription.findFirst({
      where: { userId, status: 'PENDING_PAYMENT', package: { scope: base.package.scope } }, select: { id: true },
    });
    if (pending) throw createError('You already have a renewal awaiting payment confirmation.', 409);

    const current = await getCurrentSubscription(userId, base.package.scope as PackageScope, tx, now);
    const { startDate, endDate } = computeTerm(now, base.package.durationDays, current?.endDate);
    const subscription = await tx.sellerSubscription.create({
      data: { userId, packageId: base.packageId, status: 'PENDING_PAYMENT', startDate, endDate, paymentRef },
      include: { package: true },
    });
    await notify(tx, userId, 'SUBSCRIPTION_PENDING', 'Renewal Pending Confirmation',
      `Your renewal of "${base.package.name}" is awaiting payment confirmation.`,
      { subscriptionId: subscription.id, renewsSubscriptionId: base.id });
    return subscription;
  });
}

/** Owner cancels their own subscription (ends access immediately; there is no auto-renewal). */
export async function cancelOwnSubscription(userId: string, subscriptionId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.sellerSubscription.findUnique({ where: { id: subscriptionId }, include: { package: true } });
    if (!sub || sub.userId !== userId) throw createError('Subscription not found', 404);
    const status = effectiveStatus(sub, now);
    if (!canTransition(status, 'CANCELLED')) throw createError(`A ${status.toLowerCase().replace('_', ' ')} subscription cannot be cancelled`, 409);
    const res = await tx.sellerSubscription.updateMany({
      where: { id: sub.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    if (res.count === 0) throw createError('Subscription changed in the meantime — please refresh', 409);
    await notify(tx, userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Cancelled',
      `Your "${sub.package.name}" subscription has been cancelled.`, { subscriptionId: sub.id });
    return tx.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id }, include: { package: true } });
  });
}

/**
 * Admin changes a subscription's status and/or end date. Validated against the status machine;
 * activating a PENDING_PAYMENT renewal chains it after the current term so no paid days are lost.
 */
export async function adminUpdateSubscription(
  subscriptionId: string,
  input: { status?: unknown; endDate?: unknown },
  now = new Date(),
) {
  const allowed: SubStatus[] = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'];
  if (input.status !== undefined && !allowed.includes(input.status as SubStatus)) throw createError('Invalid status', 400);
  let endDate: Date | undefined;
  if (input.endDate !== undefined && input.endDate !== null) {
    endDate = new Date(input.endDate as string);
    if (Number.isNaN(endDate.getTime())) throw createError('endDate is not a valid date', 400);
  }

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

    const data: Prisma.SellerSubscriptionUpdateInput = {};
    let activatedNow = false;
    let endedNow = false;

    if (to === 'ACTIVE' && from !== 'ACTIVE') {
      activatedNow = true;
      if (from === 'PENDING_PAYMENT') {
        // Payment confirmed: the term starts now, or right after the current one.
        const current = await getCurrentSubscription(sub.userId, sub.package.scope as PackageScope, tx, now);
        const term = computeTerm(now, sub.package.durationDays, current && current.id !== sub.id ? current.endDate : null);
        data.startDate = term.startDate;
        data.endDate = endDate ?? term.endDate;
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
      if (to === 'CANCELLED') data.cancelledAt = now;
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

    if (endedNow) {
      await notify(tx, sub.userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Ended',
        `Your "${sub.package.name}" package subscription has been ${to.toLowerCase()}.`, { subscriptionId: sub.id });
    } else if (activatedNow) {
      await notify(tx, sub.userId, 'SUBSCRIPTION_ACTIVATED', 'Subscription Activated',
        `Your "${sub.package.name}" package has been activated until ${updated.endDate.toLocaleDateString()}.`, { subscriptionId: sub.id });
    }
    return { subscription: updated, activatedNow };
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
      select: { id: true, userId: true, package: { select: { name: true } } },
      take: batch,
    });
    if (overdue.length === 0) break;
    for (const sub of overdue) {
      try {
        const res = await prisma.sellerSubscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
        if (res.count === 1) {
          expired++;
          await notify(prisma, sub.userId, 'SUBSCRIPTION_EXPIRED', 'Subscription Expired',
            `Your "${sub.package.name}" subscription has expired. Renew to keep your benefits.`, { subscriptionId: sub.id });
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
        `Your "${sub.package.name}" subscription ends in ${days} day${days === 1 ? '' : 's'}. Renew now to avoid interruption.`,
        { kind: 'SUBSCRIPTION_EXPIRING', subscriptionId: sub.id, daysRemaining: days });
    } catch (err) {
      logger.error(`Failed to send subscription reminder ${sub.id}`, err);
    }
  }
  return sent;
}
