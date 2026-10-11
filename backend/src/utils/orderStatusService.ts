import {
  canTransition,
  isDenied,
  computeSettlement,
  resolveFeePercent,
  OrderActor,
  TransitionOptions,
} from './orderLifecycle';
import {
  DELIVERY_CODE_MAX_ATTEMPTS,
  normalizeSuppliedCode,
  verifyDeliveryCode,
} from './deliveryCode';

// ─── Atomic order status changes ────────────────────────────────────────────
//
// Both order-status routes call changeOrderStatus(). Guarantees:
//   • only transitions allowed by orderLifecycle.canTransition() happen;
//   • the status change, seller balance credit and payment update are ONE
//     database transaction (all or nothing);
//   • the order row is updated with a compare-and-set on its current status
//     (and `payoutCreditedAt IS NULL` for delivery), so two simultaneous
//     requests cannot both credit the seller — the loser gets a 409;
//   • re-sending the current status is a no-op with no side effects;
//   • marking DELIVERED needs PROOF the customer got the goods: the buyer's
//     own confirmation, or the buyer's 6-digit delivery code (wrong guesses
//     are counted and lock the order after DELIVERY_CODE_MAX_ATTEMPTS), or an
//     admin override with a written reason. How it was confirmed is stored.
//   • the platform fee is not charged when the seller is an admin account
//     (Piitrade selling its own listing).
//   • REFUNDING a delivered order reverses the seller's payout (exactly once),
//     marks the payment REFUNDED and records who refunded it and why. The money
//     itself is sent back to the buyer by hand (MTN) — the system does not move it.

/** Error carrying an HTTP status; errorHandler reads `statusCode`. */
export class OrderStatusError extends Error {
  statusCode: number;
  isOperational = true;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'OrderStatusError';
    this.statusCode = statusCode;
  }
}

// Deliberately loose structural types: the real Prisma transaction client is
// passed in at runtime (cast at the call site), and tests pass an in-memory
// fake. See orderStatusService.test.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OrderTx {
  order: {
    updateMany(args: any): Promise<{ count: number }>;
    findUnique(args: any): Promise<any>;
  };
  user: { update(args: any): Promise<any>; findUnique(args: any): Promise<any> };
  payment: { updateMany(args: any): Promise<any>; findUnique(args: any): Promise<any> };
  siteConfig: { findUnique(args: any): Promise<any> };
  notification: { create(args: any): Promise<any> };
}

export interface OrderDb {
  $transaction<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T>;
  /** Used OUTSIDE a transaction to record wrong delivery-code guesses, so the count survives the rejected request. */
  order: { updateMany(args: any): Promise<{ count: number }> };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface OrderSnapshot {
  id: string;
  status: string;
  sellerId: string;
  total: number;
  shippingCost: number;
  /** Wrong delivery-code guesses so far (0 if the column is absent/unset). */
  deliveryCodeAttempts?: number | null;
}

const SITE_CONFIG_ID = 'global';
const PAYMENT_REQUIRED_STATUSES = new Set(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);

/**
 * Platform fee % from the admin payment settings (paymentSettings.platformFeePercent).
 * Missing or invalid -> 0 (no fee) so a misconfiguration can never overcharge.
 */
export async function loadPlatformFeePercent(tx: Pick<OrderTx, 'siteConfig'>): Promise<number> {
  const config = await tx.siteConfig.findUnique({
    where: { id: SITE_CONFIG_ID },
    select: { paymentSettings: true },
  });
  const settings = (config?.paymentSettings ?? {}) as Record<string, unknown>;
  return resolveFeePercent(settings.platformFeePercent);
}

export interface ChangeInput {
  trackingNumber?: string;
  cancellationNote?: string;
  /** The customer's 6-digit code, as typed (seller, or admin instead of an override). */
  deliveryCode?: unknown;
  /** Admin only: why delivery is being confirmed without the customer's code. */
  overrideReason?: unknown;
  /** Id of the user making the change; recorded as who confirmed delivery / refunded. */
  actorUserId?: string;
  /** Required for REFUNDED: why the order is being refunded (audit trail). */
  refundReason?: unknown;
}

export interface ChangeOptions extends TransitionOptions {
  /**
   * Require proof of delivery from sellers (and a code or reason from admins).
   * Default true. Only set false to restore the legacy "seller just clicks
   * delivered" behaviour.
   */
  requireDeliveryProof?: boolean;
  /** Secret used to derive delivery codes (see deliveryCode.ts). Required when proof is required. */
  deliveryCodeSecret?: string | null;
}

type ConfirmMethod = 'BUYER' | 'CODE' | 'ADMIN_OVERRIDE' | 'NONE';

interface DeliveryProof {
  method: ConfirmMethod;
  overrideReason?: string;
  /** Code-based confirmation also re-checks the attempt cap inside the transaction. */
  enforceAttemptCap: boolean;
}

const MIN_OVERRIDE_REASON = 5;

function requireRefundReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < MIN_OVERRIDE_REASON || !/\p{L}/u.test(reason)) {
    throw new OrderStatusError(400, `Give a reason for the refund (at least ${MIN_OVERRIDE_REASON} characters, with words).`);
  }
  return reason.slice(0, 500);
}

/**
 * Decides whether this actor has produced acceptable proof that the customer
 * received the goods. Throws OrderStatusError otherwise. A WRONG code is
 * counted here, in its own statement outside the later transaction, so the
 * counter is kept even though the request is rejected.
 */
async function requireProofOfDelivery(
  db: OrderDb,
  order: OrderSnapshot,
  actor: OrderActor,
  input: ChangeInput,
  opts: ChangeOptions,
): Promise<DeliveryProof> {
  if (actor === 'BUYER') return { method: 'BUYER', enforceAttemptCap: false };
  if (opts.requireDeliveryProof === false) return { method: 'NONE', enforceAttemptCap: false };

  const supplied = input.deliveryCode;
  const hasCode = !(supplied === undefined || supplied === null || String(supplied).trim() === '');

  // Admin with no code: must justify the override in writing (audit trail).
  if (actor === 'ADMIN' && !hasCode) {
    const reason = typeof input.overrideReason === 'string' ? input.overrideReason.trim() : '';
    // Must read like a reason, not a mistyped code: long enough AND containing a letter.
    if (reason.length < MIN_OVERRIDE_REASON || !/\p{L}/u.test(reason)) {
      throw new OrderStatusError(
        400,
        `Enter the customer's delivery code, or a written reason (at least ${MIN_OVERRIDE_REASON} characters, with words) for confirming delivery without it.`,
      );
    }
    return { method: 'ADMIN_OVERRIDE', overrideReason: reason.slice(0, 500), enforceAttemptCap: false };
  }

  // Seller (or admin who supplied a code): the customer's code is required.
  const secret = opts.deliveryCodeSecret;
  if (!secret || secret.length < 16) {
    // Fail closed: never accept "any code" because the secret is not configured.
    throw new OrderStatusError(500, 'Delivery confirmation is not configured on the server. Contact support.');
  }
  const attempts = order.deliveryCodeAttempts ?? 0;
  if (attempts >= DELIVERY_CODE_MAX_ATTEMPTS) {
    throw new OrderStatusError(
      423,
      'Too many incorrect delivery codes were entered for this order. Contact Piitrade support to confirm delivery.',
    );
  }
  const code = normalizeSuppliedCode(supplied);
  if (!code) {
    // Malformed input is not a guess and does not use up an attempt.
    throw new OrderStatusError(400, "Enter the 6-digit delivery code shown on the customer's order page.");
  }
  if (!verifyDeliveryCode(order.id, code, secret)) {
    const r = await db.order.updateMany({
      where: { id: order.id, deliveryCodeAttempts: { lt: DELIVERY_CODE_MAX_ATTEMPTS } },
      data: { deliveryCodeAttempts: { increment: 1 } },
    });
    if (r.count === 0) {
      throw new OrderStatusError(423, 'Too many incorrect delivery codes were entered for this order. Contact Piitrade support.');
    }
    const left = Math.max(0, DELIVERY_CODE_MAX_ATTEMPTS - (attempts + 1));
    throw new OrderStatusError(
      403,
      left > 0
        ? `Incorrect delivery code. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Incorrect delivery code. This order is now locked — contact Piitrade support.',
    );
  }
  return { method: 'CODE', enforceAttemptCap: true };
}

export interface ChangeResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  /** false when the order already had this status (no side effects were run). */
  changed: boolean;
}

const INCLUDE = { items: true, payment: true };

export async function changeOrderStatus(
  db: OrderDb,
  order: OrderSnapshot,
  newStatus: string,
  actor: OrderActor,
  input: ChangeInput = {},
  opts: ChangeOptions = {},
): Promise<ChangeResult> {
  const decision = canTransition(order.status, newStatus, actor, opts);
  if (isDenied(decision)) {
    const http = decision.code === 'FORBIDDEN' ? 403 : decision.code === 'UNKNOWN_STATUS' ? 400 : 409;
    throw new OrderStatusError(http, decision.message);
  }

  if (decision.noop) {
    const current = await db.$transaction((tx) => tx.order.findUnique({ where: { id: order.id }, include: INCLUDE }));
    return { order: current, changed: false };
  }

  // Proof is checked BEFORE the transaction: a wrong guess must be recorded
  // even though the request then fails.
  const proof: DeliveryProof | null =
    newStatus === 'DELIVERED' ? await requireProofOfDelivery(db, order, actor, input, opts) : null;

  const refundReason = newStatus === 'REFUNDED' ? requireRefundReason(input.refundReason) : null;

  const now = new Date();
  const conflict = () =>
    new OrderStatusError(409, 'This order was just changed by someone else. Reload and try again.');

  const updated = await db.$transaction(async (tx) => {
    // A mobile-money order cannot move forward — and so the seller can never be
    // paid for it — until an admin has CONFIRMED the buyer's payment. (Cancelling
    // is always allowed; cash-on-delivery orders are not affected.)
    if (PAYMENT_REQUIRED_STATUSES.has(newStatus)) {
      const pay = await tx.payment.findUnique({ where: { orderId: order.id } });
      if (pay && pay.method === 'MOBILE_MONEY' && pay.status !== 'COMPLETED') {
        throw new OrderStatusError(409, 'Payment for this order has not been confirmed yet.');
      }
    }

    if (newStatus === 'DELIVERED') {
      // No platform fee when Piitrade itself is the seller (admin account).
      const seller = await tx.user.findUnique({ where: { id: order.sellerId }, select: { role: true } });
      const feePercent = seller?.role === 'ADMIN' ? 0 : await loadPlatformFeePercent(tx);
      const s = computeSettlement(order, feePercent);

      // Compare-and-set: only succeeds if the order is STILL in the status we
      // validated against and has never been paid out.
      const res = await tx.order.updateMany({
        where: {
          id: order.id,
          status: order.status,
          payoutCreditedAt: null,
          // A code-based confirmation also fails if guesses locked the order meanwhile.
          ...(proof?.enforceAttemptCap ? { deliveryCodeAttempts: { lt: DELIVERY_CODE_MAX_ATTEMPTS } } : {}),
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          platformFee: s.platformFee,
          sellerPayout: s.sellerPayout,
          payoutCreditedAt: now,
          deliveryConfirmMethod: proof?.method ?? null,
          deliveryConfirmedById: input.actorUserId ?? null,
          deliveryOverrideReason: proof?.overrideReason ?? null,
          ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
        },
      });
      if (res.count !== 1) throw conflict();

      if (s.sellerPayout > 0) {
        await tx.user.update({
          where: { id: order.sellerId },
          data: { balance: { increment: s.sellerPayout } },
        });
      }
      // Keep an earlier paidAt (e.g. from a manually confirmed payment) if present.
      await tx.payment.updateMany({
        where: { orderId: order.id, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', paidAt: now },
      });
    } else if (newStatus === 'REFUNDED') {
      // Reverse the payout that was credited at delivery — once. payoutReversedAt
      // is the guard (compare-and-set), exactly like payoutCreditedAt on the way in.
      const cur = await tx.order.findUnique({
        where: { id: order.id },
        select: { sellerPayout: true, payoutCreditedAt: true },
      });
      const res = await tx.order.updateMany({
        where: { id: order.id, status: order.status, payoutReversedAt: null },
        data: {
          status: 'REFUNDED',
          payoutReversedAt: now,
          refundReason,
          refundedById: input.actorUserId ?? null,
        },
      });
      if (res.count !== 1) throw conflict();

      const payout = cur?.payoutCreditedAt ? Number(cur.sellerPayout ?? 0) : 0;
      if (payout > 0) {
        // May leave the seller's balance NEGATIVE if they already withdrew it;
        // withdrawals are blocked until later sales cover the shortfall.
        await tx.user.update({ where: { id: order.sellerId }, data: { balance: { decrement: payout } } });
      }
      const pay = await tx.payment.findUnique({ where: { orderId: order.id } });
      if (pay && pay.status === 'COMPLETED') {
        await tx.payment.updateMany({
          where: { orderId: order.id, status: 'COMPLETED' },
          data: { status: 'REFUNDED', refundedAt: now, refundAmount: pay.amount },
        });
      }
      const full = await tx.order.findUnique({ where: { id: order.id }, select: { orderNumber: true, buyerId: true } });
      if (full) {
        await tx.notification.create({
          data: {
            userId: order.sellerId,
            type: 'SYSTEM',
            title: 'Order refunded',
            message: `Order ${full.orderNumber} was refunded to the buyer.${payout > 0 ? ` Your earlier payout of ${payout} was reversed.` : ''}`,
            data: { orderId: order.id },
          },
        });
        await tx.notification.create({
          data: {
            userId: full.buyerId,
            type: 'SYSTEM',
            title: 'Refund approved',
            message: `Your refund for order ${full.orderNumber} was approved. Piitrade will send the money back to you.`,
            data: { orderId: order.id },
          },
        });
      }
    } else {
      const data: Record<string, unknown> = { status: newStatus };
      if (input.trackingNumber) data.trackingNumber = input.trackingNumber;
      if (newStatus === 'SHIPPED') data.shippedAt = now;
      if (newStatus === 'CANCELLED') {
        data.cancelledAt = now;
        if (input.cancellationNote) data.cancellationNote = input.cancellationNote;
      }

      const res = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data });
      if (res.count !== 1) throw conflict();
    }

    return tx.order.findUnique({ where: { id: order.id }, include: INCLUDE });
  });

  return { order: updated, changed: true };
}
