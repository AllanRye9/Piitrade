/**
 * momo/paymentService.ts — collection-only MTN MoMo payments for Piitrade.
 *
 * The platform is the sole beneficiary of every payment (premium subscriptions, store rentals and
 * renewals, listing visibility tiers, CV downloads): no escrow, no splits, no payouts.
 *
 * Design rules (see also the PaymentTransaction model in schema.prisma):
 *  - MTN is asynchronous. A payment is never assumed successful: `verifyPayment` is the ONLY path
 *    that settles a payment, and it always asks MTN (GET requesttopay/{referenceId}). Callbacks,
 *    the status endpoint and the reconciler all just call it. A callback body is never trusted.
 *  - Amounts are derived server-side from the target (package / rental / tier pricing / CV token),
 *    never from the client, and are cross-checked against MTN's response before anything is unlocked.
 *  - Settling (PENDING -> SUCCESSFUL) and provisioning (granting access) are separate, each guarded
 *    by a conditional update / lease, so concurrent callers can never double-activate and a crash
 *    between the two is retried by the reconciler ("paid but no access" cannot be left behind).
 *  - Provisioning REUSES the existing services unchanged (adminUpdateSubscription,
 *    confirmPendingRenewal, …) so subscription chaining, notifications and downgrade rules are
 *    exactly what they were when an admin clicked "confirm".
 *  - Anything that cannot be provisioned safely (target cancelled before payment landed, amount
 *    mismatch, …) goes to NEEDS_REVIEW and alerts admins — money is never silently swallowed.
 */
import crypto from 'crypto';
import { Prisma, PaymentTransaction, PaymentPurpose, PaymentStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../logger';
import { safeEqual } from '../safeEqual';
import { invalidateCategoryCounts } from '../categoryCounts';
import { subscribeToPackage, requestRenewal, requestUpgrade, adminUpdateSubscription, termsOf, UPGRADE_MODES, UpgradeMode } from '../subscriptionService';
import { confirmPendingRenewal } from '../storeRentalService';
import { sendSubscriptionActivatedEmail } from '../email';
import { getMomoConfig, getMomoSettlementConfig, MomoConfig } from './config';
import { getMomoClient, MomoApiError, RequestToPayStatus } from './client';
import { issueReceipt } from './receipt';
import {
  normalizeMsisdn, maskMsisdn, formatProviderAmount, signCallback, verifyCallbackSignature, paymentNote, friendlyFailure,
  PENDING_GIVE_UP_MS, LATE_SUCCESS_WINDOW_MS, canBuyListingTier,
} from './rules';

// ─── Tunables ───────────────────────────────────────────────────────────────

/** How long a provisioning lease holds before another worker may take over (a worker that died mid-way). */
export const PROVISION_LEASE_MS = 2 * 60 * 1000;
/** A SUCCESSFUL payment that still cannot be provisioned after this long is escalated to an admin. */
export const PROVISION_ESCALATE_MS = 30 * 60 * 1000;
/** Minimum gap between MTN lookups triggered by the payer polling the status endpoint. */
export const LAZY_VERIFY_MIN_GAP_MS = 4000;
/** A request MTN has never heard of is declared FAILED after this long (it was never created). */
const NOT_FOUND_GRACE_MS = 2 * 60 * 1000;

/** Max payment prompts sent to one mobile number per window (resumed attempts create no new prompt). */
export const MSISDN_MAX_PROMPTS = 5;
export const MSISDN_WINDOW_MS = 60 * 60 * 1000;

const TIER_RANK: Record<string, number> = { FREE: 0, GOLD: 1, PLATINUM: 2 };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Actor { userId: string | null; role?: string | null }

export interface InitiateInput {
  purpose: PaymentPurpose;
  msisdn: unknown;
  packageId?: unknown;
  upgradeMode?: unknown;
  subscriptionId?: unknown;
  rentalId?: unknown;
  listingId?: unknown;
  tier?: unknown;
  tokenId?: unknown;
  rawToken?: unknown;
}

export interface PaymentView {
  id: string;
  purpose: PaymentPurpose;
  targetId: string;
  status: PaymentStatus;
  /** true once the payment succeeded AND the access it buys has been granted. */
  completed: boolean;
  amount: number;
  currency: string;
  msisdn: string;
  failureMessage: string | null;
  /** Unique tracking code of the digital receipt, once the payment has completed. */
  receiptNumber: string | null;
  createdAt: Date;
}

interface ResolvedTarget {
  targetId: string;
  amount: number;
  label: string;
  /** Identifies exactly what is being bought; an in-flight attempt is only resumed for the same fingerprint. */
  fingerprint: string;
  metadata: Record<string, unknown>;
  /** Set when resolving THIS request created a brand-new PENDING_PAYMENT subscription (see initiatePayment's cleanup). */
  createdSubscriptionId?: string;
}

type ProvisionResult = { kind: 'DONE'; note?: string } | { kind: 'REVIEW'; note: string };
const done = (note?: string): ProvisionResult => ({ kind: 'DONE', note });
const review = (note: string): ProvisionResult => ({ kind: 'REVIEW', note });

// ─── Small helpers ──────────────────────────────────────────────────────────

function reqString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw createError(`${field} is required`, 400);
  return value.trim();
}

function assertUgx(currency: string | null | undefined): void {
  if ((currency ?? 'UGX').toUpperCase() !== 'UGX') throw createError('Mobile money payments are only available for prices in UGX.', 400);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isClientError(err: unknown): err is Error & { statusCode: number } {
  const code = (err as { statusCode?: unknown })?.statusCode;
  return err instanceof Error && typeof code === 'number' && code >= 400 && code < 500;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function toPaymentView(row: PaymentTransaction): PaymentView {
  return {
    id: row.id,
    purpose: row.purpose,
    targetId: row.targetId,
    status: row.status,
    completed: row.status === 'SUCCESSFUL' && row.provisionedAt !== null,
    amount: Number(row.amount),
    currency: row.currency,
    msisdn: maskMsisdn(row.msisdn),
    failureMessage: row.status === 'REFUNDED'
      ? 'This payment was refunded to your mobile money account.'
      : row.status === 'FAILED' || row.status === 'EXPIRED' ? friendlyFailure(row.failureReason ?? (row.status === 'EXPIRED' ? 'EXPIRED' : null)) : null,
    receiptNumber: row.status === 'SUCCESSFUL' && row.provisionedAt !== null ? row.receiptNumber : null,
    createdAt: row.createdAt,
  };
}

async function reload(id: string): Promise<PaymentTransaction> {
  return prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
}

export async function notifyAdmins(title: string, message: string, data: Record<string, unknown>): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((a) => ({ userId: a.id, type: 'SYSTEM' as const, title, message, data: data as Prisma.InputJsonValue })),
    });
  } catch (err) {
    logger.error('MoMo: failed to notify admins', err);
  }
}

export function buildCallbackUrl(cfg: MomoConfig, referenceId: string): string | null {
  if (!cfg.callbackUrl || !cfg.callbackSecret) return null;
  const u = new URL(cfg.callbackUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/${referenceId}`;
  u.searchParams.set('s', signCallback(referenceId, cfg.callbackSecret));
  return u.toString();
}

// ─── Target resolution (what is being bought, who owns it, what it costs) ───

/** The one open (PENDING_PAYMENT) listing-scope request of this user, if any. */
function findPendingListingRequest(userId: string) {
  return prisma.sellerSubscription.findFirst({
    where: { userId, status: 'PENDING_PAYMENT', package: { scope: 'LISTING' } },
    include: { package: true },
  });
}

/** Price a pending request from the terms it SNAPSHOTTED (what the customer agreed to), never the live package. */
function subscriptionTarget(
  sub: NonNullable<Awaited<ReturnType<typeof findPendingListingRequest>>>,
  label: string,
  extra: Record<string, unknown> = {},
): ResolvedTarget {
  const t = termsOf(sub);
  if (!(t.price > 0)) throw createError('This request has no fee to pay.', 400);
  assertUgx(t.currency);
  return {
    targetId: sub.id, amount: t.price, label: `${t.packageName}${label}`,
    fingerprint: `sub:${sub.id}:${t.price}`,
    metadata: { packageId: sub.packageId, packageName: t.packageName, changeKind: sub.changeKind, ...extra },
  };
}

async function resolveSubscription(userId: string, packageId: string, referenceId: string): Promise<ResolvedTarget> {
  const pkg = await prisma.sellerPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw createError('Package not found or inactive', 404);
  if (pkg.isFree || pkg.price <= 0) throw createError('This package is free — no payment is needed.', 400);
  if (pkg.scope !== 'LISTING') throw createError('CV packages are paid per download, not subscribed to.', 400);
  assertUgx(pkg.currency);

  const pending = await findPendingListingRequest(userId);
  if (pending) {
    if (pending.packageId !== pkg.id || pending.changeKind !== 'NEW') throw createError('You already have a request awaiting payment. Complete or cancel it first.', 409);
    return subscriptionTarget(pending, ''); // retry of an earlier attempt, at the price it was requested at
  }
  // The MoMo reference doubles as the subscription's paymentRef, so admins see where it came from.
  const created = (await subscribeToPackage(userId, pkg.id, referenceId)).subscription;
  return { ...subscriptionTarget({ ...created, package: pkg }, ''), createdSubscriptionId: created.id };
}

async function resolveSubscriptionRenewal(userId: string, subscriptionId: string, referenceId: string): Promise<ResolvedTarget> {
  const base = await prisma.sellerSubscription.findUnique({ where: { id: subscriptionId }, include: { package: true } });
  if (!base || base.userId !== userId) throw createError('Subscription not found', 404);
  const pkg = base.package;
  if (pkg.isFree || pkg.price <= 0) throw createError('Free packages cannot be renewed. Choose a paid package instead.', 400);
  if (pkg.scope !== 'LISTING') throw createError('CV packages are paid per download, not renewed.', 400);
  assertUgx(pkg.currency);

  const pending = await findPendingListingRequest(userId);
  if (pending) {
    if (pending.packageId !== pkg.id || pending.changeKind !== 'RENEWAL') throw createError('You already have a request awaiting payment. Complete or cancel it first.', 409);
    return subscriptionTarget(pending, ' renewal', { renewsSubscriptionId: subscriptionId });
  }
  const created = await requestRenewal(userId, subscriptionId, referenceId);
  return { ...subscriptionTarget({ ...created, package: pkg }, ' renewal', { renewsSubscriptionId: subscriptionId }), createdSubscriptionId: created.id };
}

async function resolveSubscriptionUpgrade(userId: string, packageId: string, modeRaw: unknown, referenceId: string): Promise<ResolvedTarget> {
  const mode = String(modeRaw ?? '').toUpperCase() as UpgradeMode;
  if (!UPGRADE_MODES.includes(mode)) throw createError('mode must be AFTER_EXPIRY or IMMEDIATE', 400);
  const pkg = await prisma.sellerPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw createError('Package not found or inactive', 404);
  if (pkg.isFree || pkg.price <= 0) throw createError('A free package is not an upgrade.', 400);
  if (pkg.scope !== 'LISTING') throw createError('Only listing packages can be upgraded here.', 400);
  assertUgx(pkg.currency);

  const pending = await findPendingListingRequest(userId);
  if (pending) {
    if (pending.packageId !== pkg.id || pending.changeKind !== 'UPGRADE' || pending.upgradeMode !== mode) {
      throw createError('You already have a request awaiting payment. Complete or cancel it first.', 409);
    }
    return subscriptionTarget(pending, ' upgrade', { upgradeMode: mode });
  }
  const created = await requestUpgrade(userId, pkg.id, mode, referenceId);
  return { ...subscriptionTarget({ ...created, package: pkg }, ' upgrade', { upgradeMode: mode }), createdSubscriptionId: created.id };
}

async function resolveStoreRental(userId: string, rentalId: string): Promise<ResolvedTarget> {
  const rental = await prisma.storeRental.findUnique({ where: { id: rentalId }, select: { id: true, userId: true, status: true, fee: true, currency: true, tier: true, placements: true } });
  if (!rental || rental.userId !== userId) throw createError('Store rental not found', 404);
  const placements = asRecord(rental.placements);
  if (placements.pendingRenewal) throw createError('This store has a renewal awaiting payment — pay for the renewal instead.', 409);
  if (rental.status !== 'PENDING') throw createError('Only a store application awaiting payment can be paid.', 409);
  if (placements.paymentStatus === 'CONFIRMED') throw createError('This store application has already been paid.', 409);
  if (!(rental.fee > 0)) throw createError('This store plan has no fee to pay.', 400);
  assertUgx(rental.currency);
  return { targetId: rental.id, amount: rental.fee, label: 'Store rental', fingerprint: `rental:${rental.id}:${rental.fee}`, metadata: { tier: rental.tier } };
}

async function resolveStoreRenewal(userId: string, rentalId: string): Promise<ResolvedTarget> {
  const rental = await prisma.storeRental.findUnique({ where: { id: rentalId }, select: { id: true, userId: true, status: true, placements: true } });
  if (!rental || rental.userId !== userId) throw createError('Store rental not found', 404);
  if (rental.status !== 'ACTIVE' && rental.status !== 'EXPIRED') throw createError('This store cannot be renewed.', 409);
  const pending = asRecord(asRecord(rental.placements).pendingRenewal);
  const fee = Number(pending.fee);
  if (!pending.plan || !Number.isFinite(fee)) throw createError('This store has no renewal awaiting payment.', 409);
  if (!(fee > 0)) throw createError('This renewal has no fee to pay.', 400);
  assertUgx(typeof pending.currency === 'string' ? pending.currency : 'UGX');
  return {
    targetId: rental.id, amount: fee, label: 'Store renewal',
    fingerprint: `renewal:${String(pending.plan)}:${String(pending.tier)}:${fee}`,
    metadata: { plan: pending.plan, tier: pending.tier },
  };
}

/** Exported for unit tests. */
export async function resolveListingTier(actor: Actor, listingId: string, tierRaw: unknown): Promise<ResolvedTarget> {
  const tier = typeof tierRaw === 'string' ? tierRaw.toUpperCase() : '';
  if (tier !== 'GOLD' && tier !== 'PLATINUM') throw createError('tier must be GOLD or PLATINUM', 400);
  if (actor.role === 'ADMIN') throw createError('Admin listings do not need a paid tier.', 400);
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, userId: true, tier: true, status: true } });
  if (!listing || listing.userId !== actor.userId) throw createError('Listing not found', 404);
  // Payment must never wait for moderation: an ad still PENDING approval can be paid for now and approved
  // later, and the paid period then starts when it goes live (utils/listingTierClock.ts). Only an ad that
  // can't go live (sold / expired / hidden / rejected) is refused.
  if (!canBuyListingTier(listing.status)) throw createError(`A ${listing.status.toLowerCase()} listing cannot be promoted.`, 409);
  if ((TIER_RANK[listing.tier] ?? 0) >= TIER_RANK[tier]) throw createError('This listing already has this visibility level or higher.', 409);
  const store = await prisma.storeRental.findFirst({ where: { userId: listing.userId, status: 'ACTIVE' }, select: { id: true } });
  if (store) throw createError("Your store plan sets the visibility of your listings, so a per-listing tier can't be bought.", 409);

  const config = await prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { tierPricing: true } });
  // No built-in prices: the admin sets them in Site Config → Tier Pricing, and an unset tier is not offered.
  const pricing = asRecord(config?.tierPricing) as { currency?: string; listingGoldPrice?: number | null; listingPlatinumPrice?: number | null; listingTierDurationDays?: number | null };
  assertUgx(pricing.currency ?? 'UGX');
  const amount = Number(tier === 'GOLD' ? pricing.listingGoldPrice : pricing.listingPlatinumPrice);
  if (!(amount > 0)) throw createError('This visibility level has no price configured.', 400);
  const tierDays = Number(pricing.listingTierDurationDays);
  if (!(tierDays > 0)) throw createError('The visibility duration has not been configured.', 400);
  return {
    targetId: listing.id, amount, label: `${tier === 'GOLD' ? 'Gold' : 'Platinum'} listing`,
    fingerprint: `tier:${listing.id}:${tier}:${amount}`,
    metadata: { tier, durationDays: tierDays },
  };
}

async function resolveCvDownload(tokenId: string, rawToken: string): Promise<ResolvedTarget> {
  const token = await prisma.cvDownloadToken.findUnique({ where: { id: tokenId } });
  if (!token || !safeEqual(sha256(rawToken), token.tokenHash)) throw createError('Download token not found', 404);
  if (token.paid) throw createError('This download has already been paid for.', 409);
  if (token.expiresAt.getTime() < Date.now()) throw createError('This download session has expired. Please start again.', 410);
  const amount = Number(token.amount);
  if (!(amount > 0)) throw createError('This download has no fee to pay.', 400);
  assertUgx(token.currency);
  return { targetId: token.id, amount, label: 'CV download', fingerprint: `cv:${token.id}:${amount}`, metadata: { packageId: token.packageId } };
}

async function resolveTarget(actor: Actor, input: InitiateInput, referenceId: string): Promise<ResolvedTarget> {
  if (input.purpose === 'CV_DOWNLOAD') return resolveCvDownload(reqString(input.tokenId, 'tokenId'), reqString(input.rawToken, 'rawToken'));
  const userId = actor.userId;
  if (!userId) throw createError('Please log in to continue.', 401);
  switch (input.purpose) {
    case 'SUBSCRIPTION': return resolveSubscription(userId, reqString(input.packageId, 'packageId'), referenceId);
    case 'SUBSCRIPTION_RENEWAL': return resolveSubscriptionRenewal(userId, reqString(input.subscriptionId, 'subscriptionId'), referenceId);
    case 'SUBSCRIPTION_UPGRADE': return resolveSubscriptionUpgrade(userId, reqString(input.packageId, 'packageId'), input.upgradeMode, referenceId);
    case 'STORE_RENTAL': return resolveStoreRental(userId, reqString(input.rentalId, 'rentalId'));
    case 'STORE_RENEWAL': return resolveStoreRenewal(userId, reqString(input.rentalId, 'rentalId'));
    case 'LISTING_TIER': return resolveListingTier(actor, reqString(input.listingId, 'listingId'), input.tier);
    default: throw createError('Unsupported payment purpose', 400);
  }
}

// ─── Initiate ───────────────────────────────────────────────────────────────

/** Turns MTN's rejection of a payment request into a message the payer can act on (and says who must fix it). */
export function explainRequestRejection(err: MomoApiError): { message: string; status: number; ours: boolean } {
  const code = (err.code || '').toUpperCase();
  const http = err.httpStatus;
  const payer = (message: string) => ({ message, status: 400, ours: false });
  if (code === 'NOT_ENOUGH_FUNDS') return payer('Your Mobile Money balance is too low for this payment. Top up and try again.');
  if (code === 'PAYER_LIMIT_REACHED' || code === 'PAYER_TRANSACTION_LIMIT_REACHED') return payer('This Mobile Money account has reached its transaction limit. Try again later or use another number.');
  if (code === 'PAYER_NOT_FOUND' || code === 'ACCOUNTHOLDER_NOT_ACTIVE' || code === 'INVALID_MSISDN') return payer('That number is not an active MTN Mobile Money account. Check the number and try again.');
  if (code === 'PAYER_NOT_ALLOWED' || code === 'PAYEE_NOT_ALLOWED_TO_RECEIVE') return payer('This payment is not allowed for that account. Try another MTN number.');
  // Credentials / subscription key / wrong environment / MTN outage: the payer cannot fix these.
  if (http === 401 || http === 403 || http === 404 || (http !== null && http >= 500) || http === 429 || code === 'INVALID_CURRENCY' || code === 'INVALID_CALLBACK_URL_HOST') {
    return { message: 'Mobile Money is temporarily unavailable. Please try again in a few minutes or contact support if it continues.', status: 503, ours: true };
  }
  return payer('We could not start the payment. Please check the number and try again.');
}

export async function initiatePayment(actor: Actor, input: InitiateInput, now: Date = new Date()): Promise<{ payment: PaymentView; resumed: boolean }> {
  const cfg = getMomoConfig(); // 503 when disabled / misconfigured
  const msisdn = normalizeMsisdn(input.msisdn, { lenient: cfg.environment === 'sandbox' });
  if (!msisdn) throw createError('Enter a valid MTN Mobile Money number, for example 0772 123 456.', 400);

  // Nobody proves they own the number they type, so anyone could otherwise push repeated payment
  // prompts to a stranger's phone. Per-IP limits are weak behind carrier NAT, so also cap prompts
  // per number: a handful per hour, however many accounts/devices/IPs they come from.
  const recentToNumber = await prisma.paymentTransaction.count({
    where: { msisdn, createdAt: { gt: new Date(now.getTime() - MSISDN_WINDOW_MS) } },
  });
  if (recentToNumber >= MSISDN_MAX_PROMPTS) {
    throw createError('Too many payment requests for this number. Please wait a while before trying again.', 429);
  }

  const referenceId = crypto.randomUUID();
  const target = await resolveTarget(actor, input, referenceId);
  // Resolving may have just created a PENDING_PAYMENT subscription. If anything below fails before a
  // payment row exists (unusable number, MTN says not an account, a duplicate in flight …) that row
  // would be an orphan: nothing to reconcile, but it blocks the user's next purchase. Remove it.
  let paymentRowCreated = false;
  try {

  // Never charge twice for the same thing: money already received for this target is awaiting access.
  const received = await prisma.paymentTransaction.findFirst({
    where: { purpose: input.purpose, targetId: target.targetId, OR: [{ status: 'NEEDS_REVIEW' }, { status: 'SUCCESSFUL', provisionedAt: null }] },
    select: { id: true },
  });
  if (received) throw createError('A payment for this item has already been received and is being processed. If access is not granted shortly, contact support.', 409);

  // An attempt that looked expired can still be approved late (we keep honouring it for 24h). Ask
  // MTN about those first, so a payer who approved it is told it was received instead of being
  // prompted — and charged — a second time.
  const lateCandidates = await prisma.paymentTransaction.findMany({
    where: { purpose: input.purpose, targetId: target.targetId, status: 'EXPIRED', createdAt: { gt: new Date(now.getTime() - LATE_SUCCESS_WINDOW_MS) } },
    select: { id: true },
    take: 5,
  });
  for (const c of lateCandidates) await verifyPayment(c.id, now);
  if (lateCandidates.length > 0) {
    const nowReceived = await prisma.paymentTransaction.findFirst({
      where: { purpose: input.purpose, targetId: target.targetId, id: { in: lateCandidates.map((c) => c.id) }, status: { in: ['SUCCESSFUL', 'NEEDS_REVIEW'] } },
      select: { id: true },
    });
    if (nowReceived) throw createError('Your earlier payment for this item was approved after the prompt timed out and is being processed. Please do not pay again.', 409);
  }

  // Resume (rather than duplicate) an in-flight attempt for the same purchase.
  const existing = await prisma.paymentTransaction.findFirst({ where: { purpose: input.purpose, targetId: target.targetId, status: 'PENDING' } });
  if (existing) {
    if (asRecord(existing.metadata).fingerprint !== target.fingerprint) {
      throw createError('Another payment for this item is already in progress. Please wait for it to finish.', 409);
    }
    const fresh = await verifyPayment(existing.id, now);
    // The earlier prompt went to a different number than the one typed now (usually a typo). Resuming
    // silently would leave the payer waiting on the wrong phone, so say exactly where the prompt is
    // and how long until a new one can be sent. (Nothing can cancel a prompt already with MTN.)
    if (fresh.status === 'PENDING' && fresh.msisdn !== msisdn) {
      const minutesLeft = Math.max(1, Math.ceil((fresh.createdAt.getTime() + PENDING_GIVE_UP_MS - now.getTime()) / 60000));
      throw createError(
        `A payment prompt for this item was already sent to ${maskMsisdn(fresh.msisdn)}. Approve it on that phone, or wait about ${minutesLeft} minute(s) for it to expire before using a different number.`,
        409,
      );
    }
    if (fresh.status === 'PENDING' || fresh.status === 'SUCCESSFUL') return { payment: toPaymentView(fresh), resumed: true };
    // FAILED / EXPIRED / NEEDS_REVIEW: fall through and start a new attempt (NEEDS_REVIEW was caught above).
  }

  // Pre-check the payer's number so an obviously wrong one never triggers a failed prompt.
  const client = getMomoClient();
  let active: boolean | null = null;
  try {
    active = await client.validateAccountHolder(msisdn);
  } catch (err) {
    logger.warn(`MoMo: account check unavailable for ${maskMsisdn(msisdn)} — continuing (${(err as Error).message})`);
  }
  if (active === false) throw createError('That number is not an active MTN Mobile Money account.', 400);

  let row: PaymentTransaction;
  try {
    row = await prisma.paymentTransaction.create({
      data: {
        referenceId,
        environment: cfg.environment,
        purpose: input.purpose,
        targetId: target.targetId,
        userId: actor.userId,
        amount: target.amount,
        currency: 'UGX',
        providerAmount: Number(formatProviderAmount(target.amount)),
        providerCurrency: cfg.currency,
        msisdn,
        metadata: { ...target.metadata, fingerprint: target.fingerprint, label: target.label } as Prisma.InputJsonValue,
      },
    });
    paymentRowCreated = true;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      // Lost a race with a concurrent identical request: hand back the winner instead of a second prompt.
      const winner = await prisma.paymentTransaction.findFirst({ where: { purpose: input.purpose, targetId: target.targetId, status: 'PENDING' } });
      if (winner) return { payment: toPaymentView(winner), resumed: true };
    }
    throw err;
  }

  try {
    await client.requestToPay({
      referenceId,
      amount: formatProviderAmount(target.amount),
      currency: cfg.currency,
      externalId: row.id,
      msisdn,
      payerMessage: paymentNote(target.label),
      payeeNote: paymentNote(target.label),
      callbackUrl: buildCallbackUrl(cfg, referenceId),
    });
  } catch (err) {
    if (err instanceof MomoApiError && err.httpStatus !== null) {
      // MTN answered and did not accept the request: no prompt was sent.
      await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: `REQUEST_REJECTED_${err.httpStatus}` } });
      const { message, status, ours } = explainRequestRejection(err);
      // A rejection that is about OUR setup (credentials, subscription key, wrong environment, MTN down) is not
      // something the payer can fix by retyping their number, so it is logged loudly for the admin.
      (ours ? logger.error : logger.warn)(`MoMo: request not accepted for ${row.id}: ${err.message}`);
      throw createError(message, status);
    }
    // No answer (timeout / network): MTN may or may not have created it. Keep it PENDING; verification settles it.
    logger.warn(`MoMo: requesttopay outcome unknown for ${row.id}; leaving PENDING for verification (${(err as Error).message})`);
  }
  return { payment: toPaymentView(await reload(row.id)), resumed: false };
  } catch (outer) {
    if (target.createdSubscriptionId && !paymentRowCreated) {
      await prisma.sellerSubscription.updateMany({
        where: { id: target.createdSubscriptionId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }).catch((e) => logger.error('MoMo: could not clean up an unused subscription request', e));
    }
    throw outer;
  }
}

// ─── Verify / settle ────────────────────────────────────────────────────────

function detectMismatch(row: PaymentTransaction, st: RequestToPayStatus): string | null {
  if (st.externalId && st.externalId !== row.id) return 'MTN reported a different externalId for this reference';
  // Amount and currency are mandatory on a SUCCESSFUL status: a response that omits them cannot be
  // checked against what we asked for, so it is held for review rather than provisioned.
  // (externalId stays optional: some MTN environments do not echo it, and the referenceId already ties
  // the status to this row.)
  if (!st.currency) return 'MTN did not report a currency, so the payment could not be verified';
  if (st.currency.toUpperCase() !== row.providerCurrency.toUpperCase()) return `MTN reported currency ${st.currency}, expected ${row.providerCurrency}`;
  if (st.amount == null) return 'MTN did not report an amount, so the payment could not be verified';
  const paid = Number(st.amount);
  if (!Number.isFinite(paid) || paid !== Number(row.providerAmount)) return `MTN reported amount ${st.amount}, expected ${Number(row.providerAmount)}`;
  return null;
}

async function touch(id: string, status: PaymentStatus, now: Date): Promise<void> {
  await prisma.paymentTransaction.updateMany({ where: { id, status }, data: { lastCheckedAt: now, checkCount: { increment: 1 } } });
}

async function checkWithProvider(row: PaymentTransaction, now: Date): Promise<PaymentTransaction> {
  let st: RequestToPayStatus;
  try {
    st = await getMomoClient().getRequestToPayStatus(row.referenceId);
  } catch (err) {
    const age = now.getTime() - row.createdAt.getTime();
    if (err instanceof MomoApiError && err.httpStatus === 404 && row.status === 'PENDING' && age > NOT_FOUND_GRACE_MS) {
      await prisma.paymentTransaction.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'NOT_FOUND_AT_PROVIDER', lastCheckedAt: now, checkCount: { increment: 1 } },
      });
    } else {
      logger.warn(`MoMo: status check failed for ${row.id}: ${(err as Error).message}`);
      await touch(row.id, row.status, now);
    }
    return reload(row.id);
  }

  const settleable: PaymentStatus[] = ['PENDING', 'EXPIRED'];
  const common = { providerStatus: st.rawStatus || null, lastCheckedAt: now, checkCount: { increment: 1 } };

  if (st.outcome === 'SUCCESSFUL') {
    const mismatch = detectMismatch(row, st);
    if (mismatch) {
      const res = await prisma.paymentTransaction.updateMany({
        where: { id: row.id, status: { in: settleable } },
        data: { ...common, status: 'NEEDS_REVIEW', financialTransactionId: st.financialTransactionId, provisionNote: `Not provisioned: ${mismatch}` },
      });
      if (res.count === 1) {
        logger.error(`MoMo: payment ${row.id} succeeded but did not match: ${mismatch}`);
        await notifyAdmins('Payment needs review', `A mobile money payment succeeded but did not match what was expected (${mismatch}). Reference ${row.referenceId}.`, { paymentId: row.id });
      }
    } else {
      await prisma.paymentTransaction.updateMany({
        where: { id: row.id, status: { in: settleable } },
        data: { ...common, status: 'SUCCESSFUL', financialTransactionId: st.financialTransactionId, failureReason: null },
      });
    }
  } else if (st.outcome === 'FAILED') {
    await prisma.paymentTransaction.updateMany({
      where: { id: row.id, status: { in: settleable } },
      data: { ...common, status: 'FAILED', failureReason: (st.reason ?? st.rawStatus ?? 'FAILED').slice(0, 120) },
    });
  } else if (row.status === 'PENDING' && now.getTime() - row.createdAt.getTime() >= PENDING_GIVE_UP_MS) {
    // Still undecided after the give-up window: stop blocking a fresh attempt; late approvals are still caught.
    await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { ...common, status: 'EXPIRED', failureReason: 'EXPIRED' } });
  } else {
    await prisma.paymentTransaction.updateMany({ where: { id: row.id, status: row.status }, data: common });
  }
  return reload(row.id);
}

/**
 * Ask MTN for the payment's real state and settle it. Safe to call any number of times, from any
 * number of instances: transitions are conditional updates and provisioning is leased.
 */
export async function verifyPayment(paymentId: string, now: Date = new Date()): Promise<PaymentTransaction> {
  let row = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!row) throw createError('Payment not found', 404);

  if (row.status === 'PENDING' || (row.status === 'EXPIRED' && now.getTime() - row.createdAt.getTime() <= LATE_SUCCESS_WINDOW_MS)) {
    row = await checkWithProvider(row, now);
  }
  if (row.status === 'SUCCESSFUL' && !row.provisionedAt) row = await tryProvision(row, now);
  return row;
}

// ─── Provisioning (grant access) ────────────────────────────────────────────

async function provisionSubscription(row: PaymentTransaction): Promise<ProvisionResult> {
  const sub = await prisma.sellerSubscription.findUnique({
    where: { id: row.targetId },
    include: { package: true, user: { select: { id: true, name: true, email: true } } },
  });
  if (!sub) return review('The subscription no longer exists.');
  if (sub.userId !== row.userId) return review('The subscription belongs to a different account.');
  if (sub.status === 'ACTIVE') return done('Already active (confirmed before the payment was processed).');
  if (sub.status !== 'PENDING_PAYMENT') return review(`The subscription is ${sub.status} — payment arrived after the request ended.`);
  try {
    // The approval gate wants the package details an admin "reviewed"; here they are the snapshot the customer paid for.
    const t = termsOf(sub);
    const { subscription, activatedNow } = await adminUpdateSubscription(sub.id, {
      status: 'ACTIVE',
      review: { packageId: sub.packageId, price: t.price, currency: t.currency, durationDays: t.durationDays, maxListings: t.maxListings },
    });
    if (activatedNow) {
      sendSubscriptionActivatedEmail(sub.user.email, sub.user.name, t.packageName, subscription.endDate)
        .catch((err) => logger.error('MoMo: activation email failed', err));
    }
    return done();
  } catch (err) {
    if (isClientError(err)) return review(`Could not activate the subscription: ${err.message}`);
    throw err;
  }
}

async function provisionStoreRenewal(row: PaymentTransaction): Promise<ProvisionResult> {
  const rental = await prisma.storeRental.findUnique({ where: { id: row.targetId }, select: { id: true, userId: true, placements: true } });
  if (!rental) return review('The store rental no longer exists.');
  if (rental.userId !== row.userId) return review('The store rental belongs to a different account.');
  const placements = asRecord(rental.placements);
  const pending = asRecord(placements.pendingRenewal);
  if (!placements.pendingRenewal) {
    return placements.paymentStatus === 'CONFIRMED' ? done('Renewal was already confirmed.') : review('There is no pending renewal to confirm.');
  }
  if (`renewal:${String(pending.plan)}:${String(pending.tier)}:${Number(pending.fee)}` !== asRecord(row.metadata).fingerprint) {
    return review('The renewal was changed after the payment started.');
  }
  try {
    await confirmPendingRenewal(rental.id);
    invalidateCategoryCounts(); // reopening a store changes what is publicly visible
    return done();
  } catch (err) {
    if (isClientError(err)) return review(`Could not confirm the renewal: ${err.message}`);
    throw err;
  }
}

async function provisionStoreRental(row: PaymentTransaction): Promise<ProvisionResult> {
  const result = await prisma.$transaction(async (tx): Promise<ProvisionResult & { ownerId?: string }> => {
    await tx.$queryRaw`SELECT "id" FROM "StoreRental" WHERE "id" = ${row.targetId} FOR UPDATE`;
    const rental = await tx.storeRental.findUnique({ where: { id: row.targetId }, select: { id: true, userId: true, status: true, fee: true, placements: true } });
    if (!rental) return review('The store application no longer exists.');
    if (rental.userId !== row.userId) return review('The store application belongs to a different account.');
    if (rental.status === 'ACTIVE') return done('Already active (approved before the payment was processed).');
    if (rental.status !== 'PENDING') return review(`The store application is ${rental.status} — payment arrived after it ended.`);
    if (Number(rental.fee) !== Number(row.amount)) return review('The store fee changed after the payment started.');
    const placements = asRecord(rental.placements);
    if (placements.paymentStatus === 'CONFIRMED') return done('Already marked as paid.');

    await tx.storeRental.update({
      where: { id: rental.id },
      data: { placements: { ...placements, paymentStatus: 'CONFIRMED', paymentRef: row.referenceId, paidAt: new Date().toISOString() } as Prisma.InputJsonValue },
    });
    await tx.notification.create({
      data: {
        userId: rental.userId, type: 'SYSTEM', title: 'Store payment received',
        message: 'We received your store payment. Your application is now waiting for admin approval.',
        data: { rentalId: rental.id } as Prisma.InputJsonValue,
      },
    });
    const admins = await tx.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admins.length > 0) {
      await tx.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id, type: 'SYSTEM' as const, title: 'Paid store application',
          message: 'A store application has been paid by mobile money and is ready for review.',
          data: { rentalId: rental.id, paymentId: row.id } as Prisma.InputJsonValue,
        })),
      });
    }
    return done();
  }, { timeout: 20_000, maxWait: 10_000 });
  return result.kind === 'DONE' ? done(result.note) : review(result.note);
}

/** Exported for unit tests. */
export async function provisionListingTier(row: PaymentTransaction, now: Date): Promise<ProvisionResult> {
  const meta = asRecord(row.metadata);
  const tier = String(meta.tier ?? '');
  const days = Number(meta.durationDays);
  if (!(tier in TIER_RANK) || tier === 'FREE' || !(days > 0)) return review('The payment has no valid tier details.');
  const listing = await prisma.listing.findUnique({ where: { id: row.targetId }, select: { id: true, title: true, userId: true, tier: true, status: true } });
  if (!listing) return review('The listing no longer exists.');
  // PENDING is fine: the customer paid while the ad awaits approval. The tier is recorded now; the paid period starts when the ad is approved (utils/listingTierClock.ts).
  if (!canBuyListingTier(listing.status)) return review(`The listing is ${listing.status} — it was changed after the payment started.`);
  if (listing.userId !== row.userId) return review('The listing belongs to a different account.');

  const lower = Object.keys(TIER_RANK).filter((t) => TIER_RANK[t] < TIER_RANK[tier]) as Array<'FREE' | 'GOLD'>;
  const tierExpiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  // Conditional: never downgrade a listing that was upgraded in the meantime, never apply twice.
  const res = await prisma.listing.updateMany({
    where: { id: listing.id, tier: { in: lower } },
    data: { tier: tier as 'GOLD' | 'PLATINUM', tierExpiresAt, requestedTier: null },
  });
  if (res.count === 0) return done('The listing already had this visibility level or higher.');
  const name = tier === 'GOLD' ? 'Gold' : 'Platinum';
  const awaitingApproval = listing.status === 'PENDING';
  if (awaitingApproval) {
    // The tier is recorded now, but the paid days must not run out while nobody can see the ad: remember
    // that the window has not really started, and approving the listing restarts it (utils/listingTierClock.ts).
    await prisma.paymentTransaction.update({ where: { id: row.id }, data: { metadata: { ...meta, awaitingApproval: true } as Prisma.InputJsonValue } })
      .catch((err) => logger.error('MoMo: could not mark tier payment as awaiting approval', err));
  }
  await prisma.notification.create({
    data: {
      userId: listing.userId, type: 'SYSTEM',
      title: awaitingApproval ? `${name} visibility paid` : `${name} visibility activated`,
      message: awaitingApproval
        ? `Payment received. Your listing "${listing.title}" will have ${name} visibility for the full paid period as soon as it is approved.`
        : `Your listing "${listing.title}" now has ${name} visibility until ${tierExpiresAt.toLocaleDateString()}.`,
      data: { listingId: listing.id },
    },
  }).catch((err) => logger.error('MoMo: tier notification failed', err));
  return done();
}

async function provisionCvDownload(row: PaymentTransaction, now: Date): Promise<ProvisionResult> {
  const token = await prisma.cvDownloadToken.findUnique({ where: { id: row.targetId }, select: { id: true, paid: true, expiresAt: true } });
  if (!token) return review('The download token no longer exists.');
  if (token.paid) return done('The download was already unlocked.');
  if (token.expiresAt.getTime() < now.getTime()) return review('The download session expired before the payment completed.');
  await prisma.cvDownloadToken.updateMany({ where: { id: token.id, paid: false }, data: { paid: true } });
  return done();
}

/**
 * A second payment for something another payment already granted (a late approval of an attempt
 * that looked expired, then a retry that also succeeded) must never be absorbed as "already
 * active → done": the payer was charged twice. Only a payment provisioned at/after this one was
 * created counts, so an earlier renewal term never makes a later renewal look like a duplicate.
 */
async function findDuplicateGrant(row: PaymentTransaction): Promise<{ id: string; referenceId: string } | null> {
  return prisma.paymentTransaction.findFirst({
    where: {
      purpose: row.purpose, targetId: row.targetId, id: { not: row.id },
      status: 'SUCCESSFUL', provisionedAt: { gte: row.createdAt },
    },
    select: { id: true, referenceId: true },
  });
}

async function provision(row: PaymentTransaction, now: Date): Promise<ProvisionResult> {
  const dup = await findDuplicateGrant(row);
  if (dup) return review(`Duplicate payment: this item was already paid for and granted by payment ${dup.referenceId}. Refund this one.`);
  switch (row.purpose) {
    case 'SUBSCRIPTION':
    case 'SUBSCRIPTION_RENEWAL':
    case 'SUBSCRIPTION_UPGRADE': return provisionSubscription(row);
    case 'STORE_RENEWAL': return provisionStoreRenewal(row);
    case 'STORE_RENTAL': return provisionStoreRental(row);
    case 'LISTING_TIER': return provisionListingTier(row, now);
    case 'CV_DOWNLOAD': return provisionCvDownload(row, now);
    default: return review(`Unknown purpose ${String(row.purpose)}`);
  }
}

async function tryProvision(row: PaymentTransaction, now: Date): Promise<PaymentTransaction> {
  const lease = await prisma.paymentTransaction.updateMany({
    where: {
      id: row.id, status: 'SUCCESSFUL', provisionedAt: null,
      OR: [{ provisioningStartedAt: null }, { provisioningStartedAt: { lt: new Date(now.getTime() - PROVISION_LEASE_MS) } }],
    },
    data: { provisioningStartedAt: now },
  });
  if (lease.count !== 1) return reload(row.id); // someone else is (or was just) provisioning

  try {
    const result = await provision(row, now);
    if (result.kind === 'DONE') {
      const done = await prisma.paymentTransaction.updateMany({
        where: { id: row.id, status: 'SUCCESSFUL', provisionedAt: null },
        data: { provisionedAt: new Date(), provisionNote: result.note ?? null },
      });
      // Paid and access granted: issue the receipt (unique tracking code) and email the PDF. A receipt
      // problem must never undo or hide a successful payment, so it is logged and retried later.
      if (done.count === 1) await issueReceipt(row.id).catch((err) => logger.error(`MoMo: receipt issue failed for ${row.id}`, err));
    } else {
      const res = await prisma.paymentTransaction.updateMany({
        where: { id: row.id, status: 'SUCCESSFUL', provisionedAt: null },
        data: { status: 'NEEDS_REVIEW', provisionNote: result.note.slice(0, 500) },
      });
      if (res.count === 1) {
        logger.error(`MoMo: payment ${row.id} needs review: ${result.note}`);
        await notifyAdmins('Payment needs review', `A mobile money payment was received but access could not be granted automatically: ${result.note} Reference ${row.referenceId}.`, { paymentId: row.id });
      }
    }
  } catch (err) {
    // Unexpected failure: keep the lease (so the reconciler retries after PROVISION_LEASE_MS) and note why.
    logger.error(`MoMo: provisioning failed for ${row.id}`, err);
    await prisma.paymentTransaction.updateMany({
      where: { id: row.id, status: 'SUCCESSFUL', provisionedAt: null },
      data: { provisionNote: `ERROR: ${(err as Error).message}`.slice(0, 300) },
    });
  }
  return reload(row.id);
}

// ─── Reads for the API ──────────────────────────────────────────────────────

async function assertCanView(row: PaymentTransaction, actor: Actor, rawToken?: unknown): Promise<void> {
  if (actor.role === 'ADMIN') return;
  if (actor.userId && row.userId === actor.userId) return;
  if (row.purpose === 'CV_DOWNLOAD' && typeof rawToken === 'string' && rawToken) {
    const token = await prisma.cvDownloadToken.findUnique({ where: { id: row.targetId }, select: { tokenHash: true } });
    if (token && safeEqual(sha256(rawToken), token.tokenHash)) return;
  }
  throw createError('Payment not found', 404); // 404, not 403: do not confirm that someone else's id exists
}

/** The payer polls this. It refreshes from MTN (throttled) so no background timing is needed for a quick answer. */
export async function getPaymentForActor(id: string, actor: Actor, rawToken?: unknown, now: Date = new Date()): Promise<PaymentView> {
  let row = await prisma.paymentTransaction.findUnique({ where: { id } });
  if (!row) throw createError('Payment not found', 404);
  await assertCanView(row, actor, rawToken);
  const open = row.status === 'PENDING' || (row.status === 'SUCCESSFUL' && !row.provisionedAt);
  if (open && (!row.lastCheckedAt || now.getTime() - row.lastCheckedAt.getTime() >= LAZY_VERIFY_MIN_GAP_MS)) {
    row = await verifyPayment(row.id, now);
  }
  return toPaymentView(row);
}

/** MTN's callback: the signature only proves the URL is ours; the body is ignored and MTN is asked directly. */
export async function handleCallback(referenceId: string, signature: unknown): Promise<void> {
  const cfg = getMomoSettlementConfig(); // still accepted while an admin has paused new payments
  if (!cfg.callbackSecret || !verifyCallbackSignature(referenceId, signature, cfg.callbackSecret)) throw createError('Forbidden', 403);
  const row = await prisma.paymentTransaction.findUnique({ where: { referenceId }, select: { id: true } });
  if (!row) throw createError('Payment not found', 404);
  await verifyPayment(row.id);
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export interface AdminPaymentFilters { status?: string; purpose?: string; search?: string; page?: number; limit?: number }

export async function listPayments(f: AdminPaymentFilters) {
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(f.limit ?? 25)));
  const where: Prisma.PaymentTransactionWhereInput = {};
  if (f.status && f.status in PaymentStatusSet) where.status = f.status as PaymentStatus;
  if (f.purpose && f.purpose in PaymentPurposeSet) where.purpose = f.purpose as PaymentPurpose;
  const q = f.search?.trim();
  if (q) where.OR = [{ referenceId: q }, { targetId: q }, { userId: q }, { financialTransactionId: q }];
  const [rows, total] = await Promise.all([
    prisma.paymentTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.paymentTransaction.count({ where }),
  ]);
  return {
    total, page, limit,
    items: rows.map((r) => ({
      ...toPaymentView(r),
      userId: r.userId, referenceId: r.referenceId, environment: r.environment,
      financialTransactionId: r.financialTransactionId, providerStatus: r.providerStatus,
      failureReason: r.failureReason, provisionNote: r.provisionNote, provisionedAt: r.provisionedAt,
      updatedAt: r.updatedAt,
    })),
  };
}
const PaymentStatusSet: Record<string, true> = { PENDING: true, SUCCESSFUL: true, FAILED: true, EXPIRED: true, NEEDS_REVIEW: true, REFUNDED: true };
const PaymentPurposeSet: Record<string, true> = { SUBSCRIPTION: true, SUBSCRIPTION_RENEWAL: true, SUBSCRIPTION_UPGRADE: true, STORE_RENTAL: true, STORE_RENEWAL: true, LISTING_TIER: true, CV_DOWNLOAD: true };

export type ReviewOutcome = 'GRANTED' | 'REFUNDED';

/**
 * Admin handled a NEEDS_REVIEW payment by hand. `GRANTED`: access was given manually (payment ends
 * SUCCESSFUL + provisioned). `REFUNDED`: the money was returned outside the system (payment ends
 * REFUNDED and never reads as "completed" to the payer or to revenue reports).
 */
export async function resolveReviewedPayment(id: string, note: string, adminId: string, outcome: unknown): Promise<PaymentView> {
  const text = note.trim();
  if (!text) throw createError('A resolution note is required', 400);
  if (outcome !== 'GRANTED' && outcome !== 'REFUNDED') throw createError('outcome must be GRANTED or REFUNDED', 400);
  const provisionNote = `${outcome === 'REFUNDED' ? 'Refunded' : 'Granted manually'} by admin ${adminId}: ${text}`.slice(0, 500);
  const res = await prisma.paymentTransaction.updateMany({
    where: { id, status: 'NEEDS_REVIEW' },
    data: outcome === 'REFUNDED'
      ? { status: 'REFUNDED', provisionNote }
      : { status: 'SUCCESSFUL', provisionedAt: new Date(), provisionNote },
  });
  if (res.count === 0) throw createError('Only a payment awaiting review can be resolved', 409);
  // An admin granting a reviewed payment completes it, so the payer gets their receipt too.
  if (outcome === 'GRANTED') await issueReceipt(id).catch((err) => logger.error(`MoMo: receipt issue failed for ${id}`, err));
  return toPaymentView(await reload(id));
}
