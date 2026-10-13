"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_CODE_MAX_ATTEMPTS = exports.DELIVERY_CODE_LENGTH = void 0;
exports.resolveDeliveryCodeSecret = resolveDeliveryCodeSecret;
exports.deriveDeliveryCode = deriveDeliveryCode;
exports.normalizeSuppliedCode = normalizeSuppliedCode;
exports.verifyDeliveryCode = verifyDeliveryCode;
const crypto_1 = __importDefault(require("crypto"));
// ─── Delivery confirmation code ─────────────────────────────────────────────
//
// Proof that the CUSTOMER received the goods before the seller is paid.
// Each order has a 6-digit code that only the buyer (and an admin) can see.
// At handover the customer reads the code out (or shows it / its QR) and the
// seller enters it to mark the order DELIVERED.
//
// The code is DERIVED, not stored:  HMAC-SHA256(secret, "delivery:" + orderId)
// reduced to 6 digits. So:
//   • there is nothing in the database to leak or to copy between orders;
//   • the buyer's order page can always re-display the same code;
//   • it is useless without the server secret.
// Brute force is bounded by an attempt counter on the order (see
// orderStatusService): 6 digits with 5 tries is a 5-in-a-million guess.
exports.DELIVERY_CODE_LENGTH = 6;
exports.DELIVERY_CODE_MAX_ATTEMPTS = 5;
const MIN_SECRET_LENGTH = 16;
/**
 * Picks the signing secret. DELIVERY_CODE_SECRET is preferred so the codes
 * can be rotated independently; JWT_SECRET (already required by the app) is
 * the fallback. There is deliberately NO built-in default: a guessable
 * default would make every code predictable.
 */
function resolveDeliveryCodeSecret(env = process.env) {
    const s = env.DELIVERY_CODE_SECRET || env.JWT_SECRET;
    return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}
function deriveDeliveryCode(orderId, secret) {
    if (!orderId)
        throw new Error('orderId is required');
    if (!secret || secret.length < MIN_SECRET_LENGTH)
        throw new Error('delivery code secret is missing or too short');
    const digest = crypto_1.default.createHmac('sha256', secret).update(`delivery:${orderId}`).digest();
    const n = digest.readUInt32BE(0) % 10 ** exports.DELIVERY_CODE_LENGTH;
    return String(n).padStart(exports.DELIVERY_CODE_LENGTH, '0');
}
/**
 * Accepts what a person might type: spaces, dashes or a leading/trailing
 * space ("123 456", "123-456"). Returns the bare 6 digits, or null if the
 * input cannot possibly be a code (wrong length / non-digits). Malformed
 * input is rejected WITHOUT counting as a guess.
 */
function normalizeSuppliedCode(input) {
    if (typeof input !== 'string' && typeof input !== 'number')
        return null;
    const cleaned = String(input).replace(/[\s-]/g, '');
    return new RegExp(`^\\d{${exports.DELIVERY_CODE_LENGTH}}$`).test(cleaned) ? cleaned : null;
}
/** Constant-time comparison of a normalised supplied code against the real one. */
function verifyDeliveryCode(orderId, supplied, secret) {
    const expected = Buffer.from(deriveDeliveryCode(orderId, secret));
    const given = Buffer.from(supplied);
    return given.length === expected.length && crypto_1.default.timingSafeEqual(given, expected);
}
//# sourceMappingURL=deliveryCode.js.map