"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CURRENCY_RATES = exports.CURRENCY_RATES_PATH = void 0;
exports.convertBetweenCurrencies = convertBetweenCurrencies;
const express_1 = require("express");
const jsonStore_1 = require("../utils/jsonStore");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
exports.CURRENCY_RATES_PATH = 'data/currency-rates.json';
exports.DEFAULT_CURRENCY_RATES = {
    base: 'AED',
    rates: [
        { code: 'UGX', country: 'Uganda', label: 'Ugandan Shilling', rate: 1021.00 },
        { code: 'KES', country: 'Kenya', label: 'Kenyan Shilling', rate: 35.41 },
        { code: 'USD', country: 'USA', label: 'US Dollar', rate: 0.27 },
        { code: 'CNY', country: 'China', label: 'Chinese Yuan', rate: 1.97 },
        { code: 'GBP', country: 'UK', label: 'British Pound', rate: 0.21 },
        { code: 'NGN', country: 'Nigeria', label: 'Nigerian Naira', rate: 422.16 },
        { code: 'INR', country: 'India', label: 'Indian Rupee', rate: 22.73 },
        { code: 'GHS', country: 'Ghana', label: 'Ghanaian Cedi', rate: 3.59 },
        { code: 'EUR', country: 'Euro', label: 'Euro', rate: 0.25 },
        { code: 'ZAR', country: 'South Africa', label: 'South African Rand', rate: 5.07 },
        { code: 'SAR', country: 'Saudi Arabia', label: 'Saudi Riyal', rate: 1.02 },
        { code: 'TZS', country: 'Tanzania', label: 'Tanzanian Shilling', rate: 718.88 },
        { code: 'ETB', country: 'Ethiopia', label: 'Ethiopian Birr', rate: 15.65 },
        { code: 'RWF', country: 'Rwanda', label: 'Rwandan Franc', rate: 364.97 },
        { code: 'PKR', country: 'Pakistan', label: 'Pakistani Rupee', rate: 75.69 },
        { code: 'BDT', country: 'Bangladesh', label: 'Bangladeshi Taka', rate: 29.87 },
        { code: 'NPR', country: 'Nepal', label: 'Nepalese Rupee', rate: 36.24 },
        { code: 'XOF', country: 'Burkina Faso', label: 'West African CFA Franc', rate: 166.00 },
        { code: 'XOF', country: 'Mali', label: 'West African CFA Franc', rate: 166.00 },
        { code: 'XAF', country: 'Gabon', label: 'Central African CFA Franc', rate: 166.00 },
        { code: 'XAF', country: 'Cameroon', label: 'Central African CFA Franc', rate: 166.00 },
    ],
    updatedAt: new Date().toISOString(),
};
function loadCurrencyRates() {
    return (0, jsonStore_1.readJsonFile)(exports.CURRENCY_RATES_PATH, exports.DEFAULT_CURRENCY_RATES);
}
function saveCurrencyRates(store) {
    (0, jsonStore_1.writeJsonFile)(exports.CURRENCY_RATES_PATH, store);
}
// Currency rates must never carry more than 2 decimal places.
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
router.get('/', async (_req, res, next) => {
    try {
        // Currency rates change only when admin updates them — cache for 5 min
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
        res.json(loadCurrencyRates());
    }
    catch (err) {
        next(err);
    }
});
router.put('/', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const rates = Array.isArray(req.body.rates) ? req.body.rates : [];
        const normalized = rates
            .filter((item) => {
            return item &&
                typeof item.code === 'string' &&
                item.code.trim() !== '' &&
                !Number.isNaN(Number(item.rate));
        })
            .map((item) => ({
            code: item.code.trim().toUpperCase(),
            country: String(item.country || '').trim() || item.code.trim().toUpperCase(),
            label: item.label ? String(item.label).trim() : undefined,
            rate: round2(Number(item.rate)),
        }));
        if (normalized.length === 0) {
            return res.status(400).json({ error: 'At least one currency rate must be provided.' });
        }
        const payload = {
            base: String(req.body.base || 'USD'),
            rates: normalized,
            updatedAt: new Date().toISOString(),
        };
        saveCurrencyRates(payload);
        res.json(payload);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const existing = loadCurrencyRates();
        const entry = req.body;
        if (!entry || typeof entry.code !== 'string' || !entry.code.trim() || Number.isNaN(Number(entry.rate))) {
            return res.status(400).json({ error: 'code and numeric rate are required.' });
        }
        const updatedRates = [...existing.rates];
        const newEntry = {
            code: entry.code.trim().toUpperCase(),
            country: String(entry.country || entry.code).trim(),
            label: entry.label ? String(entry.label).trim() : undefined,
            rate: round2(Number(entry.rate)),
        };
        const idx = updatedRates.findIndex((rate) => rate.code === newEntry.code);
        if (idx >= 0) {
            updatedRates[idx] = newEntry;
        }
        else {
            updatedRates.push(newEntry);
        }
        const payload = {
            ...existing,
            rates: updatedRates,
            updatedAt: new Date().toISOString(),
        };
        saveCurrencyRates(payload);
        res.json(payload);
    }
    catch (err) {
        next(err);
    }
});
// ─── Sticky Header Banners ──────────────────────────────────────────────────────
/**
 * GET /api/currency-rates/sticky-header-banners
 * Public endpoint: returns active sticky header promotional banners (1168x56 px).
 * These display fixed at the top of the page above the main navigation.
 */
router.get('/sticky-header-banners', async (_req, res, next) => {
    try {
        const banners = await prisma_1.prisma.siteMedia.findMany({
            where: {
                isActive: true,
                section: 'sticky-header',
            },
            select: {
                id: true,
                cdnUrl: true,
                title: true,
                altText: true,
                linkUrl: true,
                sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
        });
        const formattedBanners = banners.map((banner) => ({
            id: banner.id,
            cdnUrl: banner.cdnUrl,
            title: banner.title || undefined,
            altText: banner.altText || undefined,
            linkUrl: banner.linkUrl || undefined,
            dimensions: '1168x56',
            sortOrder: banner.sortOrder,
        }));
        res.json({ banners: formattedBanners, total: formattedBanners.length });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/currency-rates/sticky-header-banners/:id
 * Public endpoint: returns a single sticky header banner by ID.
 */
router.get('/sticky-header-banners/:id', async (req, res, next) => {
    try {
        const banner = await prisma_1.prisma.siteMedia.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                cdnUrl: true,
                title: true,
                altText: true,
                linkUrl: true,
                sortOrder: true,
                isActive: true,
                section: true,
            },
        });
        if (!banner || banner.section !== 'sticky-header') {
            return res.status(404).json({ error: 'Banner not found' });
        }
        const formattedBanner = {
            id: banner.id,
            cdnUrl: banner.cdnUrl,
            title: banner.title || undefined,
            altText: banner.altText || undefined,
            linkUrl: banner.linkUrl || undefined,
            dimensions: '1168x56',
            sortOrder: banner.sortOrder,
        };
        res.json(formattedBanner);
    }
    catch (err) {
        next(err);
    }
});
/**
 * Converts an amount between any two currencies in the rates store, via the
 * store's base currency (AED) as the pivot — the same two-hop approach the
 * frontend's convertCurrency() (lib/utils.ts) uses, now available
 * server-side too. `rate` for a currency means "how many units of that
 * currency equal 1 unit of base" (see DEFAULT_CURRENCY_RATES above: 1 AED
 * \u2248 1021 UGX, so UGX's rate is 1021).
 *
 * Used by admin.ts's Revenue by Category chart to combine amounts posted
 * in different currencies (AED/UGX/KES/CNY/USD) into one real total,
 * instead of summing raw numbers across currencies as if they were the
 * same unit. Returns the input unchanged if either currency code isn't in
 * the store (defensive — should never happen for the 5 Currency enum
 * values, which are all seeded in DEFAULT_CURRENCY_RATES).
 */
function convertBetweenCurrencies(amount, from, to, store) {
    if (from === to)
        return amount;
    const rateOf = (code) => code === store.base ? 1 : store.rates.find((r) => r.code === code)?.rate;
    const fromRate = rateOf(from);
    const toRate = rateOf(to);
    if (!fromRate || !toRate)
        return amount;
    const inBase = amount / fromRate;
    return inBase * toRate;
}
exports.default = router;
//# sourceMappingURL=currencyRates.js.map