"use strict";
// Shared resolution of the admin-controlled "Special Offers" and "Back to
// School" section configs (SiteConfig.specialOffers / SiteConfig.backToSchool).
// Used by the public listing endpoints so the section-level switch, the
// discount threshold and the scheduled window are applied identically
// everywhere (home sections, dedicated pages, mobile popup).
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSpecialOffers = resolveSpecialOffers;
exports.resolveBackToSchool = resolveBackToSchool;
exports.parseOriginalPrice = parseOriginalPrice;
exports.discountPercent = discountPercent;
function inWindow(startAt, endAt, now) {
    return (!startAt || new Date(startAt).getTime() <= now.getTime())
        && (!endAt || new Date(endAt).getTime() >= now.getTime());
}
function resolveSpecialOffers(config, now = new Date()) {
    const stored = config?.specialOffers || {};
    const general = config?.generalSettings || {};
    const enabled = stored.enabled !== undefined ? !!stored.enabled : general.specialFindsEnabled !== false;
    const minDiscountPercent = typeof stored.minDiscountPercent === 'number'
        ? Math.min(99, Math.max(1, stored.minDiscountPercent))
        : 30;
    return {
        enabled,
        active: enabled && inWindow(stored.startAt, stored.endAt, now),
        minDiscountPercent,
        startAt: stored.startAt || null,
        endAt: stored.endAt || null,
    };
}
function resolveBackToSchool(config, now = new Date()) {
    const stored = config?.backToSchool || {};
    const enabled = !!stored.enabled;
    return {
        enabled,
        active: enabled && inWindow(stored.startAt, stored.endAt, now),
        startAt: stored.startAt || null,
        endAt: stored.endAt || null,
    };
}
/**
 * Validates a seller-supplied "was" price against the selling price.
 * Returns the number to store, null to clear, or an error string.
 */
function parseOriginalPrice(raw, price) {
    if (raw === undefined || raw === null || raw === '')
        return { value: null };
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n) || n < 0)
        return { error: 'originalPrice must be a valid non-negative number' };
    if (n <= price)
        return { error: 'originalPrice must be greater than the selling price' };
    return { value: n };
}
function discountPercent(price, originalPrice) {
    if (!originalPrice || originalPrice <= price || originalPrice <= 0)
        return 0;
    return Math.round(((originalPrice - price) / originalPrice) * 100);
}
//# sourceMappingURL=offers.js.map