// ─── Order lifecycle rules (pure — no database, no Express) ────────────────
//
// Single source of truth for (a) which order-status changes are legal and
// who may make them, and (b) how a delivered order is split between the
// platform fee and the seller payout. Used by both PUT /orders/:id/status
// (buyer/seller/admin) and PUT /admin/orders/:id/status, which previously
// each re-implemented the status change and both credited the seller on
// every DELIVERED call.
//
// Business model this encodes: ALL buyer payments are received by the
// platform (admin). When an order is delivered the platform keeps its fee
// and credits the remainder to the seller's balance, which the seller then
// withdraws through the existing withdrawal flow.

export type OrderStatusName =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type OrderActor = 'ADMIN' | 'SELLER' | 'BUYER';

export const ALL_ORDER_STATUSES: readonly OrderStatusName[] = [
  'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
];

// The normal forward path. A status may be skipped going forward (small
// sellers often go CONFIRMED -> DELIVERED), but never reversed by a seller.
const FORWARD_PATH: readonly OrderStatusName[] = [
  'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED',
];

export interface TransitionOptions {
  /**
   * Whether a seller (not just an admin) may mark an order DELIVERED. This
   * triggers the seller payout. Defaults to true to preserve the behaviour
   * the seller dashboard already offers; set false once the business wants
   * payout released only on admin-confirmed delivery.
   */
  sellerCanMarkDelivered?: boolean;
}

export interface TransitionAllowed { ok: true; noop: boolean }
export interface TransitionDenied {
  ok: false;
  code: 'UNKNOWN_STATUS' | 'ILLEGAL' | 'FORBIDDEN';
  message: string;
}
export type TransitionDecision = TransitionAllowed | TransitionDenied;

/**
 * Type guard rather than `if (!d.ok)`: this repo's tsconfig has `strict: false`
 * (no strictNullChecks), under which TypeScript does not narrow a union on a
 * boolean discriminant — `d.code` would fail to compile.
 */
export const isDenied = (d: TransitionDecision): d is TransitionDenied => d.ok === false;

const isKnownStatus = (s: unknown): s is OrderStatusName =>
  typeof s === 'string' && (ALL_ORDER_STATUSES as readonly string[]).includes(s);

export function canTransition(
  from: string,
  to: string,
  actor: OrderActor,
  opts: TransitionOptions = {},
): TransitionDecision {
  const sellerCanMarkDelivered = opts.sellerCanMarkDelivered !== false;

  if (!isKnownStatus(from) || !isKnownStatus(to)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `Unknown order status "${String(to)}"` };
  }
  // Re-sending the status the order already has is a harmless no-op (e.g. a
  // double-click on "Mark delivered"); the caller must NOT repeat side effects.
  if (from === to) return { ok: true, noop: true };

  const illegal = (message: string): TransitionDecision => ({ ok: false, code: 'ILLEGAL', message });
  const forbidden = (message: string): TransitionDecision => ({ ok: false, code: 'FORBIDDEN', message });

  // Terminal states: nothing leaves them.
  if (from === 'CANCELLED' || from === 'REFUNDED') {
    return illegal(`A ${from.toLowerCase()} order cannot change status`);
  }

  // Money has moved once an order is DELIVERED. Only an admin can refund it.
  if (from === 'DELIVERED') {
    if (to === 'REFUNDED') {
      return actor === 'ADMIN' ? { ok: true, noop: false } : forbidden('Only an admin can refund a delivered order');
    }
    return illegal('A delivered order can only be refunded');
  }

  if (to === 'REFUNDED') return illegal('Only a delivered order can be refunded');

  if (to === 'CANCELLED') {
    if (actor === 'BUYER') {
      return from === 'PENDING' || from === 'CONFIRMED'
        ? { ok: true, noop: false }
        : forbidden('You can only cancel an order before it is processed');
    }
    if (from === 'SHIPPED') {
      return actor === 'ADMIN' ? { ok: true, noop: false } : forbidden('Only an admin can cancel a shipped order');
    }
    return { ok: true, noop: false };
  }

  // Everything below is a move along the forward path.
  if (actor === 'BUYER') {
    // A buyer may confirm they RECEIVED the goods (SHIPPED -> DELIVERED). That
    // confirmation is itself the proof of delivery, so it needs no code.
    return from === 'SHIPPED' && to === 'DELIVERED'
      ? { ok: true, noop: false }
      : forbidden('Buyers may only cancel an order or confirm they received it');
  }

  const fromIdx = FORWARD_PATH.indexOf(from);
  const toIdx = FORWARD_PATH.indexOf(to);

  if (toIdx > fromIdx) {
    if (to === 'DELIVERED' && actor === 'SELLER' && !sellerCanMarkDelivered) {
      return forbidden('Only an admin can mark an order delivered');
    }
    return { ok: true, noop: false };
  }

  // Backwards (correcting a mis-click) — admin only, and never out of DELIVERED
  // (handled above).
  return actor === 'ADMIN' ? { ok: true, noop: false } : illegal('An order cannot move back to an earlier status');
}

// ─── Platform fee & seller payout ───────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Reads a fee percentage from an untrusted value (the admin payment-settings
 * JSON accepts any value for an allowed key). Anything that is not a finite
 * number in [0, 100] resolves to 0 — i.e. "no fee" — rather than throwing at
 * delivery time or charging a nonsense fee.
 */
export function resolveFeePercent(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return 0;
  return n;
}

export interface Settlement {
  /** Amount the fee is calculated on: order total minus shipping (the basis the app already used for the seller's share). */
  base: number;
  platformFee: number;
  sellerPayout: number;
}

export function computeSettlement(
  order: { total: number; shippingCost: number },
  feePercent: number,
): Settlement {
  const base = Math.max(0, round2((order.total || 0) - (order.shippingCost || 0)));
  const platformFee = Math.min(base, round2((base * resolveFeePercent(feePercent)) / 100));
  const sellerPayout = round2(base - platformFee);
  return { base, platformFee, sellerPayout };
}
