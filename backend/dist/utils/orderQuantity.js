"use strict";
/**
 * Order-quantity rules for agriculture produce (Alibaba-style wholesale
 * selling): a minimum order quantity (MOQ) and volume price tiers.
 *
 *   MOQ 50, base price UGX 3,000 / kg, tiers [{100 → 2,800}, {500 → 2,500}]
 *   → 50–99 kg at 3,000 · 100–499 kg at 2,800 · 500+ kg at 2,500
 *
 * Quantities are in the listing's own unit (its `priceUnit`: items, kg or
 * tonnes). Everything here is pure so the cart, order and listing routes
 * (and the tests) share one definition of the rules.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PRICE_TIERS = void 0;
exports.parsePriceTiers = parsePriceTiers;
exports.unitPriceForQuantity = unitPriceForQuantity;
exports.sanitizeQuantityRules = sanitizeQuantityRules;
exports.quantityProblem = quantityProblem;
exports.MAX_PRICE_TIERS = 5;
const isWhole = (n) => typeof n === 'number' && Number.isInteger(n);
/** Read tiers back from the JSON column defensively (never throws, always sorted). */
function parsePriceTiers(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((t) => t !== null && typeof t === 'object')
        .map((t) => t)
        .filter((t) => isWhole(t.minQty) && t.minQty >= 2 && typeof t.price === 'number' && Number.isFinite(t.price) && t.price >= 0)
        .map((t) => ({ minQty: t.minQty, price: t.price }))
        .sort((a, b) => a.minQty - b.minQty);
}
/** The per-unit price that applies to an order of `qty` units. */
function unitPriceForQuantity(basePrice, tiers, qty) {
    let price = basePrice;
    for (const tier of tiers) {
        if (qty >= tier.minQty)
            price = tier.price;
    }
    return price;
}
/** Validate seller-supplied MOQ / tiers. Empty input means "no rule". */
function sanitizeQuantityRules(input, ctx) {
    let minOrderQuantity = null;
    const rawMoq = input.minOrderQuantity;
    if (rawMoq !== undefined && rawMoq !== null && rawMoq !== '') {
        const moq = typeof rawMoq === 'string' ? Number(rawMoq.trim()) : rawMoq;
        if (!isWhole(moq) || moq < 1) {
            return { ok: false, message: 'Minimum order quantity must be a whole number of 1 or more' };
        }
        if (ctx.stock > 0 && moq > ctx.stock) {
            return { ok: false, message: 'Minimum order quantity cannot be more than the quantity available' };
        }
        minOrderQuantity = moq > 1 ? moq : null;
    }
    const rawTiers = input.priceTiers;
    if (rawTiers === undefined || rawTiers === null || (Array.isArray(rawTiers) && rawTiers.length === 0)) {
        return { ok: true, minOrderQuantity, priceTiers: null };
    }
    if (!Array.isArray(rawTiers))
        return { ok: false, message: 'priceTiers must be a list' };
    if (rawTiers.length > exports.MAX_PRICE_TIERS) {
        return { ok: false, message: `You can add at most ${exports.MAX_PRICE_TIERS} volume price tiers` };
    }
    const tiers = [];
    for (const t of rawTiers) {
        const minQty = typeof t?.minQty === 'string' ? Number(t.minQty.trim()) : t?.minQty;
        const price = typeof t?.price === 'string' ? Number(t.price.trim()) : t?.price;
        if (!isWhole(minQty) || minQty < 2) {
            return { ok: false, message: 'Each price tier needs a whole-number quantity of 2 or more' };
        }
        if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
            return { ok: false, message: 'Each price tier needs a valid price' };
        }
        tiers.push({ minQty, price });
    }
    tiers.sort((a, b) => a.minQty - b.minQty);
    const floorQty = minOrderQuantity ?? 1;
    let previousPrice = ctx.basePrice;
    for (let i = 0; i < tiers.length; i += 1) {
        const tier = tiers[i];
        if (i > 0 && tier.minQty === tiers[i - 1].minQty) {
            return { ok: false, message: 'Two price tiers cannot start at the same quantity' };
        }
        if (tier.minQty <= floorQty) {
            return { ok: false, message: 'Each price tier must start above the minimum order quantity' };
        }
        if (ctx.stock > 0 && tier.minQty > ctx.stock) {
            return { ok: false, message: 'A price tier cannot start above the quantity available' };
        }
        if (tier.price >= previousPrice) {
            return { ok: false, message: 'Bigger orders must be cheaper: each tier price must be lower than the one before it' };
        }
        previousPrice = tier.price;
    }
    return { ok: true, minOrderQuantity, priceTiers: tiers };
}
/** A human-readable problem with ordering `qty` of a listing, or null if fine. */
function quantityProblem(listing, qty) {
    if (!Number.isFinite(qty) || qty < 1)
        return 'Quantity must be at least 1';
    const moq = listing.minOrderQuantity ?? 0;
    if (moq > 1 && qty < moq) {
        return `The minimum order for "${listing.title}" is ${moq}`;
    }
    return null;
}
//# sourceMappingURL=orderQuantity.js.map