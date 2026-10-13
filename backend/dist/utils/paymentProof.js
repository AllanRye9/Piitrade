"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PROOFS_PER_ORDER = exports.LATE_PROOF_GRACE_DAYS = exports.MAX_PAYMENT_DEADLINE_MINUTES = exports.MIN_PAYMENT_DEADLINE_MINUTES = exports.DEFAULT_PAYMENT_DEADLINE_MINUTES = void 0;
exports.resolveDeadlineMinutes = resolveDeadlineMinutes;
exports.computeDueAt = computeDueAt;
exports.isExpiredUnpaid = isExpiredUnpaid;
exports.withinLateProofWindow = withinLateProofWindow;
exports.normalizeTransactionId = normalizeTransactionId;
exports.normalizePhone = normalizePhone;
exports.validateProofInput = validateProofInput;
exports.checkAmountReceived = checkAmountReceived;
exports.resolvePaymentMethod = resolvePaymentMethod;
const round2 = (n) => Math.round(n * 100) / 100;
// ── Deadline ────────────────────────────────────────────────────────────────
exports.DEFAULT_PAYMENT_DEADLINE_MINUTES = 30;
exports.MIN_PAYMENT_DEADLINE_MINUTES = 5;
exports.MAX_PAYMENT_DEADLINE_MINUTES = 1440; // 24 hours
/**
 * Reads the deadline from admin settings (untrusted JSON): a number or numeric
 * string, rounded, clamped to 5 minutes – 24 hours. Missing or invalid -> 30.
 */
function resolveDeadlineMinutes(raw) {
    // A blank string is "not set", not zero (Number('') === 0 would clamp to 5 min).
    const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw.trim())) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n))
        return exports.DEFAULT_PAYMENT_DEADLINE_MINUTES;
    return Math.min(exports.MAX_PAYMENT_DEADLINE_MINUTES, Math.max(exports.MIN_PAYMENT_DEADLINE_MINUTES, Math.round(n)));
}
function computeDueAt(now, minutes) {
    return new Date(now.getTime() + resolveDeadlineMinutes(minutes) * 60000);
}
// ── Late payments ───────────────────────────────────────────────────────────
// A buyer may pay just after the window closes. The expiry sweep then cancels
// the order, but the money is real. For LATE_PROOF_GRACE_DAYS after the
// cancellation the buyer can still submit the transaction ID, and an admin can
// confirm it AND reinstate the order in one step.
exports.LATE_PROOF_GRACE_DAYS = 7;
/**
 * True only for an order the EXPIRY SWEEP cancelled: a mobile-money order that
 * is CANCELLED whose payment was marked FAILED. The sweep is the only thing that
 * sets a payment FAILED, so an order the buyer or an admin cancelled (payment
 * still PENDING) is never eligible for reinstatement.
 */
function isExpiredUnpaid(order, payment) {
    return !!order && !!payment && order.status === 'CANCELLED' && payment.method === 'MOBILE_MONEY' && payment.status === 'FAILED';
}
function withinLateProofWindow(cancelledAt, now) {
    const t = cancelledAt ? new Date(cancelledAt).getTime() : NaN;
    return Number.isFinite(t) && now.getTime() - t <= exports.LATE_PROOF_GRACE_DAYS * 86400000;
}
// ── Proof input ─────────────────────────────────────────────────────────────
exports.MAX_PROOFS_PER_ORDER = 3;
/** MTN transaction IDs: trim, drop spaces/dashes, upper-case; 6–32 letters/digits. */
function normalizeTransactionId(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const cleaned = String(raw).replace(/[\s-]/g, '').toUpperCase();
    return /^[A-Z0-9]{6,32}$/.test(cleaned) ? cleaned : null;
}
/** Phone: digits with an optional leading +, 9–15 digits (E.164 length range). */
function normalizePhone(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const s = String(raw).trim();
    const plus = s.startsWith('+') ? '+' : '';
    const digits = s.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15 ? plus + digits : null;
}
function validateProofInput(input) {
    const transactionId = normalizeTransactionId(input.transactionId);
    if (!transactionId) {
        return { ok: false, message: 'Enter the MTN transaction ID from your payment confirmation (6–32 letters or digits).' };
    }
    const senderPhone = normalizePhone(input.senderPhone);
    if (!senderPhone)
        return { ok: false, message: 'Enter the phone number you paid from.' };
    const a = typeof input.amount === 'string' ? Number(input.amount.replace(/,/g, '').trim()) : input.amount;
    if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0) {
        return { ok: false, message: 'Enter the amount you sent.' };
    }
    return { ok: true, value: { transactionId, senderPhone, amountClaimed: round2(a) } };
}
/**
 * The admin types the amount that ACTUALLY arrived (from the statement). An
 * underpayment can never be confirmed; an overpayment can, and is recorded.
 */
function checkAmountReceived(orderTotal, received) {
    if (!Number.isFinite(received) || received < 0)
        return { ok: false, shortBy: round2(orderTotal) };
    const diff = round2(received - orderTotal);
    return diff < 0 ? { ok: false, shortBy: round2(-diff) } : { ok: true, overpaidBy: diff };
}
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
function resolvePaymentMethod(i) {
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
//# sourceMappingURL=paymentProof.js.map