"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const jsonStore_1 = require("../utils/jsonStore");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const prisma_1 = require("../utils/prisma");
const router = (0, express_1.Router)();
const FARMER_MARKETPLACE_PATH = 'data/farmer-marketplace.json';
const DEFAULT_PLATFORM_FEE_PERCENT = 2;
const now = () => new Date().toISOString();
function seedStore() {
    const postId = (0, crypto_1.randomUUID)();
    const createdAt = now();
    return {
        posts: [
            {
                id: postId,
                farmerId: null,
                farmerName: 'Nakato Farmers Group',
                farmerPhone: null,
                verifiedSeller: true,
                commodity: 'Maize',
                quantity: 5000,
                unit: 'kg',
                location: 'Iganga',
                qualityGrade: 'A',
                availability: 'IMMEDIATE',
                availableFrom: null,
                minPricePerUnit: 1200,
                currency: 'UGX',
                status: 'OPEN',
                warehouseAvailable: true,
                storageLocation: 'Iganga Central Store',
                verifiedWeightKg: 5000,
                notes: 'Dried, sorted, ready for immediate pickup.',
                priceHistory: [{ price: 1200, at: createdAt }],
                createdAt,
                updatedAt: createdAt,
            },
        ],
        offers: [
            { id: (0, crypto_1.randomUUID)(), postId, buyerId: null, buyerName: 'Kampala Grain Traders Ltd', buyerLocation: 'Kampala', verifiedBuyer: true, commodityPricePerUnit: 1250, transportPerUnit: 120, storagePerUnit: 30, platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT, transportPartner: null, escrowStatus: 'NONE', notes: null, createdAt },
            { id: (0, crypto_1.randomUUID)(), postId, buyerId: null, buyerName: 'Jinja Millers Co-op', buyerLocation: 'Jinja', verifiedBuyer: true, commodityPricePerUnit: 1230, transportPerUnit: 60, storagePerUnit: 25, platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT, transportPartner: null, escrowStatus: 'NONE', notes: null, createdAt },
            { id: (0, crypto_1.randomUUID)(), postId, buyerId: null, buyerName: 'Mbale Agro Buyers', buyerLocation: 'Mbale', verifiedBuyer: false, commodityPricePerUnit: 1210, transportPerUnit: 90, storagePerUnit: 25, platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT, transportPartner: null, escrowStatus: 'NONE', notes: null, createdAt },
            { id: (0, crypto_1.randomUUID)(), postId, buyerId: null, buyerName: 'Export Buyer (Regional)', buyerLocation: 'Export', verifiedBuyer: true, commodityPricePerUnit: 1320, transportPerUnit: 180, storagePerUnit: 40, platformFeePercent: 3, transportPartner: null, escrowStatus: 'NONE', notes: 'Requires phytosanitary certificate.', createdAt },
        ],
        updatedAt: createdAt,
    };
}
function loadStore() {
    return (0, jsonStore_1.readJsonFile)(FARMER_MARKETPLACE_PATH, seedStore());
}
function saveStore(store) {
    (0, jsonStore_1.writeJsonFile)(FARMER_MARKETPLACE_PATH, store);
}
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function normalizeGrade(value) {
    const v = String(value || '').trim().toUpperCase();
    return v === 'A' || v === 'B' || v === 'C' ? v : 'UNGRADED';
}
function normalizeAvailability(value) {
    return String(value || '').trim().toUpperCase() === 'DATE' ? 'DATE' : 'IMMEDIATE';
}
// Delivered price = (commodity price + transport + storage) marked up by the
// platform fee percentage. This is the single calculation the whole feature
// hinges on — every offer surfaced to a farmer is shown with this breakdown
// rather than a bare number, so the farmer can see exactly what each buyer's
// quote is actually worth once it reaches them.
function deliveredPrice(offer) {
    const subtotal = round2(offer.commodityPricePerUnit + offer.transportPerUnit + offer.storagePerUnit);
    const feeAmount = round2(subtotal * (offer.platformFeePercent / 100));
    return { subtotal, feeAmount, deliveredPricePerUnit: round2(subtotal + feeAmount) };
}
function offerWithDelivered(offer) {
    return { ...offer, ...deliveredPrice(offer) };
}
function postSummary(post, offers) {
    const postOffers = offers.filter((o) => o.postId === post.id).map(offerWithDelivered);
    const bestOffer = postOffers.length
        ? postOffers.reduce((best, o) => (o.deliveredPricePerUnit > best.deliveredPricePerUnit ? o : best))
        : null;
    return { ...post, offerCount: postOffers.length, bestDeliveredPricePerUnit: bestOffer?.deliveredPricePerUnit ?? null };
}
// ─── KYC-linked verification ─────────────────────────────────────────────────
// Looks up isKycVerified for a batch of user ids in one query, so list
// endpoints don't do it once per row. Returns a map only for ids that were
// actually found (a deleted account simply falls back to the stored manual
// flag rather than erroring).
async function kycVerifiedMap(userIds) {
    const ids = [...new Set(userIds.filter((id) => Boolean(id)))];
    if (ids.length === 0)
        return new Map();
    const users = await prisma_1.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, isKycVerified: true } });
    return new Map(users.map((u) => [u.id, u.isKycVerified]));
}
// A post's displayed verifiedSeller reflects the linked account's live KYC
// status when there is one; otherwise it falls back to the stored manual
// flag (guest-created posts have no account to check KYC against).
function withEffectiveSellerVerification(post, kycMap) {
    if (post.farmerId && kycMap.has(post.farmerId)) {
        return { ...post, verifiedSeller: kycMap.get(post.farmerId) };
    }
    return post;
}
function withEffectiveBuyerVerification(offer, kycMap) {
    if (offer.buyerId && kycMap.has(offer.buyerId)) {
        return { ...offer, verifiedBuyer: kycMap.get(offer.buyerId) };
    }
    return offer;
}
function computeTrend(points) {
    if (points.length < 2)
        return { trend: 'UNKNOWN', changePercent: null };
    const splitAt = Math.max(1, Math.floor(points.length / 2));
    const earlier = points.slice(0, splitAt);
    const recent = points.slice(splitAt);
    const avg = (arr) => arr.reduce((sum, p) => sum + p.price, 0) / arr.length;
    const earlierAvg = avg(earlier);
    const recentAvg = avg(recent.length ? recent : earlier);
    if (earlierAvg <= 0)
        return { trend: 'UNKNOWN', changePercent: null };
    const changePercent = round2(((recentAvg - earlierAvg) / earlierAvg) * 100);
    const trend = Math.abs(changePercent) < 1 ? 'STABLE' : changePercent > 0 ? 'RISING' : 'FALLING';
    return { trend, changePercent };
}
// ─── Public read: list posts ────────────────────────────────────────────────
// GET /api/farmer-marketplace/posts?commodity=&location=&status=OPEN
router.get('/posts', async (req, res, next) => {
    try {
        const store = loadStore();
        const { commodity, location, status } = req.query;
        let posts = store.posts;
        if (commodity) {
            const c = commodity.toLowerCase();
            posts = posts.filter((p) => p.commodity.toLowerCase().includes(c));
        }
        if (location) {
            const l = location.toLowerCase();
            posts = posts.filter((p) => p.location.toLowerCase() === l);
        }
        if (status && status.toUpperCase() !== 'ALL') {
            posts = posts.filter((p) => p.status === status.toUpperCase());
        }
        else if (!status) {
            posts = posts.filter((p) => p.status !== 'CLOSED');
        }
        // status=ALL: no status filtering — used by the admin dashboard so
        // closed posts remain visible there even though the public list and
        // homepage hide them.
        const kycMap = await kycVerifiedMap(posts.map((p) => p.farmerId));
        const summaries = posts.map((p) => withEffectiveSellerVerification(postSummary(p, store.offers), kycMap));
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
        res.json({ posts: summaries, updatedAt: store.updatedAt });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/farmer-marketplace/posts/:id — full detail incl. every buyer offer
router.get('/posts/:id', async (req, res, next) => {
    try {
        const store = loadStore();
        const post = store.posts.find((p) => p.id === req.params.id);
        if (!post)
            return next((0, errorHandler_1.createError)('Farmer post not found', 404));
        const offers = store.offers
            .filter((o) => o.postId === post.id)
            .map(offerWithDelivered)
            .sort((a, b) => b.deliveredPricePerUnit - a.deliveredPricePerUnit);
        const kycMap = await kycVerifiedMap([post.farmerId, ...offers.map((o) => o.buyerId)]);
        const effectivePost = withEffectiveSellerVerification(post, kycMap);
        const effectiveOffers = offers.map((o) => withEffectiveBuyerVerification(o, kycMap));
        res.json({ post: effectivePost, offers: effectiveOffers });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/farmer-marketplace/locations — distinct farmer post locations
router.get('/locations', async (_req, res, next) => {
    try {
        const store = loadStore();
        const locations = [...new Set(store.posts.map((p) => p.location).filter(Boolean))].sort();
        res.json({ locations });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/farmer-marketplace/regional-prices?commodity=Maize
// Averages delivered price per buyer region across all open posts for a
// commodity — the "regional price comparison" piece: a farmer (or anyone)
// can see at a glance that, say, Export buyers are currently paying more
// than Mbale buyers for maize, before a single offer is placed on their own
// post.
router.get('/regional-prices', async (req, res, next) => {
    try {
        const store = loadStore();
        const { commodity } = req.query;
        if (!commodity)
            return next((0, errorHandler_1.createError)('Query param "commodity" is required', 400));
        const c = commodity.toLowerCase();
        const relevantPostIds = new Set(store.posts.filter((p) => p.commodity.toLowerCase() === c).map((p) => p.id));
        const relevantOffers = store.offers.filter((o) => relevantPostIds.has(o.postId)).map(offerWithDelivered);
        const byRegion = new Map();
        for (const o of relevantOffers) {
            const entry = byRegion.get(o.buyerLocation) || { total: 0, count: 0 };
            entry.total += o.deliveredPricePerUnit;
            entry.count += 1;
            byRegion.set(o.buyerLocation, entry);
        }
        const regions = [...byRegion.entries()]
            .map(([region, { total, count }]) => ({ region, averageDeliveredPricePerUnit: round2(total / count), offerCount: count }))
            .sort((a, b) => b.averageDeliveredPricePerUnit - a.averageDeliveredPricePerUnit);
        res.json({ commodity, regions });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/farmer-marketplace/price-history?commodity=Maize&location=Iganga
// Flattens every post's minPricePerUnit history for a commodity (optionally
// scoped to a location) into one time-ordered series.
router.get('/price-history', async (req, res, next) => {
    try {
        const store = loadStore();
        const { commodity, location } = req.query;
        if (!commodity)
            return next((0, errorHandler_1.createError)('Query param "commodity" is required', 400));
        const c = commodity.toLowerCase();
        const l = location?.toLowerCase();
        const posts = store.posts.filter((p) => p.commodity.toLowerCase() === c && (!l || p.location.toLowerCase() === l));
        const points = posts
            .flatMap((p) => p.priceHistory.map((h) => ({ ...h, location: p.location, postId: p.id })))
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        const { trend, changePercent } = computeTrend(points);
        res.json({ commodity, location: location || null, points, trend, changePercent });
    }
    catch (err) {
        next(err);
    }
});
// ─── Create a farmer post ───────────────────────────────────────────────────
// POST /api/farmer-marketplace/posts
// optionalAuthenticate: a logged-in user's id/name are attached automatically;
// a guest can still post by supplying farmerName + farmerPhone directly (the
// same "low-friction posting" pattern used elsewhere on the site for
// classifieds). If the poster is logged in, verifiedSeller is seeded from
// their current KYC status (still recomputed live on every read afterwards,
// per the VERIFICATION note above); guest posts start unverified since
// there's no account for KYC to attach to.
router.post('/posts', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const commodity = String(body.commodity || '').trim();
        const quantity = Number(body.quantity);
        const location = String(body.location || '').trim();
        const minPricePerUnit = Number(body.minPricePerUnit);
        const farmerName = String(body.farmerName || '').trim();
        if (!commodity || !location || !farmerName) {
            return next((0, errorHandler_1.createError)('"commodity", "location", and "farmerName" are required.', 400));
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return next((0, errorHandler_1.createError)('"quantity" must be a positive number.', 400));
        }
        if (!Number.isFinite(minPricePerUnit) || minPricePerUnit < 0) {
            return next((0, errorHandler_1.createError)('"minPricePerUnit" must be a non-negative number.', 400));
        }
        const store = loadStore();
        const createdAt = now();
        const initialKyc = req.user?.userId ? (await kycVerifiedMap([req.user.userId])).get(req.user.userId) ?? false : false;
        const post = {
            id: (0, crypto_1.randomUUID)(),
            farmerId: req.user?.userId || null,
            farmerName,
            farmerPhone: body.farmerPhone ? String(body.farmerPhone).trim() : null,
            verifiedSeller: initialKyc,
            commodity,
            quantity,
            unit: String(body.unit || 'kg').trim() || 'kg',
            location,
            qualityGrade: normalizeGrade(body.qualityGrade),
            availability: normalizeAvailability(body.availability),
            availableFrom: body.availability === 'DATE' && body.availableFrom ? String(body.availableFrom) : null,
            minPricePerUnit: round2(minPricePerUnit),
            currency: String(body.currency || 'UGX').trim() || 'UGX',
            status: 'OPEN',
            warehouseAvailable: Boolean(body.warehouseAvailable),
            storageLocation: body.storageLocation ? String(body.storageLocation).trim() : null,
            verifiedWeightKg: body.verifiedWeightKg != null ? Number(body.verifiedWeightKg) : null,
            notes: body.notes ? String(body.notes).trim() : null,
            priceHistory: [{ price: round2(minPricePerUnit), at: createdAt }],
            createdAt,
            updatedAt: createdAt,
        };
        store.posts.push(post);
        store.updatedAt = createdAt;
        saveStore(store);
        res.status(201).json({ post });
    }
    catch (err) {
        next(err);
    }
});
// ─── Update a farmer post (owner or admin) ─────────────────────────────────
// PATCH /api/farmer-marketplace/posts/:id
// Supports updating status (OPEN/MATCHED/CLOSED) and minPricePerUnit (which
// appends to priceHistory rather than overwriting it, so the price-history
// endpoint above stays meaningful).
router.patch('/posts/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const store = loadStore();
        const post = store.posts.find((p) => p.id === req.params.id);
        if (!post)
            return next((0, errorHandler_1.createError)('Farmer post not found', 404));
        const isOwner = post.farmerId && post.farmerId === req.user.userId;
        const isAdmin = req.user.role === 'ADMIN';
        if (!isOwner && !isAdmin)
            return next((0, errorHandler_1.createError)('You do not have permission to edit this post', 403));
        const body = req.body || {};
        if (body.status && ['OPEN', 'MATCHED', 'CLOSED'].includes(String(body.status).toUpperCase())) {
            post.status = String(body.status).toUpperCase();
        }
        if (body.minPricePerUnit != null) {
            const newPrice = round2(Number(body.minPricePerUnit));
            if (Number.isFinite(newPrice) && newPrice >= 0 && newPrice !== post.minPricePerUnit) {
                post.minPricePerUnit = newPrice;
                post.priceHistory.push({ price: newPrice, at: now() });
            }
        }
        if (body.quantity != null && Number.isFinite(Number(body.quantity)))
            post.quantity = Number(body.quantity);
        if (body.warehouseAvailable != null)
            post.warehouseAvailable = Boolean(body.warehouseAvailable);
        if (body.storageLocation != null)
            post.storageLocation = String(body.storageLocation).trim() || null;
        if (body.verifiedWeightKg != null)
            post.verifiedWeightKg = Number(body.verifiedWeightKg);
        if (body.notes != null)
            post.notes = String(body.notes).trim() || null;
        post.updatedAt = now();
        store.updatedAt = post.updatedAt;
        saveStore(store);
        res.json({ post });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin: verify/unverify a farmer (seller) ──────────────────────────────
// PATCH /api/farmer-marketplace/posts/:id/verify  { verified: boolean }
// Only applies to guest posts (no linked account). A post from a logged-in
// user is verified/unverified by approving or rejecting their KYC in
// /admin/kyc instead — see the VERIFICATION note at the top of this file.
router.patch('/posts/:id/verify', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const store = loadStore();
        const post = store.posts.find((p) => p.id === req.params.id);
        if (!post)
            return next((0, errorHandler_1.createError)('Farmer post not found', 404));
        if (post.farmerId) {
            return next((0, errorHandler_1.createError)('This post belongs to a registered account — verify or reject the farmer\'s identity documents in /admin/kyc instead of toggling this flag directly.', 400));
        }
        post.verifiedSeller = Boolean(req.body?.verified);
        post.updatedAt = now();
        store.updatedAt = post.updatedAt;
        saveStore(store);
        res.json({ post });
    }
    catch (err) {
        next(err);
    }
});
// ─── Submit a buyer offer on a post ─────────────────────────────────────────
// POST /api/farmer-marketplace/posts/:id/offers
router.post('/posts/:id/offers', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const store = loadStore();
        const post = store.posts.find((p) => p.id === req.params.id);
        if (!post)
            return next((0, errorHandler_1.createError)('Farmer post not found', 404));
        if (post.status === 'CLOSED')
            return next((0, errorHandler_1.createError)('This post is closed and no longer accepting offers.', 400));
        const body = req.body || {};
        const buyerName = String(body.buyerName || '').trim();
        const buyerLocation = String(body.buyerLocation || '').trim();
        const commodityPricePerUnit = Number(body.commodityPricePerUnit);
        const transportPerUnit = Number(body.transportPerUnit ?? 0);
        const storagePerUnit = Number(body.storagePerUnit ?? 0);
        if (!buyerName || !buyerLocation) {
            return next((0, errorHandler_1.createError)('"buyerName" and "buyerLocation" are required.', 400));
        }
        if (!Number.isFinite(commodityPricePerUnit) || commodityPricePerUnit < 0) {
            return next((0, errorHandler_1.createError)('"commodityPricePerUnit" must be a non-negative number.', 400));
        }
        if (!Number.isFinite(transportPerUnit) || transportPerUnit < 0 || !Number.isFinite(storagePerUnit) || storagePerUnit < 0) {
            return next((0, errorHandler_1.createError)('"transportPerUnit" and "storagePerUnit" must be non-negative numbers.', 400));
        }
        const initialKyc = req.user?.userId ? (await kycVerifiedMap([req.user.userId])).get(req.user.userId) ?? false : false;
        const offer = {
            id: (0, crypto_1.randomUUID)(),
            postId: post.id,
            buyerId: req.user?.userId || null,
            buyerName,
            buyerLocation,
            verifiedBuyer: initialKyc,
            commodityPricePerUnit: round2(commodityPricePerUnit),
            transportPerUnit: round2(transportPerUnit),
            storagePerUnit: round2(storagePerUnit),
            platformFeePercent: Number.isFinite(Number(body.platformFeePercent)) ? Number(body.platformFeePercent) : DEFAULT_PLATFORM_FEE_PERCENT,
            transportPartner: body.transportPartner ? String(body.transportPartner).trim() : null,
            escrowStatus: 'NONE',
            notes: body.notes ? String(body.notes).trim() : null,
            createdAt: now(),
        };
        store.offers.push(offer);
        store.updatedAt = offer.createdAt;
        saveStore(store);
        res.status(201).json({ offer: offerWithDelivered(offer) });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin: verify/unverify a buyer ─────────────────────────────────────────
// PATCH /api/farmer-marketplace/offers/:id/verify  { verified: boolean }
// Same rule as the seller-verify endpoint above: only applies to offers
// from guest buyers. A logged-in buyer's offer is verified via their KYC
// review in /admin/kyc.
router.patch('/offers/:id/verify', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const store = loadStore();
        const offer = store.offers.find((o) => o.id === req.params.id);
        if (!offer)
            return next((0, errorHandler_1.createError)('Buyer offer not found', 404));
        if (offer.buyerId) {
            return next((0, errorHandler_1.createError)('This offer belongs to a registered account — verify or reject the buyer\'s identity documents in /admin/kyc instead of toggling this flag directly.', 400));
        }
        offer.verifiedBuyer = Boolean(req.body?.verified);
        store.updatedAt = now();
        saveStore(store);
        res.json({ offer: offerWithDelivered(offer) });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin: remove a post (and its offers) ─────────────────────────────────
router.delete('/posts/:id', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const store = loadStore();
        const posts = store.posts.filter((p) => p.id !== req.params.id);
        if (posts.length === store.posts.length)
            return next((0, errorHandler_1.createError)('Farmer post not found', 404));
        const offers = store.offers.filter((o) => o.postId !== req.params.id);
        const payload = { posts, offers, updatedAt: now() };
        saveStore(payload);
        res.json(payload);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=farmerMarketplace.js.map