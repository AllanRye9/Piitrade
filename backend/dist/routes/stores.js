"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// ROUTE ORDER IS CRITICAL.
// All static paths (/partners, /me, etc.) MUST be registered before the
// wildcard /:slug route, otherwise Express matches them as slugs and
// the real handlers are never reached.
// ─────────────────────────────────────────────────────────────────────────────
// ── 1. Public: list all active stores ────────────────────────────────────────
router.get('/', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500')));
        const skip = (page - 1) * limit;
        const country = req.query.country;
        const countryFilter = country && ['UAE', 'UGANDA', 'KENYA', 'CHINA'].includes(country.toUpperCase())
            ? country.toUpperCase()
            : undefined;
        const whereClause = {
            isActive: true,
            ...(countryFilter ? {
                user: { country: countryFilter },
            } : {}),
        };
        const [stores, total] = await Promise.all([
            prisma_1.prisma.store.findMany({
                where: whereClause,
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    logo: true,
                    banner: true,
                    description: true,
                    rating: true,
                    ratingCount: true,
                    isActive: true,
                    createdAt: true,
                    // Partner fields — added in migration 20260720000001
                    partnerApproved: true,
                    partnerLogoUrl: true,
                    partnerName: true,
                    partnerWebsite: true,
                    partnerApprovedAt: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            avatar: true,
                            country: true,
                            role: true,
                            companyName: true,
                            businessDescription: true,
                            website: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma_1.prisma.store.count({ where: whereClause }),
        ]);
        res.json({ stores, total, page, limit, pages: Math.ceil(total / limit) });
    }
    catch (err) {
        logger_1.logger.error(`GET /api/stores failed: ${String(err)}`);
        next(err);
    }
});
// ── 2. Public: approved partners wall ────────────────────────────────────────
// MUST be before /:slug so GET /partners is not matched as a store slug.
router.get('/partners', async (_req, res, next) => {
    try {
        const partners = await prisma_1.prisma.store.findMany({
            where: { partnerApproved: true, isActive: true },
            select: {
                id: true,
                slug: true,
                name: true,
                partnerLogoUrl: true,
                partnerName: true,
                partnerWebsite: true,
                partnerApprovedAt: true,
                logo: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        companyName: true,
                        country: true,
                        website: true,
                        socialLinks: true,
                    },
                },
            },
            orderBy: { partnerApprovedAt: 'asc' },
        });
        res.json({ partners });
    }
    catch (err) {
        next(err);
    }
});
// ── 3. Authenticated routes (all /me/* paths) ─────────────────────────────────
// Apply auth middleware only to routes below this point.
// These must also come BEFORE /:slug.
router.use('/me', auth_1.authenticate);
// GET /api/stores/me
router.get('/me', auth_1.authenticate, async (req, res, next) => {
    try {
        const store = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        res.json({ store });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/stores/me
router.put('/me', auth_1.authenticate, async (req, res, next) => {
    try {
        const existing = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Store not found — your store has not been provisioned yet', 404));
        // All Store Dashboard actions (profile, branding, theme) require a
        // live store subscription. Once it lapses the store is frozen — the
        // owner is an ordinary user until they renew — and, critically, cannot
        // un-freeze it themselves by sending isActive: true; only an admin
        // approving a renewal (PATCH /store-rentals/admin/:id) reactivates it.
        const liveRental = await prisma_1.prisma.storeRental.findFirst({
            where: { userId: req.user.userId, status: 'ACTIVE', endDate: { gt: new Date() } },
            select: { id: true },
        });
        if (!liveRental) {
            return next((0, errorHandler_1.createError)('Your store subscription is not active. Renew it to edit your store — your existing listings are unaffected.', 403));
        }
        const { name, description, logo, banner, isActive, backgroundTheme } = req.body;
        if (name !== undefined && !String(name).trim()) {
            return next((0, errorHandler_1.createError)('Store name cannot be empty', 400));
        }
        // Background theme: { presetId?: string, primaryColor?: '#rrggbb',
        // backgroundImage?: string | null }, or null to reset to the site default.
        let themeUpdate = {};
        if (backgroundTheme !== undefined) {
            if (backgroundTheme === null) {
                // DbNull (not JsonNull): backgroundTheme is a nullable column
                // and this clears it to actual SQL NULL — "no theme set, use the
                // site default" — rather than storing the JSON literal `null` as
                // the column's value.
                themeUpdate = { backgroundTheme: client_1.Prisma.DbNull };
            }
            else {
                const t = backgroundTheme;
                if (typeof t !== 'object' || Array.isArray(t))
                    return next((0, errorHandler_1.createError)('backgroundTheme must be an object or null', 400));
                if (t.presetId !== undefined && typeof t.presetId !== 'string')
                    return next((0, errorHandler_1.createError)('backgroundTheme.presetId must be a string', 400));
                if (t.primaryColor !== undefined && !(typeof t.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.primaryColor))) {
                    return next((0, errorHandler_1.createError)('backgroundTheme.primaryColor must be a #rrggbb hex color', 400));
                }
                if (t.backgroundImage !== undefined && t.backgroundImage !== null && typeof t.backgroundImage !== 'string') {
                    return next((0, errorHandler_1.createError)('backgroundTheme.backgroundImage must be a string or null', 400));
                }
                themeUpdate = { backgroundTheme: { presetId: t.presetId, primaryColor: t.primaryColor, backgroundImage: t.backgroundImage ?? null } };
            }
        }
        const store = await prisma_1.prisma.store.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined && { name: String(name).trim() }),
                ...(description !== undefined && { description: description || null }),
                ...(logo !== undefined && { logo: logo || null }),
                ...(banner !== undefined && { banner: banner || null }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
                ...themeUpdate,
            },
        });
        res.json({ store });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/stores/me/partner-logo
// Only stores with partnerApproved=true may call this.
router.put('/me/partner-logo', auth_1.authenticate, async (req, res, next) => {
    try {
        const store = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        if (!store)
            return next((0, errorHandler_1.createError)('Store not found', 404));
        if (!store.partnerApproved) {
            return next((0, errorHandler_1.createError)('Your store has not been approved as a partner. Contact admin.', 403));
        }
        const { partnerLogoUrl, partnerName, partnerWebsite } = req.body;
        if (!partnerLogoUrl)
            return next((0, errorHandler_1.createError)('partnerLogoUrl is required', 400));
        const updated = await prisma_1.prisma.store.update({
            where: { id: store.id },
            data: {
                partnerLogoUrl: partnerLogoUrl.trim(),
                ...(partnerName !== undefined && { partnerName: partnerName?.trim() || null }),
                ...(partnerWebsite !== undefined && { partnerWebsite: partnerWebsite?.trim() || null }),
            },
        });
        res.json({ store: updated });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/stores/me/analytics — aggregate dashboard numbers for the Web
// Store "Analytics dashboard" advanced tool: listing views, active listing
// count, order/revenue totals, and a top-listings-by-views leaderboard.
router.get('/me/analytics', auth_1.authenticate, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const [listingAgg, listingCount, topListings, orders, deliveredOrders] = await Promise.all([
            prisma_1.prisma.listing.aggregate({ where: { userId }, _sum: { views: true } }),
            prisma_1.prisma.listing.count({ where: { userId, status: 'ACTIVE' } }),
            prisma_1.prisma.listing.findMany({
                where: { userId },
                select: { id: true, title: true, views: true, price: true, currency: true, stock: true, images: true },
                orderBy: { views: 'desc' },
                take: 5,
            }),
            prisma_1.prisma.order.findMany({
                where: { sellerId: userId },
                select: { id: true, status: true, total: true, currency: true, createdAt: true },
            }),
            prisma_1.prisma.order.aggregate({
                where: { sellerId: userId, status: 'DELIVERED' },
                _sum: { total: true },
            }),
        ]);
        const ordersByStatus = {};
        for (const o of orders)
            ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
        // Last-30-day daily order counts for a lightweight sparkline
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recentOrders = orders.filter((o) => o.createdAt >= since);
        const dailyOrders = {};
        for (const o of recentOrders) {
            const key = o.createdAt.toISOString().slice(0, 10);
            dailyOrders[key] = (dailyOrders[key] ?? 0) + 1;
        }
        res.json({
            totalViews: listingAgg._sum.views ?? 0,
            activeListings: listingCount,
            totalOrders: orders.length,
            ordersByStatus,
            revenue: deliveredOrders._sum.total ?? 0,
            currency: orders[0]?.currency ?? 'UGX',
            topListings,
            dailyOrders,
        });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/stores/me/partner-logo
router.delete('/me/partner-logo', auth_1.authenticate, async (req, res, next) => {
    try {
        const store = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        if (!store)
            return next((0, errorHandler_1.createError)('Store not found', 404));
        if (!store.partnerApproved)
            return next((0, errorHandler_1.createError)('Not an approved partner', 403));
        const updated = await prisma_1.prisma.store.update({
            where: { id: store.id },
            data: { partnerLogoUrl: null },
        });
        res.json({ store: updated });
    }
    catch (err) {
        next(err);
    }
});
// ── 4. Public: view a store by slug ──────────────────────────────────────────
// MUST be last — wildcard /:slug catches anything not matched above.
router.get('/:slug', async (req, res, next) => {
    try {
        const store = await prisma_1.prisma.store.findUnique({
            where: { slug: req.params.slug },
            include: {
                user: {
                    select: {
                        id: true, name: true, avatar: true, country: true,
                        createdAt: true, companyName: true, businessDescription: true, website: true,
                        socialLinks: true,
                        listings: {
                            where: { status: 'ACTIVE' },
                            select: {
                                id: true, title: true, price: true, currency: true,
                                images: true, country: true, location: true, createdAt: true, status: true,
                                category: { select: { id: true, name: true, slug: true } },
                                productImages: { select: { cdnUrl: true }, take: 1 },
                            },
                            orderBy: { createdAt: 'desc' },
                            take: 100,
                        },
                    },
                },
            },
        });
        if (!store || !store.isActive)
            return next((0, errorHandler_1.createError)('Store not found', 404));
        res.json({ store });
    }
    catch (err) {
        next(err);
    }
});
// ── 5. POST /api/stores — create a store (authenticated) ─────────────────────
router.use(auth_1.authenticate);
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const { name, description, slug } = req.body;
        if (!name || !slug)
            return next((0, errorHandler_1.createError)('name and slug are required', 400));
        const existing = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        if (existing)
            return next((0, errorHandler_1.createError)('You already have a store', 400));
        const slugExists = await prisma_1.prisma.store.findUnique({ where: { slug: slug.toLowerCase() } });
        if (slugExists)
            return next((0, errorHandler_1.createError)('Slug is already taken', 400));
        const store = await prisma_1.prisma.store.create({
            data: {
                userId: req.user.userId,
                name,
                description,
                slug: slug.toLowerCase(),
            },
        });
        if (req.user.role === 'BUYER') {
            await prisma_1.prisma.user.update({ where: { id: req.user.userId }, data: { role: 'SELLER' } });
        }
        res.status(201).json({ store });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=stores.js.map