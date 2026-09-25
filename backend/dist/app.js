"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const express_rate_limit_1 = require("express-rate-limit");
const errorHandler_1 = require("./middleware/errorHandler");
const logger_1 = require("./utils/logger");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const listings_1 = __importDefault(require("./routes/listings"));
const categories_1 = __importDefault(require("./routes/categories"));
const reports_1 = __importDefault(require("./routes/reports"));
const reviews_1 = __importDefault(require("./routes/reviews"));
const admin_1 = __importDefault(require("./routes/admin"));
const upload_1 = __importDefault(require("./routes/upload"));
const stats_1 = __importDefault(require("./routes/stats"));
const doc_1 = __importDefault(require("./routes/doc"));
const cart_1 = __importDefault(require("./routes/cart"));
const addresses_1 = __importDefault(require("./routes/addresses"));
const orders_1 = __importDefault(require("./routes/orders"));
const coupons_1 = __importDefault(require("./routes/coupons"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const stores_1 = __importDefault(require("./routes/stores"));
const withdrawals_1 = __importDefault(require("./routes/withdrawals"));
const packages_1 = __importDefault(require("./routes/packages"));
const images_1 = __importDefault(require("./routes/images"));
const siteMedia_1 = __importDefault(require("./routes/siteMedia"));
const blog_1 = __importDefault(require("./routes/blog"));
const storeRentals_1 = __importDefault(require("./routes/storeRentals"));
const cvServiceRequests_1 = __importDefault(require("./routes/cvServiceRequests"));
const cvPayment_1 = __importDefault(require("./routes/cvPayment"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const currencyRates_1 = __importDefault(require("./routes/currencyRates"));
const commodityPrices_1 = __importDefault(require("./routes/commodityPrices"));
const farmerMarketplace_1 = __importDefault(require("./routes/farmerMarketplace"));
const kyc_1 = __importDefault(require("./routes/kyc"));
const messages_1 = __importDefault(require("./routes/messages"));
const serviceConfig_1 = require("./utils/serviceConfig");
const app = (0, express_1.default)();
// Trust the first reverse-proxy hop (Railway, Render, nginx, etc.) so that
// express-rate-limit (and req.ip) use the real client IP from X-Forwarded-For
// instead of the proxy's IP.  Without this, express-rate-limit v7+ throws a
// ValidationError when X-Forwarded-For is present but trust proxy is false.
app.set('trust proxy', 1);
// Support a comma-separated list of allowed origins in CORS_ORIGIN so that
// multiple deployment URLs (e.g. Railway + Render) can be whitelisted without
// requiring code changes.
const rawCorsOrigins = process.env.CORS_ORIGIN || 'http://localhost:3000';
const allowedOrigins = Array.from(new Set([
    ...rawCorsOrigins.split(',').map((o) => o.trim()).filter(Boolean),
    'https://piitrade.com',
    'https://www.piitrade.com',
]));
// CORS must be registered before helmet so that CORS response headers
// (Access-Control-Allow-Origin, etc.) are present on every response –
// including preflight OPTIONS replies – before helmet adds its own
// restrictive Cross-Origin-* headers.
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. server-to-server, curl, Postman)
        if (!origin)
            return callback(null, true);
        // When the wildcard '*' is in the allowed list, reflect the requesting
        // origin back.  A literal '*' cannot be used with credentials:true, so
        // we must echo the origin instead.
        if (allowedOrigins.includes('*'))
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        // Return false instead of an error so the response still gets CORS
        // headers (the browser can read the rejection) rather than blowing up
        // the request entirely.
        callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
};
app.use((0, cors_1.default)(corsOptions));
// Explicitly handle all OPTIONS preflight requests so that CORS headers
// are always present — even on routes that don't otherwise accept OPTIONS.
app.options('*', (0, cors_1.default)(corsOptions));
// Security middleware – configured so its Cross-Origin-* defaults do not
// strip or conflict with the CORS headers set above.
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false,
}));
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
app.get('/health/services', (_req, res) => {
    const readiness = (0, serviceConfig_1.getServiceReadiness)();
    const status = readiness.jwt.ready ? 200 : 503;
    res.status(status).json({
        status: readiness.jwt.ready ? 'ok' : 'error',
        services: readiness,
    });
});
app.get('/ready', (_req, res) => {
    res.sendStatus(200);
});
// General API rate limit — generous enough for normal multi-tab browsing.
const limiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 500,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);
// Strict limiter for auth mutation endpoints (login / register) to prevent
// brute-force and credential-stuffing attacks while keeping normal use smooth.
const authLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many attempts. Please wait a few minutes before trying again.' },
});
// Light limiter for /api/users/me — called on every page load and tab focus.
// 300 per 15 minutes allows up to ~20 reloads/minute for a single browser.
const meLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
});
// Body parsing
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, compression_1.default)());
// Logging
app.use((0, morgan_1.default)('combined', {
    stream: { write: (message) => logger_1.logger.info(message.trim()) },
}));
// User documents (CVs, certificates, ID uploads — some marked private) are
// stored under uploads/documents/ when running on the local-filesystem
// fallback. Block that prefix from the plain static mount below — it has no
// concept of auth/ownership at all — so those files are only reachable
// through the authenticated GET /api/upload/documents/:id/file route, which
// checks ownership/visibility before streaming anything. This must be
// registered before the general static mount so it takes precedence.
app.use('/uploads/documents', (_req, res) => {
    res.status(403).json({ message: 'Not accessible directly' });
});
// Serve uploaded images as static files
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
// Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/admin-register', authLimiter);
app.use('/api/users/me', meLimiter);
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/listings', listings_1.default);
app.use('/api/categories', categories_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/reviews', reviews_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/upload', upload_1.default);
app.use('/api/stats', stats_1.default);
app.use('/api/doc', doc_1.default);
app.use('/api/cart', cart_1.default);
app.use('/api/addresses', addresses_1.default);
app.use('/api/orders', orders_1.default);
app.use('/api/coupons', coupons_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/stores', stores_1.default);
app.use('/api/withdrawals', withdrawals_1.default);
app.use('/api/packages', packages_1.default);
app.use('/api/images', images_1.default);
app.use('/api/site-media', siteMedia_1.default);
app.use('/api/blog', blog_1.default);
app.use('/api/store-rentals', storeRentals_1.default);
app.use('/api/cv-service-requests', cvServiceRequests_1.default);
app.use('/api/cv-payment', cvPayment_1.default);
app.use('/api/jobs', jobs_1.default);
app.use('/api/currency-rates', currencyRates_1.default);
app.use('/api/commodity-prices', commodityPrices_1.default);
app.use('/api/farmer-marketplace', farmerMarketplace_1.default);
app.use('/api/kyc', kyc_1.default);
app.use('/api/messages', messages_1.default);
// ─── Public site config (whatsapp number, today's deals, header theme) ────────
// Publicly readable – no auth required so the frontend can load it on every page.
app.get('/api/public/site-config', async (_req, res) => {
    try {
        const { prisma: db } = await Promise.resolve().then(() => __importStar(require('./utils/prisma')));
        const config = await db.siteConfig.upsert({
            where: { id: 'global' },
            create: { id: 'global' },
            update: {},
        });
        // specialFindsEnabled lives in generalSettings (same admin-configurable
        // JSON blob as maintenanceMode/allowRegistration — see PUT /admin/settings)
        // rather than its own SiteConfig column, so no migration was needed.
        const generalSettings = config.generalSettings || {};
        const specialFindsEnabled = generalSettings.specialFindsEnabled !== false;
        const now = new Date();
        const allDeals = config.todaysDeals || [];
        // Filter: keep deals with no expiry (unlimited) or whose expiry is in the future
        const activeDeals = allDeals.filter((d) => !d.expiresAt || new Date(d.expiresAt) > now);
        // Allow browsers/CDNs to cache for 60 s; stale-while-revalidate lets the
        // next request be served from cache while the backend refreshes in the background.
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        res.json({
            whatsappNumber: config.whatsappNumber || null,
            todaysDeals: activeDeals,
            headerTheme: config.headerTheme || null,
            logoUrl: config.logoUrl || null,
            logoPages: config.logoPages || [],
            logoAltText: config.logoAltText || null,
            logoSize: config.logoSize || 28,
            logoLinkUrl: config.logoLinkUrl || null,
            logoDisplayMode: config.logoDisplayMode || 'inline',
            interviewDemoVideoUrl: config.interviewDemoVideoUrl || null,
            interviewDemoVideoTitle: config.interviewDemoVideoTitle || null,
            promoVideoUrl: config.promoVideoUrl || null,
            promoVideoTitle: config.promoVideoTitle || null,
            // Countries the storefront should show in the country switcher, welcome
            // modal, and /country/* pages. Admin-configurable from /admin/settings;
            // defaults to Uganda-only. Never empty — falls back to ['UGANDA'] so
            // the storefront always has at least one selectable country.
            enabledCountries: config.enabledCountries?.length ? config.enabledCountries : ['UGANDA'],
            specialFindsEnabled,
            // "Special Offers" (formerly "Special Finds") — replaces the old bare
            // specialFindsEnabled boolean above (kept for backward compatibility)
            // with the full admin-controlled shape: discount threshold + optional
            // scheduled window. Falls back to specialFindsEnabled for `enabled`
            // when the admin hasn't saved this newer form yet — see PUT
            // /admin/site-config/special-offers for the write side of this same
            // fallback.
            specialOffers: (() => {
                const stored = config.specialOffers || {};
                const enabled = stored.enabled !== undefined ? stored.enabled : specialFindsEnabled;
                const minDiscountPercent = typeof stored.minDiscountPercent === 'number' ? stored.minDiscountPercent : 30;
                const withinWindow = (!stored.startAt || new Date(stored.startAt).getTime() <= now.getTime()) &&
                    (!stored.endAt || new Date(stored.endAt).getTime() >= now.getTime());
                return {
                    enabled: enabled && withinWindow,
                    minDiscountPercent,
                    startAt: stored.startAt || null,
                    endAt: stored.endAt || null,
                };
            })(),
            // Buyer-facing payment gateway info for the checkout page — safe to
            // expose publicly, since it's shown to buyers at checkout anyway.
            // Configured at /admin/payment-settings; see PUT /admin/payment-settings.
            paymentSettings: {
                mobileMoneyEnabled: config.paymentSettings?.mobileMoneyEnabled !== false,
                mobileMoneyNumber: config.paymentSettings?.mobileMoneyNumber || '',
                mobileMoneyInstructions: config.paymentSettings?.mobileMoneyInstructions || '',
                codEnabled: config.paymentSettings?.codEnabled !== false,
            },
        });
    }
    catch {
        res.json({ whatsappNumber: null, todaysDeals: [], headerTheme: null, logoUrl: null, logoPages: [], logoAltText: null, logoSize: 28, logoLinkUrl: null, logoDisplayMode: 'inline', interviewDemoVideoUrl: null, interviewDemoVideoTitle: null, promoVideoUrl: null, promoVideoTitle: null, enabledCountries: ['UGANDA'], specialFindsEnabled: true, specialOffers: { enabled: true, minDiscountPercent: 30, startAt: null, endAt: null }, paymentSettings: { mobileMoneyEnabled: true, mobileMoneyNumber: '', mobileMoneyInstructions: '', codEnabled: true } });
    }
});
// 404 handler for unmatched API routes – must come after all route registrations.
app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'Not found' });
});
// Error handler
app.use(errorHandler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map