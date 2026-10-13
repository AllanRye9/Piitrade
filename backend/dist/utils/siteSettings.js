"use strict";
// Admin-managed general settings (SiteConfig.generalSettings, edited at
// /admin/settings). One cached reader so every enforcement point (maintenance
// mode, registration switch, page size, image cap, trial length) reads the
// same values without a DB hit per request.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERAL_DEFAULTS = void 0;
exports.normalizeGeneralSettings = normalizeGeneralSettings;
exports.getGeneralSettings = getGeneralSettings;
exports.invalidateGeneralSettings = invalidateGeneralSettings;
const prisma_1 = require("./prisma");
exports.GENERAL_DEFAULTS = {
    siteName: 'Piitrade',
    maintenanceMode: false,
    allowRegistration: true,
    itemsPerPage: 20,
    maxImagesPerListing: 10,
    trialDays: 7,
    // Master switch for the mobile Special Offers popup (legacy name kept).
    specialFindsEnabled: true,
};
const TTL_MS = 15000;
let cache = null;
function clampInt(v, min, max, fallback) {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function normalizeGeneralSettings(stored) {
    const s = stored || {};
    return {
        siteName: typeof s.siteName === 'string' && s.siteName.trim() ? s.siteName.trim().slice(0, 60) : exports.GENERAL_DEFAULTS.siteName,
        maintenanceMode: s.maintenanceMode === true,
        allowRegistration: s.allowRegistration !== false,
        itemsPerPage: clampInt(s.itemsPerPage, 4, 100, exports.GENERAL_DEFAULTS.itemsPerPage),
        maxImagesPerListing: clampInt(s.maxImagesPerListing, 1, 30, exports.GENERAL_DEFAULTS.maxImagesPerListing),
        trialDays: clampInt(s.trialDays, 0, 365, exports.GENERAL_DEFAULTS.trialDays),
        specialFindsEnabled: s.specialFindsEnabled !== false,
    };
}
async function getGeneralSettings() {
    if (cache && Date.now() < cache.expires)
        return cache.value;
    try {
        const config = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { generalSettings: true } });
        const value = normalizeGeneralSettings(config?.generalSettings);
        cache = { value, expires: Date.now() + TTL_MS };
        return value;
    }
    catch {
        // Never take the site down because settings couldn't be read.
        return cache?.value ?? exports.GENERAL_DEFAULTS;
    }
}
function invalidateGeneralSettings() {
    cache = null;
}
//# sourceMappingURL=siteSettings.js.map