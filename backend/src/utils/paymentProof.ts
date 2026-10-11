// ─── Manual mobile-money payments (pure rules — no database, no Express) ────
//
// There is no MTN API integration. The flow is:
//   1. Buyer places the order; it gets a payment deadline (admin-configurable).
//   2. Buyer sends the exact amount to the admin's MTN number, quoting the
//      order number, then submits the MTN transaction ID, their phone number
//      and the amount they sent.
//   3. An ADMIN compares that claim with the MTN statement and confirms or
//      rejects it. Only a human confirmation marks the payment as paid.
//   4. If nothing is submitted before the deadline the order is cancelled.
//
// A transaction ID typed by the buyer is a CLAIM, never proof. Nothing here
// (or anywhere) treats it as payment.

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Deadline ────────────────────────────────────────────────────────────────
export const DEFAULT_PAYMENT_DEADLINE_MINUTES = 30;
export const MIN_PAYMENT_DEADLINE_MINUTES = 5;
export const MAX_PAYMENT_DEADLINE_MINUTES = 1440; // 24 hours

/**
 * Reads the deadline from admin settings (untrusted JSON): a number or numeric
 * string, rounded, clamped to 5 minutes – 24 hours. Missing or invalid -> 30.
 */
export function resolveDeadlineMinutes(raw: unknown): number {
  // A blank string is "not set", not zero (Number('') === 0 would clamp to 5 min).
  const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw.trim())) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_PAYMENT_DEADLINE_MINUTES;
  return Math.min(MAX_PAYMENT_DEADLINE_MINUTES, Math.max(MIN_PAYMENT_DEADLINE_MINUTES, Math.round(n)));
}

export function computeDueAt(now: Date, minutes: number): Date {
  return new Date(now.getTime() + resolveDeadlineMinutes(minutes) * 60_000);
}

// ── Late payments ───────────────────────────────────────────────────────────
// A buyer may pay just after the window closes. The expiry sweep then cancels
// the order, but the money is real. For LATE_PROOF_GRACE_DAYS after the
// cancellation the buyer can still submit the transaction ID, and an admin can
// confirm it AND reinstate the order in one step.
export const LATE_PROOF_GRACE_DAYS = 7;

/**
 * True only for an order the EXPIRY SWEEP cancelled: a mobile-money order that
 * is CANCELLED whose payment was marked FAILED. The sweep is the only thing that
 * sets a payment FAILED, so an order the buyer or an admin cancelled (payment
 * still PENDING) is never eligible for reinstatement.
 */
export function isExpiredUnpaid(
  order: { status?: string } | null | undefined,
  payment: { method?: string; status?: string } | null | undefined,
): boolean {
  return !!order && !!payment && order.status === 'CANCELLED' && payment.method === 'MOBILE_MONEY' && payment.status === 'FAILED';
}

export function withinLateProofWindow(cancelledAt: unknown, now: Date): boolean {
  const t = cancelledAt ? new Date(cancelledAt as string | number | Date).getTime() : NaN;
  return Number.isFinite(t) && now.getTime() - t <= LATE_PROOF_GRACE_DAYS * 86_400_000;
}

// ── Proof input ─────────────────────────────────────────────────────────────
export const MAX_PROOFS_PER_ORDER = 3;

/** MTN transaction IDs: trim, drop spaces/dashes, upper-case; 6–32 letters/digits. */
export function normalizeTransactionId(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const cleaned = String(raw).replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{6,32}$/.test(cleaned) ? cleaned : null;
}

/** Phone: digits with an optional leading +, 9–15 digits (E.164 length range). */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? plus + digits : null;
}

export interface ProofInput {
  transactionId?: unknown;
  senderPhone?: unknown;
  amount?: unknown;
}
export type ProofValidation =
  | { ok: true; value: { transactionId: string; senderPhone: string; amountClaimed: number } }
  | { ok: false; message: string };

export function validateProofInput(input: ProofInput): ProofValidation {
  const transactionId = normalizeTransactionId(input.transactionId);
  if (!transactionId) {
    return { ok: false, message: 'Enter the MTN transaction ID from your payment confirmation (6–32 letters or digits).' };
  }
  const senderPhone = normalizePhone(input.senderPhone);
  if (!senderPhone) return { ok: false, message: 'Enter the phone number you paid from.' };
  const a = typeof input.amount === 'string' ? Number(input.amount.replace(/,/g, '').trim()) : input.amount;
  if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0) {
    return { ok: false, message: 'Enter the amount you sent.' };
  }
  return { ok: true, value: { transactionId, senderPhone, amountClaimed: round2(a) } };
}

// ── Admin's amount check ────────────────────────────────────────────────────
export type AmountCheck =
  | { ok: true; overpaidBy: number }
  | { ok: false; shortBy: number };

/**
 * The admin types the amount that ACTUALLY arrived (from the statement). An
 * underpayment can never be confirmed; an overpayment can, and is recorded.
 */
export function checkAmountReceived(orderTotal: number, received: number): AmountCheck {
  if (!Number.isFinite(received) || received < 0) return { ok: false, shortBy: round2(orderTotal) };
  const diff = round2(received - orderTotal);
  return diff < 0 ? { ok: false, shortBy: round2(-diff) } : { ok: true, overpaidBy: diff };
}

// ── Which payment methods may be used? ──────────────────────────────────────
export type AllowedMethod = 'MOBILE_MONEY' | 'CASH_ON_DELIVERY';

export interface MethodPolicyInput {
  requested: unknown;
  mobileMoneyEnabled: boolean;
  codEnabled: boolean;
  /** Cash on delivery is only for Piitrade's OWN listings (see below). */
  sellerIsAdmin: boolean;
}
export type MethodDecision =
  | { ok: true; method: AllowedMethod }
  | { ok: false; message: string };

/**
 * Only two methods exist: manual MOBILE_MONEY and CASH_ON_DELIVERY (the app
 * has no card/bank/wallet processing, so accepting those would create orders
 * that can never be paid yet still pay the seller at delivery).
 *
 * Cash on delivery is restricted to listings sold by Piitrade itself. For a
 * web store the platform collects the money and pays the store afterwards; with
 * cash on delivery the store would already hold the cash AND be credited the
 * payout — paid twice, with no way to take the platform fee.
 */
export function resolvePaymentMethod(i: MethodPolicyInput): MethodDecision {
  const requested = i.requested === undefined || i.requested === null || i.requested === '' ? 'CASH_ON_DELIVERY' : i.requested;
  if (requested === 'MOBILE_MONEY') {
    return i.mobileMoneyEnabled ? { ok: true, method: 'MOBILE_MONEY' } : { ok: false, message: 'Mobile money payment is not available right now.' };
  }
  if (requested === 'CASH_ON_DELIVERY') {
    if (!i.sellerIsAdmin) {
      return { ok: false, message: 'Cash on delivery is not available for this seller. Please pay with mobile money.' };
    }
    return i.codEnabled ? { ok: true, method: 'CASH_ON_DELIVERY' } : { ok: false, message: 'Cash on delivery is not available right now.' };
  }
  return { ok: false, message: 'Unsupported payment method.' };
}
