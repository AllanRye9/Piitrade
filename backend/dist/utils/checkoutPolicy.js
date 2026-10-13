"use strict";
// ─── Who may sell through checkout? ─────────────────────────────────────────
//
// Product rule: only WEB STORES (a seller with an active store rental) and
// Piitrade itself (admin-owned listings) have checkout. Every other seller
// is contact / chat only — the buyer reaches them by call, WhatsApp or the
// in-app messages, and no order or payment is created.
//
// The site-wide marketplace mode (SiteConfig.marketplaceMode) still applies:
//   CLASSIFIEDS  nobody has checkout (everything is contact-only)
//   HYBRID       admin + active web stores            <- the intended mode
//   ECOMMERCE    every seller has checkout            (admin's explicit choice)
// Unknown / unset mode behaves as HYBRID (same default the app already used).
// Motors and Property stay contact-only in every mode.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMarketplaceMode = normalizeMarketplaceMode;
exports.isCheckoutEligible = isCheckoutEligible;
exports.findActiveStoreOwnerIds = findActiveStoreOwnerIds;
function normalizeMarketplaceMode(raw) {
    return raw === 'CLASSIFIEDS' || raw === 'ECOMMERCE' || raw === 'HYBRID' ? raw : 'HYBRID';
}
const CONTACT_ONLY_CATEGORIES = new Set(['motors', 'property']);
function isCheckoutEligible(i) {
    if (i.topCategorySlug && CONTACT_ONLY_CATEGORIES.has(i.topCategorySlug))
        return false;
    switch (normalizeMarketplaceMode(i.mode)) {
        case 'CLASSIFIEDS':
            return false;
        case 'ECOMMERCE':
            return true;
        case 'HYBRID':
        default:
            return i.sellerIsAdmin || i.sellerHasActiveStore;
    }
}
/**
 * Of the given seller ids, which currently have an ACTIVE, unexpired store
 * rental — the same definition the listing code uses for "registered store".
 */
async function findActiveStoreOwnerIds(db, userIds, now = new Date()) {
    if (userIds.length === 0)
        return new Set();
    const rows = await db.storeRental.findMany({
        where: { userId: { in: [...new Set(userIds)] }, status: 'ACTIVE', endDate: { gt: now } },
        select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
}
//# sourceMappingURL=checkoutPolicy.js.map