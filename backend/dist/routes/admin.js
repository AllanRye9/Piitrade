"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const cdn_1 = require("../utils/cdn");
const email_1 = require("../utils/email");
const logger_1 = require("../utils/logger");
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Site Media Multer Setup ───────────────────────────────────────────────────
const mediaTempDir = path_1.default.join(process.cwd(), 'uploads', 'temp');
if (!fs_1.default.existsSync(mediaTempDir))
    fs_1.default.mkdirSync(mediaTempDir, { recursive: true });
const mediaStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaTempDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `media-${(0, uuid_1.v4)()}${ext}`);
    },
});
const mediaUpload = (0, multer_1.default)({
    storage: mediaStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            cb(new Error('Only JPEG, PNG, GIF and WEBP images are allowed'));
            return;
        }
        cb(null, true);
    },
});
// ─── Interview Demo Video Multer Setup ─────────────────────────────────────────
// Kept entirely separate from mediaUpload above (which stays image-only) so
// this larger, video-specific upload path can't affect the existing hero /
// banner / featured / etc. image upload behaviour in any way.
const videoUpload = (0, multer_1.default)({
    storage: mediaStorage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — enough for a short demo video
    fileFilter: (_req, file, cb) => {
        const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
        if (!allowed.includes(file.mimetype)) {
            cb(new Error('Only MP4, WEBM, MOV and AVI video files are allowed'));
            return;
        }
        cb(null, true);
    },
});
const router = (0, express_1.Router)();
const PACKAGE_SCOPES = ['LISTING', 'CV'];
const ADMIN_MANAGEABLE_ROLES = ['BUYER', 'SELLER', 'ADMIN', 'AGENT', 'ORGANIZATION', 'COMPANY'];
const SUPPORTED_CURRENCIES = ['AED', 'UGX', 'KES', 'CNY', 'USD'];
function parseScope(scope) {
    if (!scope)
        return 'LISTING';
    if (PACKAGE_SCOPES.includes(scope))
        return scope;
    throw (0, errorHandler_1.createError)('scope must be LISTING or CV', 400);
}
router.use(auth_1.authenticate, (0, auth_1.authorize)('ADMIN'));
// ─── Site settings defaults ─────────────────────────────────────────────────────
// Persisted values live in SiteConfig.generalSettings (see the /settings routes
// below); this object only supplies fallback defaults for any key not yet set.
const defaultSettings = {
    siteName: 'Piitrade',
    maintenanceMode: false,
    allowRegistration: true,
    defaultCountry: 'UGANDA',
    itemsPerPage: 20,
    maxImagesPerListing: 10,
    trialDays: 7, // Free trial period for new ordinary users (admin-configurable)
    // Master switch for the mobile "Special finds" popup (see
    // MobileSpecialOffersPopup.tsx on the frontend). When off, the popup never
    // renders at all — even its collapsed docked icon. When on, the popup
    // decides for itself (client-side, via localStorage) whether to auto-open
    // on first visit / a later revisit / when new qualifying listings appear.
    specialFindsEnabled: true,
};
// ─── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', async (_req, res, next) => {
    try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const [users, listings, reports, activeListings, pendingListings, newUsersThisMonth, newListingsThisMonth, recentUsers, recentListings, listingsByStatusRaw, usersByCountryRaw, siteStat,] = await Promise.all([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.listing.count(),
            prisma_1.prisma.report.count(),
            prisma_1.prisma.listing.count({ where: { status: 'ACTIVE' } }),
            prisma_1.prisma.listing.count({ where: { status: 'PENDING' } }),
            prisma_1.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
            prisma_1.prisma.listing.count({ where: { createdAt: { gte: startOfMonth } } }),
            prisma_1.prisma.user.findMany({
                select: { id: true, email: true, name: true, role: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
                take: 5,
            }),
            prisma_1.prisma.listing.findMany({
                select: { id: true, title: true, status: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
                take: 5,
            }),
            prisma_1.prisma.listing.groupBy({ by: ['status'], _count: { status: true } }),
            prisma_1.prisma.user.groupBy({ by: ['country'], _count: { country: true } }),
            prisma_1.prisma.siteStat.findUnique({ where: { id: 'global' } }),
        ]);
        const listingsByStatus = listingsByStatusRaw.reduce((acc, row) => ({ ...acc, [row.status]: row._count.status }), {});
        const usersByCountry = usersByCountryRaw.reduce((acc, row) => ({ ...acc, [row.country]: row._count.country }), {});
        // Parse visitor countries from site stats (tracked from Cloudflare headers)
        let visitorCountries = [];
        // Parse per-country visit counts for the Countries Reached list display
        let countryVisitCounts = {};
        if (siteStat?.visitorCountries) {
            try {
                visitorCountries = JSON.parse(siteStat.visitorCountries);
            }
            catch {
                visitorCountries = [];
            }
        }
        if (siteStat?.countryVisitCounts) {
            try {
                countryVisitCounts = JSON.parse(siteStat.countryVisitCounts);
            }
            catch {
                countryVisitCounts = {};
            }
        }
        res.json({
            users,
            listings,
            reports,
            activeListings,
            pendingListings,
            newUsersThisMonth,
            newListingsThisMonth,
            recentUsers,
            recentListings,
            listingsByStatus,
            usersByCountry,
            visitorCountries,
            countryVisitCounts, // per-country visit counts: { "AE": 42, "US": 15, ... }
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Visitor Logs (proof-of-visit: IP, date/time, device, time on site) ────────
// One row per deviceId per local day — see VisitorLog in schema.prisma and
// POST /api/stats/track for how these rows are written.
// Device-category prefixes exactly as produced by describeDevice() in
// stats.ts (e.g. "Mobile · Safari") — used to validate the deviceCategory
// filter below so an arbitrary/unexpected value can't silently return an
// empty result set.
const VISITOR_DEVICE_CATEGORIES = ['Mobile', 'Desktop', 'Tablet', 'Unknown device'];
// Columns safe to sort visitor logs by — allowlisted so `sortBy` can never
// be used to inject an arbitrary/unexpected Prisma orderBy key.
const VISITOR_LOG_SORT_COLUMNS = [
    'lastSeenAt', 'firstSeenAt', 'visitCount', 'durationSeconds', 'country', 'device', 'ip',
];
router.get('/visitor-logs', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '25'));
        const search = (req.query.search || '').trim();
        const date = (req.query.date || '').trim(); // exact dayKey, e.g. 2026-08-25
        const country = (req.query.country || '').trim().toUpperCase();
        const deviceCategory = (req.query.deviceCategory || '').trim();
        const requestedSortBy = req.query.sortBy || 'lastSeenAt';
        const sortBy = VISITOR_LOG_SORT_COLUMNS.includes(requestedSortBy)
            ? requestedSortBy
            : 'lastSeenAt';
        const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
        const where = {};
        if (date) {
            where.dayKey = date;
        }
        if (country) {
            where.country = country;
        }
        if (deviceCategory && VISITOR_DEVICE_CATEGORIES.includes(deviceCategory)) {
            // "Unknown device" is the device field's exact value with no " · "
            // suffix (see describeDevice() in stats.ts); every other category is
            // a prefix ("Mobile · Safari", "Mobile · Chrome", ...).
            where.device = deviceCategory === 'Unknown device'
                ? deviceCategory
                : { startsWith: `${deviceCategory} ·` };
        }
        if (search) {
            where.OR = [
                { ip: { contains: search, mode: 'insensitive' } },
                { deviceId: { contains: search, mode: 'insensitive' } },
                { country: { contains: search, mode: 'insensitive' } },
                { device: { contains: search, mode: 'insensitive' } },
            ];
        }
        // Country breakdown is computed against every filter except `country`
        // itself, so the dropdown always lists every country available within
        // the current search/date scope — not just whichever one is currently
        // selected.
        const { country: _omitCountry, ...whereForBreakdown } = where;
        const [logs, total, uniqueDeviceCount, countryBreakdownRows] = await Promise.all([
            prisma_1.prisma.visitorLog.findMany({
                where,
                orderBy: { [sortBy]: sortDir },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma_1.prisma.visitorLog.count({ where }),
            prisma_1.prisma.visitorLog.groupBy({ by: ['deviceId'], where }).then((rows) => rows.length),
            prisma_1.prisma.visitorLog.groupBy({
                by: ['country'],
                where: whereForBreakdown,
                _count: { country: true },
                orderBy: { _count: { country: 'desc' } },
            }),
        ]);
        const countryBreakdown = countryBreakdownRows.map((row) => ({
            country: row.country,
            count: row._count.country,
        }));
        res.json({ logs, pagination: { total, page, limit }, uniqueDeviceCount, countryBreakdown });
    }
    catch (err) {
        next(err);
    }
});
// ─── Search & click analytics ───────────────────────────────────────────────
// Raw logs are written by utils/analyticsLogger.ts from GET /listings
// (search) and GET /listings/:id (item click) — see that file for exactly
// what's recorded (search context / item title+image are always recorded;
// user and location details only when available).
// Sortable columns exposed for /admin/search-logs' advanced querying —
// mirrors the pattern already used by /admin/visitor-logs.
const SEARCH_LOG_SORT_COLUMNS = ['createdAt', 'resultCount', 'query'];
router.get('/search-logs', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '25'));
        const search = (req.query.search || '').trim();
        const dateFrom = (req.query.dateFrom || '').trim();
        const dateTo = (req.query.dateTo || '').trim();
        const requestedSortBy = req.query.sortBy || 'createdAt';
        const sortBy = SEARCH_LOG_SORT_COLUMNS.includes(requestedSortBy)
            ? requestedSortBy
            : 'createdAt';
        const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
        const where = {
            ...(search ? {
                OR: [
                    { query: { contains: search, mode: 'insensitive' } },
                    { userEmail: { contains: search, mode: 'insensitive' } },
                    { userPhone: { contains: search, mode: 'insensitive' } },
                    { ip: { contains: search, mode: 'insensitive' } },
                    { ipCountry: { contains: search, mode: 'insensitive' } },
                ],
            } : {}),
            ...((dateFrom || dateTo) ? {
                createdAt: {
                    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
                },
            } : {}),
        };
        const [logs, total] = await Promise.all([
            prisma_1.prisma.searchLog.findMany({
                where,
                orderBy: { [sortBy]: sortDir },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma_1.prisma.searchLog.count({ where }),
        ]);
        res.json({ logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
    }
    catch (err) {
        next(err);
    }
});
const CLICK_LOG_SORT_COLUMNS = ['createdAt', 'listingTitle'];
router.get('/click-logs', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '25'));
        const search = (req.query.search || '').trim();
        const dateFrom = (req.query.dateFrom || '').trim();
        const dateTo = (req.query.dateTo || '').trim();
        const requestedSortBy = req.query.sortBy || 'createdAt';
        const sortBy = CLICK_LOG_SORT_COLUMNS.includes(requestedSortBy)
            ? requestedSortBy
            : 'createdAt';
        const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
        const where = {
            ...(search ? {
                OR: [
                    { listingTitle: { contains: search, mode: 'insensitive' } },
                    { userEmail: { contains: search, mode: 'insensitive' } },
                    { userPhone: { contains: search, mode: 'insensitive' } },
                    { ip: { contains: search, mode: 'insensitive' } },
                    { ipCountry: { contains: search, mode: 'insensitive' } },
                ],
            } : {}),
            ...((dateFrom || dateTo) ? {
                createdAt: {
                    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
                },
            } : {}),
        };
        const [logs, total] = await Promise.all([
            prisma_1.prisma.listingClickLog.findMany({
                where,
                orderBy: { [sortBy]: sortDir },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma_1.prisma.listingClickLog.count({ where }),
        ]);
        res.json({ logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
    }
    catch (err) {
        next(err);
    }
});
// Aggregated "most clicked items" — grouped by listing so a still-active
// listing shows its live click count. Deleted listings (listingId set to
// null by the FK's onDelete: SetNull) are grouped separately by their
// snapshotted title/image so they still surface in the ranking instead of
// silently disappearing.
router.get('/click-logs/most-clicked', async (req, res, next) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
        const [byListing, byDeletedListing] = await Promise.all([
            prisma_1.prisma.listingClickLog.groupBy({
                by: ['listingId'],
                where: { listingId: { not: null } },
                _count: { listingId: true },
                orderBy: { _count: { listingId: 'desc' } },
                take: limit,
            }),
            prisma_1.prisma.listingClickLog.groupBy({
                by: ['listingTitle', 'listingImage'],
                where: { listingId: null },
                _count: { listingTitle: true },
                orderBy: { _count: { listingTitle: 'desc' } },
                take: limit,
            }),
        ]);
        const listingIds = byListing.map((row) => row.listingId).filter((id) => id !== null);
        const listings = await prisma_1.prisma.listing.findMany({
            where: { id: { in: listingIds } },
            select: {
                id: true, title: true, images: true, status: true,
                // Same "best available image" resolution used on listing cards
                // site-wide (see frontend/components/listings/ListingCard.tsx) and
                // by utils/analyticsLogger.ts: an approved product image first,
                // falling back to the legacy `images[0]`.
                productImages: {
                    where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
                    select: { cdnUrl: true },
                    orderBy: { uploadedAt: 'asc' },
                    take: 1,
                },
            },
        });
        const listingMap = new Map(listings.map((l) => [l.id, l]));
        const activeItems = byListing.map((row) => {
            const listing = row.listingId ? listingMap.get(row.listingId) : undefined;
            return {
                listingId: row.listingId,
                // Prefer the live listing's current title/image (kept up to date if
                // the seller edits it); fall back to nothing if it was somehow
                // removed from the map (shouldn't happen given the where filter).
                title: listing?.title ?? 'Unknown listing',
                image: listing?.productImages?.[0]?.cdnUrl ?? listing?.images?.[0] ?? null,
                status: listing?.status ?? null,
                clicks: row._count.listingId,
            };
        });
        const deletedItems = byDeletedListing.map((row) => ({
            listingId: null,
            title: row.listingTitle,
            image: row.listingImage,
            status: 'DELETED',
            clicks: row._count.listingTitle,
        }));
        const mostClicked = [...activeItems, ...deletedItems]
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, limit);
        res.json({ items: mostClicked });
    }
    catch (err) {
        next(err);
    }
});
// ─── Analytics ─────────────────────────────────────────────────────────────────
router.get('/analytics', async (_req, res, next) => {
    try {
        const rangeEnd = new Date();
        rangeEnd.setHours(23, 59, 59, 999);
        const rangeStart = new Date(rangeEnd);
        rangeStart.setDate(rangeStart.getDate() - 29);
        rangeStart.setHours(0, 0, 0, 0);
        const [recentUsers, recentListings, topCategoriesRaw, listingsByCountryRaw,] = await Promise.all([
            prisma_1.prisma.user.findMany({
                where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
                select: { createdAt: true },
                orderBy: { createdAt: 'asc' },
            }),
            prisma_1.prisma.listing.findMany({
                where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
                select: { createdAt: true },
                orderBy: { createdAt: 'asc' },
            }),
            prisma_1.prisma.listing.groupBy({
                by: ['categoryId'],
                _count: { categoryId: true },
                orderBy: { _count: { categoryId: 'desc' } },
                take: 10,
            }),
            prisma_1.prisma.listing.groupBy({
                by: ['country'],
                _count: { country: true },
            }),
        ]);
        // Bucket users and listings by date
        const bucketByDate = (records) => {
            const counts = {};
            for (let i = 0; i < 30; i++) {
                const d = new Date(rangeStart);
                d.setDate(d.getDate() + i);
                counts[d.toISOString().slice(0, 10)] = 0;
            }
            for (const record of records) {
                const key = record.createdAt.toISOString().slice(0, 10);
                if (key in counts)
                    counts[key]++;
            }
            return Object.entries(counts).map(([date, count]) => ({ date, count }));
        };
        const userGrowth = bucketByDate(recentUsers);
        const listingGrowth = bucketByDate(recentListings);
        // Resolve category names for topCategories
        const categoryIds = topCategoriesRaw.map((c) => c.categoryId);
        const categories = await prisma_1.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
        });
        const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
        const topCategories = topCategoriesRaw.map((row) => ({
            name: categoryMap.get(row.categoryId) ?? 'Unknown',
            count: row._count.categoryId,
        }));
        const listingsByCountry = listingsByCountryRaw.reduce((acc, row) => ({ ...acc, [row.country]: row._count.country }), {});
        // Revenue by category (sum of prices, top 10)
        const revenueByCategoryRaw = await prisma_1.prisma.listing.groupBy({
            by: ['categoryId'],
            _sum: { price: true },
            orderBy: { _sum: { price: 'desc' } },
            take: 10,
        });
        const revCategoryIds = revenueByCategoryRaw.map((r) => r.categoryId);
        const revCategories = await prisma_1.prisma.category.findMany({
            where: { id: { in: revCategoryIds } },
            select: { id: true, name: true },
        });
        const revCategoryMap = new Map(revCategories.map((c) => [c.id, c.name]));
        const revenueByCategory = revenueByCategoryRaw.map((row) => ({
            name: revCategoryMap.get(row.categoryId) ?? 'Unknown',
            total: row._sum.price ?? 0,
        }));
        res.json({
            userGrowth,
            listingGrowth,
            topCategories,
            listingsByCountry,
            revenueByCategory,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const search = (req.query.search || '').trim();
        const where = search
            ? {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }
            : {};
        const [users, total] = await Promise.all([
            prisma_1.prisma.user.findMany({
                where,
                select: { id: true, email: true, name: true, role: true, country: true, isBanned: true, isVerified: true, createdAt: true },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.user.count({ where }),
        ]);
        res.json({ users, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.get('/users/admin-approval-audit', async (_req, res, next) => {
    try {
        const logs = await prisma_1.prisma.notification.findMany({
            where: {
                type: 'SYSTEM',
                title: 'Admin role approved',
            },
            select: {
                id: true,
                createdAt: true,
                userId: true,
                user: { select: { name: true, email: true } },
                data: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        const audit = logs.map((log) => {
            const meta = (log.data ?? {});
            return {
                id: log.id,
                approvedAt: log.createdAt,
                approvedUserId: log.userId,
                approvedUserName: log.user.name,
                approvedUserEmail: log.user.email,
                approverId: meta.approverId ?? null,
                approverName: meta.approverName ?? null,
                approverEmail: meta.approverEmail ?? null,
            };
        });
        res.json({ audit });
    }
    catch (err) {
        next(err);
    }
});
router.put('/users/:id', async (req, res, next) => {
    try {
        const { isBanned, isVerified, role } = req.body;
        const targetUserId = req.params.id;
        const actorUserId = req.user?.userId;
        if (typeof isBanned !== 'undefined' && typeof isBanned !== 'boolean') {
            throw (0, errorHandler_1.createError)('isBanned must be a boolean', 400);
        }
        if (typeof isVerified !== 'undefined' && typeof isVerified !== 'boolean') {
            throw (0, errorHandler_1.createError)('isVerified must be a boolean', 400);
        }
        let validatedRole;
        if (typeof role !== 'undefined') {
            if (typeof role !== 'string' || !ADMIN_MANAGEABLE_ROLES.includes(role)) {
                throw (0, errorHandler_1.createError)('Invalid role value', 400);
            }
            validatedRole = role;
        }
        if (actorUserId && actorUserId === targetUserId && (typeof isBanned !== 'undefined' ||
            typeof validatedRole !== 'undefined' ||
            typeof isVerified !== 'undefined')) {
            throw (0, errorHandler_1.createError)('You cannot change your own role, ban state, or verification state', 400);
        }
        const targetUser = await prisma_1.prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true, role: true },
        });
        if (!targetUser) {
            throw (0, errorHandler_1.createError)('User not found', 404);
        }
        if (validatedRole === 'ADMIN' && targetUser.role !== 'ADMIN') {
            const existingAdmins = await prisma_1.prisma.user.count({ where: { role: 'ADMIN' } });
            if (existingAdmins >= 3) {
                throw (0, errorHandler_1.createError)('Maximum admin limit reached (3)', 400);
            }
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: targetUserId },
            data: {
                ...(isBanned !== undefined && { isBanned }),
                ...(isVerified !== undefined && { isVerified }),
                ...(validatedRole && { role: validatedRole }),
            },
            select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
        });
        res.json(user);
    }
    catch (err) {
        next(err);
    }
});
// ─── KYC (Know Your Customer) identity verification queue ─────────────────────
router.get('/kyc', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = (req.query.status || 'PENDING').trim();
        const validStatuses = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'];
        const where = validStatuses.includes(status) ? { kycStatus: status } : {};
        const [users, total] = await Promise.all([
            prisma_1.prisma.user.findMany({
                where,
                select: {
                    id: true, name: true, email: true, role: true, country: true,
                    kycStatus: true, kycDocumentType: true, kycDocumentUrl: true, kycDocumentBackUrl: true, kycSelfieUrl: true,
                    kycFullName: true, kycSubmittedAt: true, kycReviewedAt: true, kycRejectionReason: true,
                    isKycVerified: true,
                },
                // Oldest submission first (FIFO), so the queue processes in submission order.
                orderBy: { kycSubmittedAt: 'asc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma_1.prisma.user.count({ where }),
        ]);
        res.json({ users, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/kyc/:id/approve', async (req, res, next) => {
    try {
        const target = await prisma_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: { id: true, name: true, email: true, kycStatus: true },
        });
        if (!target)
            throw (0, errorHandler_1.createError)('User not found', 404);
        if (target.kycStatus !== 'PENDING') {
            throw (0, errorHandler_1.createError)('Only submissions with status PENDING can be approved', 400);
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: req.params.id },
            data: {
                kycStatus: 'APPROVED',
                isKycVerified: true,
                kycReviewedAt: new Date(),
                kycReviewedBy: req.user?.userId,
                kycRejectionReason: null,
            },
            select: { id: true, name: true, email: true, kycStatus: true, isKycVerified: true },
        });
        await prisma_1.prisma.notification.create({
            data: {
                userId: user.id,
                type: 'KYC_APPROVED',
                title: 'Identity Verified',
                message: 'Your identity verification (KYC) has been approved. Your listings now get priority review and your profile shows a KYC Verified badge.',
                data: {},
            },
        }).catch((err) => logger_1.logger.error('Failed to create KYC_APPROVED notification', err));
        res.json(user);
    }
    catch (err) {
        next(err);
    }
});
router.put('/kyc/:id/reject', async (req, res, next) => {
    try {
        const { reason } = req.body;
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
            throw (0, errorHandler_1.createError)('A rejection reason is required', 400);
        }
        const target = await prisma_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: { id: true, kycStatus: true },
        });
        if (!target)
            throw (0, errorHandler_1.createError)('User not found', 404);
        if (target.kycStatus !== 'PENDING') {
            throw (0, errorHandler_1.createError)('Only submissions with status PENDING can be rejected', 400);
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: req.params.id },
            data: {
                kycStatus: 'REJECTED',
                isKycVerified: false,
                kycReviewedAt: new Date(),
                kycReviewedBy: req.user?.userId,
                kycRejectionReason: reason.trim(),
            },
            select: { id: true, name: true, email: true, kycStatus: true, kycRejectionReason: true },
        });
        await prisma_1.prisma.notification.create({
            data: {
                userId: user.id,
                type: 'KYC_REJECTED',
                title: 'Identity Verification Rejected',
                message: `Your KYC submission was rejected: ${user.kycRejectionReason}. You can resubmit with corrected documents.`,
                data: {},
            },
        }).catch((err) => logger_1.logger.error('Failed to create KYC_REJECTED notification', err));
        res.json(user);
    }
    catch (err) {
        next(err);
    }
});
router.post('/users/:id/approve-admin', async (req, res, next) => {
    try {
        if (req.user?.userId === req.params.id) {
            throw (0, errorHandler_1.createError)('Your account is already admin-approved', 400);
        }
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: { id: true, role: true },
        });
        if (!existingUser) {
            throw (0, errorHandler_1.createError)('User not found', 404);
        }
        if (existingUser.role === 'ADMIN') {
            throw (0, errorHandler_1.createError)('User is already an admin', 400);
        }
        const existingAdmins = await prisma_1.prisma.user.count({ where: { role: 'ADMIN' } });
        if (existingAdmins >= 3) {
            throw (0, errorHandler_1.createError)('Maximum admin limit reached (3)', 400);
        }
        const approver = await prisma_1.prisma.user.findUnique({
            where: { id: req.user?.userId },
            select: { id: true, name: true, email: true },
        });
        if (!approver) {
            throw (0, errorHandler_1.createError)('Approver account not found', 401);
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: req.params.id },
            data: { role: 'ADMIN', isVerified: true },
            select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
        });
        await prisma_1.prisma.notification.create({
            data: {
                userId: user.id,
                type: 'SYSTEM',
                title: 'Admin role approved',
                message: `Your account was approved as an admin by ${approver.name}.`,
                data: {
                    action: 'ADMIN_ROLE_APPROVAL',
                    approverId: approver.id,
                    approverName: approver.name,
                    approverEmail: approver.email,
                },
            },
        });
        res.json({ message: 'User approved as admin successfully', user });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/users/:id', async (req, res, next) => {
    try {
        if (req.user?.userId === req.params.id) {
            throw (0, errorHandler_1.createError)('Cannot delete your own account', 400);
        }
        await prisma_1.prisma.user.delete({ where: { id: req.params.id } });
        res.json({ message: 'User deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Listings ──────────────────────────────────────────────────────────────────
const LISTING_SORT_COLUMNS = ['createdAt', 'price', 'title', 'views'];
router.get('/listings', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const search = (req.query.search || '').trim();
        const status = (req.query.status || '').trim();
        const categoryId = (req.query.categoryId || '').trim();
        const country = (req.query.country || '').trim();
        const dateFrom = (req.query.dateFrom || '').trim();
        const dateTo = (req.query.dateTo || '').trim();
        const requestedSortBy = (req.query.sortBy || '').trim();
        const sortBy = LISTING_SORT_COLUMNS.includes(requestedSortBy)
            ? requestedSortBy
            : '';
        const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
        const where = {};
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (status) {
            where.status = status;
        }
        if (categoryId) {
            where.categoryId = categoryId;
        }
        if (country) {
            where.country = country;
        }
        if (dateFrom || dateTo) {
            where.createdAt = {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
            };
        }
        const [listings, total] = await Promise.all([
            prisma_1.prisma.listing.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true, isKycVerified: true } },
                    category: { select: { id: true, name: true, slug: true } },
                    productImages: {
                        where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
                        select: { cdnUrl: true },
                        orderBy: { uploadedAt: 'asc' },
                        take: 1,
                    },
                },
                skip: (page - 1) * limit,
                take: limit,
                // When the admin picks an explicit sort column, honor it outright.
                // Otherwise fall back to the default queue ordering: KYC-verified
                // sellers' listings surface first so their submissions get reviewed
                // faster, then by submission order.
                orderBy: sortBy
                    ? [{ [sortBy]: sortDir }]
                    : [
                        { user: { isKycVerified: 'desc' } },
                        { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
                    ],
            }),
            prisma_1.prisma.listing.count({ where }),
        ]);
        res.json({ listings, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/listings/:id', async (req, res, next) => {
    try {
        const { status, placement, placementExpiresAt, categoryId } = req.body;
        const nextStatus = status;
        const nextPlacement = placement;
        const validStatuses = ['ACTIVE', 'PENDING', 'SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'];
        const validPlacements = ['NONE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE'];
        if (nextStatus && !validStatuses.includes(nextStatus)) {
            throw (0, errorHandler_1.createError)('Invalid listing status', 400);
        }
        if (nextPlacement && !validPlacements.includes(nextPlacement)) {
            throw (0, errorHandler_1.createError)('Invalid listing placement', 400);
        }
        if (categoryId) {
            const targetCategory = await prisma_1.prisma.category.findUnique({ where: { id: categoryId } });
            if (!targetCategory) {
                throw (0, errorHandler_1.createError)('Category not found', 404);
            }
        }
        // Flash Deals cap: max 100 active flash-sale listings
        const FLASH_DEAL_MAX = 100;
        if (nextPlacement === 'FLASH_SALE') {
            const currentFlashCount = await prisma_1.prisma.listing.count({
                where: { placement: 'FLASH_SALE', id: { not: req.params.id } },
            });
            if (currentFlashCount >= FLASH_DEAL_MAX) {
                throw (0, errorHandler_1.createError)(`Flash Deals are limited to ${FLASH_DEAL_MAX} listings. Remove one before adding another.`, 400);
            }
        }
        const mustClearPlacement = nextStatus && ['SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'].includes(nextStatus);
        // Re-categorizing a listing without also explicitly setting a placement
        // resets it to NONE — a featured slot from the old category shouldn't
        // silently carry over into the new one.
        const mustClearPlacementForRecategorize = categoryId && nextPlacement === undefined;
        const listing = await prisma_1.prisma.listing.update({
            where: { id: req.params.id },
            data: {
                ...(nextStatus && { status: nextStatus }),
                ...(categoryId && { categoryId }),
                ...(nextPlacement !== undefined && { placement: nextPlacement }),
                ...(placementExpiresAt !== undefined && { placementExpiresAt: placementExpiresAt ? new Date(placementExpiresAt) : null }),
                ...(mustClearPlacement && { placement: 'NONE', placementExpiresAt: null }),
                ...(nextPlacement === 'NONE' && { placementExpiresAt: null }),
                ...(mustClearPlacementForRecategorize && { placement: 'NONE', placementExpiresAt: null }),
            },
        });
        res.json(listing);
    }
    catch (err) {
        next(err);
    }
});
// ─── Bulk move listings to a different category ────────────────────────────────
// Only ever touches categoryId + placement/placementExpiresAt on the moved
// listings — title, images, price, status, etc. are left untouched.
router.post('/listings/move-category', async (req, res, next) => {
    try {
        const { ids, categoryId } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw (0, errorHandler_1.createError)('ids must be a non-empty array', 400);
        }
        if (!categoryId) {
            throw (0, errorHandler_1.createError)('categoryId is required', 400);
        }
        const targetCategory = await prisma_1.prisma.category.findUnique({ where: { id: categoryId } });
        if (!targetCategory) {
            throw (0, errorHandler_1.createError)('Category not found', 404);
        }
        const featuredClearedCount = await prisma_1.prisma.listing.count({
            where: { id: { in: ids }, placement: { not: 'NONE' } },
        });
        const result = await prisma_1.prisma.listing.updateMany({
            where: { id: { in: ids } },
            data: { categoryId, placement: 'NONE', placementExpiresAt: null },
        });
        res.json({
            message: `Moved ${result.count} listing(s) to ${targetCategory.name}${featuredClearedCount > 0 ? `, cleared featured placement on ${featuredClearedCount} of them` : ''}.`,
            moved: result.count,
            placementCleared: featuredClearedCount,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Approve listing with placement & duration ─────────────────────────────────
router.put('/listings/:id/approve', async (req, res, next) => {
    try {
        const { placement, durationHours, customExpiry } = req.body;
        if (!placement || !['LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE'].includes(placement)) {
            throw (0, errorHandler_1.createError)('placement must be LATEST_COLLECTIONS, FEATURED_DEAL, or FLASH_SALE', 400);
        }
        // Flash Deals cap: max 100 at a time
        if (placement === 'FLASH_SALE') {
            const flashCount = await prisma_1.prisma.listing.count({
                where: { placement: 'FLASH_SALE', id: { not: req.params.id } },
            });
            if (flashCount >= 100) {
                throw (0, errorHandler_1.createError)('Flash Deals are limited to 100 listings. Remove one before adding another.', 400);
            }
        }
        let placementExpiresAt;
        if (customExpiry) {
            placementExpiresAt = new Date(customExpiry);
            if (isNaN(placementExpiresAt.getTime())) {
                throw (0, errorHandler_1.createError)('Invalid customExpiry date', 400);
            }
        }
        else {
            const hours = parseInt(durationHours) || 48;
            placementExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        }
        // Fetch current listing to get the owner's userId and role
        const currentListing = await prisma_1.prisma.listing.findUnique({
            where: { id: req.params.id },
            select: { userId: true, user: { select: { role: true } } },
        });
        if (!currentListing)
            throw (0, errorHandler_1.createError)('Listing not found', 404);
        // Admin-owned listings never expire unless the admin explicitly sets a date.
        // For non-admin sellers, derive expiry from their active subscription.
        const now = new Date();
        const isOwnerAdmin = currentListing.user?.role === 'ADMIN';
        let listingExpiresAt = null;
        if (!isOwnerAdmin) {
            const activeSub = await prisma_1.prisma.sellerSubscription.findFirst({
                where: { userId: currentListing.userId, status: 'ACTIVE', endDate: { gt: now }, package: { scope: 'LISTING' } },
                include: { package: true },
                orderBy: { endDate: 'desc' },
            });
            listingExpiresAt = activeSub
                ? activeSub.endDate
                : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
        const listing = await prisma_1.prisma.listing.update({
            where: { id: req.params.id },
            data: {
                status: 'ACTIVE',
                placement,
                placementExpiresAt,
                ...(listingExpiresAt !== null ? { expiresAt: listingExpiresAt } : { expiresAt: null }),
            },
            include: {
                user: { select: { id: true, name: true, email: true } },
                category: { select: { name: true } },
            },
        });
        // In-app notification
        await prisma_1.prisma.notification.create({
            data: {
                userId: listing.user.id,
                type: 'LISTING_APPROVED',
                title: 'Listing Approved',
                message: listingExpiresAt
                    ? `Your listing "${listing.title}" has been approved and is now live until ${listingExpiresAt.toLocaleDateString()}.`
                    : `Your listing "${listing.title}" has been approved and is now live.`,
                data: { listingId: listing.id, listingTitle: listing.title },
            },
        }).catch((err) => logger_1.logger.error('Failed to create LISTING_APPROVED notification', err));
        // Approval email (non-blocking)
        (0, email_1.sendListingApprovedEmail)(listing.user.email, listing.user.name, listing.title, listingExpiresAt)
            .catch((err) => logger_1.logger.error('Failed to send listing approved email', err));
        res.json(listing);
    }
    catch (err) {
        next(err);
    }
});
// ─── Reject listing ────────────────────────────────────────────────────────────
router.put('/listings/:id/reject', async (req, res, next) => {
    try {
        const listing = await prisma_1.prisma.listing.update({
            where: { id: req.params.id },
            data: { status: 'REJECTED', placement: 'NONE', placementExpiresAt: null },
            include: {
                user: { select: { id: true } },
            },
        });
        await prisma_1.prisma.notification.create({
            data: {
                userId: listing.user.id,
                type: 'LISTING_REJECTED',
                title: 'Listing Rejected',
                message: `Your listing "${listing.title}" was rejected by an administrator.`,
                data: { listingId: listing.id },
            },
        }).catch((err) => logger_1.logger.error('Failed to create LISTING_REJECTED notification', err));
        res.json(listing);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/listings/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.listing.delete({ where: { id: req.params.id } });
        res.json({ message: 'Listing deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin Bulk Actions (approve / reject / delete) ────────────────────────────
// POST /admin/listings/bulk-action
// Body: { ids: string[], action: 'approve' | 'reject' | 'delete' | 'feature' }
router.post('/listings/bulk-action', async (req, res, next) => {
    try {
        const { ids, action } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw (0, errorHandler_1.createError)('ids array is required and must not be empty', 400);
        }
        if (!['approve', 'reject', 'delete', 'feature'].includes(action)) {
            throw (0, errorHandler_1.createError)('action must be one of: approve, reject, delete, feature', 400);
        }
        if (action === 'delete') {
            await prisma_1.prisma.listing.deleteMany({ where: { id: { in: ids } } });
            return res.json({ message: `${ids.length} listing(s) deleted`, affected: ids.length });
        }
        const statusMap = {
            approve: 'ACTIVE',
            reject: 'REJECTED',
            feature: 'ACTIVE',
        };
        const updateData = { status: statusMap[action] };
        if (action === 'feature') {
            const placementExpiry = new Date();
            placementExpiry.setHours(placementExpiry.getHours() + 48);
            updateData.placement = 'LATEST_COLLECTIONS';
            updateData.placementExpiresAt = placementExpiry;
        }
        await prisma_1.prisma.listing.updateMany({ where: { id: { in: ids } }, data: updateData });
        return res.json({ message: `${ids.length} listing(s) updated`, affected: ids.length });
    }
    catch (err) {
        next(err);
    }
});
// Validates the required fields for every item in a bulk-post batch before
// any database writes happen, so a single bad row fails the whole batch
// with a precise message instead of a confusing partial Prisma error deep
// into the transaction. Stock is mandatory (mirrors the single-listing
// POST /listings endpoint) — every bulk-posted listing must declare how
// many units are available.
function validateBulkItems(items) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const row = i + 1;
        if (!item.title || !item.title.trim())
            return `Row ${row}: title is required`;
        if (!item.description || !item.description.trim())
            return `Row ${row}: description is required`;
        if (item.price == null || isNaN(Number(item.price)) || Number(item.price) < 0) {
            return `Row ${row}: price must be a valid non-negative number`;
        }
        if (!item.country)
            return `Row ${row}: country is required`;
        if (!item.location || !item.location.trim())
            return `Row ${row}: location is required`;
        if (!item.categoryId)
            return `Row ${row}: category is required`;
        if (item.stock == null || item.stock === '') {
            return `Row ${row}: stock is required`;
        }
        const parsedStock = parseInt(String(item.stock), 10);
        if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== String(item.stock).trim()) {
            return `Row ${row}: stock must be a valid non-negative whole number`;
        }
    }
    // ── Uganda-only bulk posting ──
    // Bulk-created listings are subject to the same Uganda-only restriction
    // as the single-listing POST /listings endpoint. Every offending row is
    // reported together (rather than stopping at the first one) so an admin
    // correcting a CSV/import batch can see every row that needs fixing in
    // one pass. The batch itself still runs as a single all-or-nothing
    // transaction (see prisma.$transaction below), so no partial batch is
    // ever created — flagging every bad row up front is purely for a clearer
    // error message.
    const invalidCountryRows = items
        .map((item, i) => ({ item, row: i + 1 }))
        .filter(({ item }) => String(item.country).toUpperCase() !== 'UGANDA')
        .map(({ row }) => row);
    if (invalidCountryRows.length > 0) {
        return `Country mismatch: Listings created through this endpoint must have Uganda as the country. Invalid row(s): ${invalidCountryRows.join(', ')}`;
    }
    return null;
}
// Builds the Prisma `data` object for a single bulk item, shared by both the
// JSON-only and multipart (with images) bulk endpoints below so the two
// stay in sync instead of silently drifting apart field-by-field.
function buildBulkListingData(item, adminId, images) {
    return {
        title: item.title,
        description: item.description,
        price: Number(item.price),
        currency: item.currency,
        condition: item.condition || 'NEW',
        country: item.country,
        location: item.location,
        categoryId: item.categoryId,
        userId: adminId,
        status: 'ACTIVE',
        stock: parseInt(String(item.stock), 10),
        tags: item.tags ?? [],
        images,
        ...(item.motorDetails && Object.values(item.motorDetails).some(Boolean) && { motorDetails: item.motorDetails }),
        ...(item.propertyDetails && Object.values(item.propertyDetails).some(Boolean) && { propertyDetails: item.propertyDetails }),
        ...(item.jobDetails && Object.values(item.jobDetails).some(Boolean) && { jobDetails: item.jobDetails }),
        ...(item.productOptions && item.productOptions.length > 0 && { productOptions: item.productOptions }),
        ...(item.latitude != null && item.latitude !== '' && { latitude: parseFloat(String(item.latitude)) }),
        ...(item.longitude != null && item.longitude !== '' && { longitude: parseFloat(String(item.longitude)) }),
    };
}
router.post('/listings/bulk', async (req, res, next) => {
    try {
        const { listings: items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            throw (0, errorHandler_1.createError)('listings array is required and must not be empty', 400);
        }
        if (items.length > 50) {
            throw (0, errorHandler_1.createError)('Cannot create more than 50 listings in a single bulk request', 400);
        }
        const validationError = validateBulkItems(items);
        if (validationError)
            throw (0, errorHandler_1.createError)(validationError, 400);
        const adminId = req.user.userId;
        const created = await prisma_1.prisma.$transaction(items.map((item) => prisma_1.prisma.listing.create({ data: buildBulkListingData(item, adminId, []) })));
        res.status(201).json({ created: created.length, listings: created });
    }
    catch (err) {
        next(err);
    }
});
// ─── Admin Bulk Listing Creation with Images ───────────────────────────────────
// POST /admin/listings/bulk-media
// Accepts multipart/form-data:
//   listings  — JSON string: Array<BulkListingItem> (see interface above —
//               same shape accepted by POST /listings, including the
//               category-specific motorDetails/propertyDetails/jobDetails
//               blocks, productOptions, and optional latitude/longitude)
//   images_0  — files for listing[0]
//   images_1  — files for listing[1]
//   ...
// stored in the S3 bucket under {COUNTRY}/{categorySlug}/ for organisation.
const bulkListingStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaTempDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `blk-${(0, uuid_1.v4)()}${ext}`);
    },
});
const bulkListingUpload = (0, multer_1.default)({
    storage: bulkListingStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            cb(new Error('Only JPEG, PNG, GIF and WEBP images are allowed'));
            return;
        }
        cb(null, true);
    },
});
router.post('/listings/bulk-media', (req, res, next) => {
    bulkListingUpload.any()(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError)
            return next((0, errorHandler_1.createError)(err.message, 400));
        if (err)
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        next();
    });
}, async (req, res, next) => {
    try {
        const rawListings = req.body?.listings;
        if (!rawListings)
            throw (0, errorHandler_1.createError)('listings field (JSON string) is required', 400);
        let items;
        try {
            items = JSON.parse(rawListings);
        }
        catch {
            throw (0, errorHandler_1.createError)('listings must be a valid JSON string', 400);
        }
        if (!Array.isArray(items) || items.length === 0) {
            throw (0, errorHandler_1.createError)('listings array is required and must not be empty', 400);
        }
        if (items.length > 50) {
            throw (0, errorHandler_1.createError)('Cannot create more than 50 listings in a single bulk request', 400);
        }
        const validationError = validateBulkItems(items);
        if (validationError)
            throw (0, errorHandler_1.createError)(validationError, 400);
        const adminId = req.user.userId;
        const uploadedFiles = req.files || [];
        // Build a map: fieldName → files (e.g. images_0 → [file, file, ...])
        const filesByIndex = new Map();
        for (const f of uploadedFiles) {
            const match = f.fieldname.match(/^images_(\d+)$/);
            if (match) {
                const idx = parseInt(match[1], 10);
                if (!filesByIndex.has(idx))
                    filesByIndex.set(idx, []);
                filesByIndex.get(idx).push(f);
            }
        }
        // Resolve category slugs for folder organisation (batch lookup)
        const categoryIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))];
        const categoryRecords = await prisma_1.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, slug: true },
        });
        const categorySlugMap = new Map(categoryRecords.map((c) => [c.id, c.slug]));
        // Process images for each listing item. Upload failures (S3 outage,
        // misconfigured credentials, local-disk permission/space issues on
        // the host, etc.) are translated into a clear, actionable 400 here —
        // left unguarded, a raw filesystem/SDK error would otherwise surface
        // to the admin as an opaque "Internal Server Error" with no
        // indication of which row or file caused it.
        const imageUrlsByIndex = await Promise.all(items.map(async (item, idx) => {
            const files = filesByIndex.get(idx) || [];
            if (files.length === 0)
                return [];
            const country = (item.country || 'UGANDA').toUpperCase().replace(/[^A-Z0-9_]/g, '');
            const catSlug = item.categorySlug || categorySlugMap.get(item.categoryId) || 'general';
            const folder = `${country}/${catSlug}`;
            const urls = [];
            for (const f of files) {
                const tempPath = path_1.default.join(mediaTempDir, f.filename);
                let cdnUrl;
                try {
                    cdnUrl = await (0, cdn_1.uploadToCDN)(tempPath, f.filename, folder);
                    urls.push(cdnUrl);
                }
                catch (uploadErr) {
                    logger_1.logger.error(`Bulk image upload failed for row ${idx + 1} (${f.originalname}):`, uploadErr);
                    throw (0, errorHandler_1.createError)(`Row ${idx + 1}: failed to upload image "${f.originalname}". Please try again, or remove the image and retry.`, 502);
                }
                finally {
                    try {
                        fs_1.default.unlinkSync(tempPath);
                    }
                    catch { /* best-effort */ }
                }
            }
            return urls;
        }));
        // Create listings in a single transaction. Uses the same field-mapping
        // as the JSON-only endpoint above (via buildBulkListingData) so images
        // are the only thing that differs between the two bulk-post paths.
        const created = await prisma_1.prisma.$transaction(items.map((item, idx) => prisma_1.prisma.listing.create({
            data: buildBulkListingData(item, adminId, imageUrlsByIndex[idx] ?? []),
        })));
        res.status(201).json({ created: created.length, listings: created });
    }
    catch (err) {
        next(err);
    }
});
// ─── Categories ────────────────────────────────────────────────────────────────
// Countries the marketplace operates in (mirrors SECTION_COUNT_COUNTRIES
// further down this file). Used to flag categories that are under-stocked
// in a given country and to scope the populate action below.
const CATEGORY_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];
// Below this many ACTIVE listings (for the selected country), a category is
// flagged as low-inventory in the admin UI.
const LOW_INVENTORY_THRESHOLD = 20;
router.get('/categories', async (_req, res, next) => {
    try {
        const categories = await prisma_1.prisma.category.findMany({
            include: { _count: { select: { listings: true } } },
            orderBy: { name: 'asc' },
        });
        // Per-country ACTIVE listing counts for each category, so the admin UI
        // can flag categories with fewer than LOW_INVENTORY_THRESHOLD active
        // listings in the currently selected country.
        const countryCountsByCategory = await Promise.all(categories.map(async (cat) => {
            const perCountry = await Promise.all(CATEGORY_COUNTRIES.map(async (country) => {
                const count = await prisma_1.prisma.listing.count({
                    where: { categoryId: cat.id, country, status: 'ACTIVE' },
                });
                return [country, count];
            }));
            return [cat.id, Object.fromEntries(perCountry)];
        }));
        const countryCountsMap = Object.fromEntries(countryCountsByCategory);
        res.json(categories.map((cat) => ({ ...cat, countryCounts: countryCountsMap[cat.id] })));
    }
    catch (err) {
        next(err);
    }
});
router.post('/categories', async (req, res, next) => {
    try {
        const { name, slug, icon, parentId, fieldSchema } = req.body;
        if (!name || !slug) {
            throw (0, errorHandler_1.createError)('Name and slug are required', 400);
        }
        const category = await prisma_1.prisma.category.create({
            data: {
                name,
                slug,
                ...(icon && { icon }),
                ...(parentId && { parentId }),
                ...(fieldSchema !== undefined && { fieldSchema }),
            },
        });
        res.status(201).json(category);
    }
    catch (err) {
        next(err);
    }
});
router.put('/categories/:id', async (req, res, next) => {
    try {
        const { name, slug, icon, parentId, fieldSchema } = req.body;
        const category = await prisma_1.prisma.category.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(slug && { slug }),
                ...(icon !== undefined && { icon }),
                ...(parentId !== undefined && { parentId }),
                ...(fieldSchema !== undefined && { fieldSchema }),
            },
        });
        res.json(category);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/categories/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.category.delete({ where: { id: req.params.id } });
        res.json({ message: 'Category deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
// POST /admin/categories/:id/populate — bring a category's ACTIVE listing
// count for one country up toward LOW_INVENTORY_THRESHOLD (20) by activating
// real listings that were already uploaded into this category (categoryId
// set by the seller at upload time) for that country, but are currently
// marked "No placements" (placement: NONE) and not yet ACTIVE. Never
// fabricates listings — only genuine, existing inventory is used, mirroring
// the honesty rule already applied by /section-counts/auto-fill below.
router.post('/categories/:id/populate', async (req, res, next) => {
    try {
        const { country } = req.body;
        if (!country || !CATEGORY_COUNTRIES.includes(country)) {
            return next((0, errorHandler_1.createError)(`country must be one of: ${CATEGORY_COUNTRIES.join(', ')}`, 400));
        }
        const countryTyped = country;
        const category = await prisma_1.prisma.category.findUnique({ where: { id: req.params.id } });
        if (!category)
            throw (0, errorHandler_1.createError)('Category not found', 404);
        const currentCount = await prisma_1.prisma.listing.count({
            where: { categoryId: category.id, country: countryTyped, status: 'ACTIVE' },
        });
        const needed = Math.max(0, LOW_INVENTORY_THRESHOLD - currentCount);
        if (needed === 0) {
            return res.json({
                updated: 0,
                newCount: currentCount,
                message: `"${category.name}" already has ${LOW_INVENTORY_THRESHOLD} or more active listings in ${country} — no changes made.`,
            });
        }
        // Candidates: real listings already assigned to this category at upload,
        // for the selected country, currently unplaced and not yet live.
        const candidates = await prisma_1.prisma.listing.findMany({
            where: {
                categoryId: category.id,
                country: countryTyped,
                placement: 'NONE',
                status: { not: 'ACTIVE' },
            },
            orderBy: { createdAt: 'desc' },
            take: needed,
            select: { id: true },
        });
        if (candidates.length === 0) {
            return res.json({
                updated: 0,
                newCount: currentCount,
                message: `No unplaced listings available for "${category.name}" in ${country} to populate with.`,
            });
        }
        await prisma_1.prisma.listing.updateMany({
            where: { id: { in: candidates.map((c) => c.id) } },
            data: { status: 'ACTIVE' },
        });
        res.json({ updated: candidates.length, newCount: currentCount + candidates.length });
    }
    catch (err) {
        next(err);
    }
});
// ─── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', async (_req, res, next) => {
    try {
        const reports = await prisma_1.prisma.report.findMany({
            include: {
                reporter: { select: { id: true, name: true, email: true } },
                listing: { select: { id: true, title: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(reports);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/reports/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.report.delete({ where: { id: req.params.id } });
        res.json({ message: 'Report dismissed successfully' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Settings ──────────────────────────────────────────────────────────────────
// Persisted in SiteConfig.generalSettings (a JSON blob) rather than kept in a
// plain in-memory variable, which previously reset on every server
// restart/redeploy and was inconsistent across multiple server instances —
// making saves here appear to silently fail.
router.get('/settings', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        const stored = config.generalSettings || {};
        res.json({ ...defaultSettings, ...stored });
    }
    catch (err) {
        next(err);
    }
});
router.put('/settings', async (req, res, next) => {
    try {
        const allowedKeys = Object.keys(defaultSettings);
        const config = await getSiteConfig();
        const current = (config.generalSettings || {});
        const merged = { ...defaultSettings, ...current };
        for (const key of Object.keys(req.body)) {
            if (allowedKeys.includes(key)) {
                merged[key] = req.body[key];
            }
        }
        const updated = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, generalSettings: merged },
            update: { generalSettings: merged },
        });
        res.json({ ...defaultSettings, ...updated.generalSettings });
    }
    catch (err) {
        next(err);
    }
});
// ─── Site Config (WhatsApp number, Today's Deals, header theme) ───────────────
const SITE_CONFIG_ID = 'global';
async function getSiteConfig() {
    return prisma_1.prisma.siteConfig.upsert({
        where: { id: SITE_CONFIG_ID },
        create: { id: SITE_CONFIG_ID },
        update: {},
    });
}
router.get('/site-config', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        res.json(config);
    }
    catch (err) {
        next(err);
    }
});
router.put('/site-config/whatsapp', async (req, res, next) => {
    try {
        const { whatsappNumber } = req.body;
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, whatsappNumber: whatsappNumber || null },
            update: { whatsappNumber: whatsappNumber || null },
        });
        res.json({ whatsappNumber: config.whatsappNumber });
    }
    catch (err) {
        next(err);
    }
});
router.put('/site-config/header-theme', async (req, res, next) => {
    try {
        const { headerTheme } = req.body;
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, headerTheme: headerTheme || null },
            update: { headerTheme: headerTheme || null },
        });
        res.json({ headerTheme: config.headerTheme });
    }
    catch (err) {
        next(err);
    }
});
// ─── Payment Gateway (admin-only) ───────────────────────────────────────────────
// Card and Bank Transfer were removed as buyer-facing payment methods —
// every non-admin user is put in touch with the seller directly instead
// (see ContactSellerModal on the frontend). This just configures the two
// channels left for the admin-only /checkout flow. This whole admin.ts
// router already requires authenticate + authorize('ADMIN') (see the
// router.use(...) near the top of this file), so these two routes are
// inherently admin-only like everything else here.
const defaultPaymentSettings = {
    mobileMoneyEnabled: true,
    mobileMoneyNumber: '',
    mobileMoneyInstructions: 'Send payment to this number (M-Pesa / MTN / Airtel) and include your order number in the reference.',
    codEnabled: true,
};
router.get('/payment-settings', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        const stored = config.paymentSettings || {};
        res.json({ ...defaultPaymentSettings, ...stored });
    }
    catch (err) {
        next(err);
    }
});
router.put('/payment-settings', async (req, res, next) => {
    try {
        const allowedKeys = Object.keys(defaultPaymentSettings);
        const config = await getSiteConfig();
        const current = (config.paymentSettings || {});
        const merged = { ...defaultPaymentSettings, ...current };
        for (const key of Object.keys(req.body)) {
            if (allowedKeys.includes(key)) {
                merged[key] = req.body[key];
            }
        }
        const updated = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, paymentSettings: merged },
            update: { paymentSettings: merged },
        });
        res.json({ ...defaultPaymentSettings, ...updated.paymentSettings });
    }
    catch (err) {
        next(err);
    }
});
// ─── Enabled Countries (storefront country switcher) ───────────────────────────
// Controls which countries appear in the public country switcher, welcome
// modal, and /country/* pages. Launch scope is Uganda-only; UAE/Kenya/China
// stay fully built in the codebase and can be turned on here later without a
// deploy. At least one country must stay enabled — an empty storefront with
// no selectable country isn't a valid state.
const ALL_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];
router.put('/site-config/enabled-countries', async (req, res, next) => {
    try {
        const { enabledCountries } = req.body;
        if (!Array.isArray(enabledCountries) || enabledCountries.length === 0) {
            return next((0, errorHandler_1.createError)('enabledCountries must be a non-empty array', 400));
        }
        const invalid = enabledCountries.filter((c) => !ALL_COUNTRIES.includes(c));
        if (invalid.length > 0) {
            return next((0, errorHandler_1.createError)(`Invalid countries: ${invalid.join(', ')}`, 400));
        }
        const deduped = Array.from(new Set(enabledCountries));
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, enabledCountries: deduped },
            update: { enabledCountries: deduped },
        });
        res.json({ enabledCountries: config.enabledCountries });
    }
    catch (err) {
        next(err);
    }
});
// Today's Deals CRUD
router.get('/site-config/deals', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        res.json({ deals: config.todaysDeals || [] });
    }
    catch (err) {
        next(err);
    }
});
router.put('/site-config/deals', async (req, res, next) => {
    try {
        const { deals } = req.body;
        if (!Array.isArray(deals))
            return next((0, errorHandler_1.createError)('deals must be an array', 400));
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, todaysDeals: deals },
            update: { todaysDeals: deals },
        });
        res.json({ deals: config.todaysDeals || [] });
    }
    catch (err) {
        next(err);
    }
});
const DEFAULT_BLOG_POPUP = {
    enabled: false,
    intervalSeconds: 60,
    postId: null,
};
const MIN_BLOG_POPUP_INTERVAL_SECONDS = 10;
router.get('/site-config/blog-popup', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        const stored = config.blogPopup || {};
        res.json({ ...DEFAULT_BLOG_POPUP, ...stored });
    }
    catch (err) {
        next(err);
    }
});
router.put('/site-config/blog-popup', async (req, res, next) => {
    try {
        const { enabled, intervalSeconds, postId } = req.body;
        if (enabled !== undefined && typeof enabled !== 'boolean') {
            return next((0, errorHandler_1.createError)('enabled must be a boolean', 400));
        }
        if (intervalSeconds !== undefined) {
            if (typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds) || intervalSeconds < MIN_BLOG_POPUP_INTERVAL_SECONDS) {
                return next((0, errorHandler_1.createError)(`intervalSeconds must be a number of at least ${MIN_BLOG_POPUP_INTERVAL_SECONDS}`, 400));
            }
        }
        if (postId !== undefined && postId !== null) {
            const post = await prisma_1.prisma.blogPost.findUnique({ where: { id: postId } });
            if (!post)
                return next((0, errorHandler_1.createError)('No blog post found with that id', 400));
        }
        const config = await getSiteConfig();
        const current = { ...DEFAULT_BLOG_POPUP, ...(config.blogPopup || {}) };
        const merged = {
            enabled: enabled !== undefined ? enabled : current.enabled,
            intervalSeconds: intervalSeconds !== undefined ? intervalSeconds : current.intervalSeconds,
            postId: postId !== undefined ? postId : current.postId,
        };
        const updated = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, blogPopup: merged },
            update: { blogPopup: merged },
        });
        res.json({ ...DEFAULT_BLOG_POPUP, ...updated.blogPopup });
    }
    catch (err) {
        next(err);
    }
});
// ─── Homepage Row Fill Status (< 6 items detection + auto-fill) ────────────────
// Powers the "Homepage Row Fill Status" panel in /admin/settings and the
// low-item warning banner on the admin dashboard. Six homepage rows are
// tracked per country: FLASH_SALE, LATEST_COLLECTIONS and FEATURED_DEAL are
// placement-driven (a listing is explicitly assigned into that slot), while
// OTHER_COLLECTIONS and the four Recent-Across-Categories sub-rows
// (motors/electronics/property/fashion) reflect organic, real marketplace
// inventory rather than a placement — there is no honest way to "auto-fill"
// those without fabricating fake listings, so auto-fill is only offered for
// the three placement-driven rows and Today's Deals (which can legitimately
// pull in real, currently-unfeatured listings as deals).
const SECTION_COUNT_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];
const RECENT_CATEGORY_SLUGS = ['motors', 'electronics', 'property', 'fashion'];
const ROW_TARGET = 6;
router.get('/section-counts', async (_req, res, next) => {
    try {
        const now = new Date();
        const config = await getSiteConfig();
        const allDeals = (config.todaysDeals || []);
        const sections = {
            FLASH_SALE: {},
            LATEST_COLLECTIONS: {},
            FEATURED_DEAL: {},
            OTHER_COLLECTIONS: {},
            TODAYS_DEALS: {},
            RECENT_MOTORS: {},
            RECENT_ELECTRONICS: {},
            RECENT_PROPERTY: {},
            RECENT_FASHION: {},
        };
        for (const country of SECTION_COUNT_COUNTRIES) {
            const placementWhereBase = { status: 'ACTIVE', country: country, placementExpiresAt: { gt: now } };
            const [flash, latest, featured, other] = await Promise.all([
                prisma_1.prisma.listing.count({ where: { ...placementWhereBase, placement: 'FLASH_SALE' } }),
                prisma_1.prisma.listing.count({ where: { ...placementWhereBase, placement: 'LATEST_COLLECTIONS' } }),
                prisma_1.prisma.listing.count({ where: { ...placementWhereBase, placement: 'FEATURED_DEAL' } }),
                prisma_1.prisma.listing.count({ where: { status: 'ACTIVE', country: country } }),
            ]);
            sections.FLASH_SALE[country] = flash;
            sections.LATEST_COLLECTIONS[country] = latest;
            sections.FEATURED_DEAL[country] = featured;
            sections.OTHER_COLLECTIONS[country] = other;
            // Today's Deals — mirrors the exact visibility rule used by the
            // homepage TodaysDeals component: a deal shows for this country if it
            // has no countries restriction (global) or explicitly lists it, and
            // (if set) has not yet expired.
            sections.TODAYS_DEALS[country] = allDeals.filter((d) => {
                const countryMatch = !d.countries || d.countries.length === 0 || d.countries.includes(country);
                const notExpired = !d.expiresAt || new Date(d.expiresAt) > now;
                return countryMatch && notExpired;
            }).length;
            for (const slug of RECENT_CATEGORY_SLUGS) {
                const count = await prisma_1.prisma.listing.count({
                    where: {
                        status: 'ACTIVE',
                        country: country,
                        OR: [
                            { category: { slug } },
                            { category: { parent: { slug } } },
                        ],
                    },
                });
                sections[`RECENT_${slug.toUpperCase()}`][country] = count;
            }
        }
        res.json({ target: ROW_TARGET, countries: SECTION_COUNT_COUNTRIES, sections });
    }
    catch (err) {
        next(err);
    }
});
// POST /admin/section-counts/auto-fill — bring a placement-driven row (Flash
// Sale, Latest Collections, or Featured Deal) up to 6 items for one country
// by assigning that placement to real, currently-unplaced ACTIVE listings —
// never fabricates listings. Sets a genuine 90-day placementExpiresAt (see
// the fix note on PATCH /listings/:id/placement) so filled listings actually
// appear, rather than silently saving with a null expiry.
router.post('/section-counts/auto-fill', async (req, res, next) => {
    try {
        const { section, country } = req.body;
        const validSections = ['FLASH_SALE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL'];
        if (!section || !validSections.includes(section)) {
            return next((0, errorHandler_1.createError)(`section must be one of: ${validSections.join(', ')}`, 400));
        }
        if (!country || !SECTION_COUNT_COUNTRIES.includes(country)) {
            return next((0, errorHandler_1.createError)(`country must be one of: ${SECTION_COUNT_COUNTRIES.join(', ')}`, 400));
        }
        const now = new Date();
        const placement = section;
        const countryTyped = country;
        const currentCount = await prisma_1.prisma.listing.count({
            where: { status: 'ACTIVE', country: countryTyped, placement, placementExpiresAt: { gt: now } },
        });
        const needed = Math.max(0, ROW_TARGET - currentCount);
        if (needed === 0) {
            return res.json({ updated: 0, newCount: currentCount, message: 'Already has 6 or more items — no changes made.' });
        }
        // Flash Sale has a platform-wide cap of 100 (mirrors the existing cap
        // enforced in PUT /admin/listings/:id and PUT /admin/listings/:id/approve).
        if (placement === 'FLASH_SALE') {
            const totalFlash = await prisma_1.prisma.listing.count({ where: { placement: 'FLASH_SALE' } });
            if (totalFlash >= 100) {
                return next((0, errorHandler_1.createError)('Flash Deals are limited to 100 listings platform-wide. Remove some before auto-filling more.', 400));
            }
        }
        // Pick unplaced ACTIVE listings in this country, most recent first.
        const candidates = await prisma_1.prisma.listing.findMany({
            where: { status: 'ACTIVE', country: countryTyped, placement: 'NONE' },
            orderBy: { createdAt: 'desc' },
            take: needed,
            select: { id: true },
        });
        if (candidates.length === 0) {
            return res.json({
                updated: 0,
                newCount: currentCount,
                message: `No unplaced active listings available in ${country} to auto-fill with.`,
            });
        }
        const placementExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await prisma_1.prisma.listing.updateMany({
            where: { id: { in: candidates.map((c) => c.id) } },
            data: { placement, placementExpiresAt },
        });
        res.json({ updated: candidates.length, newCount: currentCount + candidates.length });
    }
    catch (err) {
        next(err);
    }
});
// ─── Social Links ──────────────────────────────────────────────────────────────
router.get('/social-links', async (_req, res, next) => {
    try {
        const links = await prisma_1.prisma.socialLinks.findUnique({ where: { id: 'global' } });
        res.json(links || { id: 'global', facebook: null, instagram: null, linkedin: null, x: null, whatsapp: null, youtube: null, tiktok: null });
    }
    catch (err) {
        next(err);
    }
});
router.put('/social-links', async (req, res, next) => {
    try {
        const { facebook, instagram, linkedin, x, whatsapp, youtube, tiktok } = req.body;
        const links = await prisma_1.prisma.socialLinks.upsert({
            where: { id: 'global' },
            create: {
                id: 'global',
                facebook: facebook || null,
                instagram: instagram || null,
                linkedin: linkedin || null,
                x: x || null,
                whatsapp: whatsapp || null,
                youtube: youtube || null,
                tiktok: tiktok || null,
            },
            update: {
                facebook: facebook !== undefined ? (facebook || null) : undefined,
                instagram: instagram !== undefined ? (instagram || null) : undefined,
                linkedin: linkedin !== undefined ? (linkedin || null) : undefined,
                x: x !== undefined ? (x || null) : undefined,
                whatsapp: whatsapp !== undefined ? (whatsapp || null) : undefined,
                youtube: youtube !== undefined ? (youtube || null) : undefined,
                tiktok: tiktok !== undefined ? (tiktok || null) : undefined,
            },
        });
        res.json(links);
    }
    catch (err) {
        next(err);
    }
});
// ─── Image Moderation ──────────────────────────────────────────────────────────
router.get('/images', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = (req.query.status || 'PENDING').toUpperCase();
        const sellerId = req.query.sellerId;
        const where = { status };
        if (sellerId)
            where.sellerId = sellerId;
        const [images, total] = await Promise.all([
            prisma_1.prisma.productImage.findMany({
                where,
                include: {
                    seller: { select: { id: true, name: true, email: true } },
                    listing: { select: { id: true, title: true } },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { uploadedAt: 'desc' },
            }),
            prisma_1.prisma.productImage.count({ where }),
        ]);
        const imagesWithUrls = images.map((img) => ({
            ...img,
            previewUrl: img.cdnUrl || (img.tempPath ? `/uploads/temp/${img.tempPath}` : null),
        }));
        res.json({ images: imagesWithUrls, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/images/:id/approve', async (req, res, next) => {
    try {
        const image = await prisma_1.prisma.productImage.findUnique({
            where: { id: req.params.id },
            include: { seller: { select: { name: true, personalId: true } } },
        });
        if (!image)
            throw (0, errorHandler_1.createError)('Image not found', 404);
        if (image.status !== 'PENDING')
            throw (0, errorHandler_1.createError)('Image is not pending review', 400);
        let cdnUrl;
        if (image.cdnUrl) {
            // Just use the existing CDN URL and mark as approved without re-uploading.
            cdnUrl = image.cdnUrl;
        }
        else {
            const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
            if (!fs_1.default.existsSync(tempFilePath)) {
                throw (0, errorHandler_1.createError)('Temporary file not found; it may have already been processed', 404);
            }
            try {
                cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, image.tempPath);
            }
            catch (cdnErr) {
                throw (0, errorHandler_1.createError)(`CDN upload failed: ${cdnErr.message}`, 502);
            }
            // Delete temp file after CDN upload.
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch { /* best-effort */ }
        }
        const updated = await prisma_1.prisma.productImage.update({
            where: { id: req.params.id },
            data: {
                status: 'APPROVED',
                cdnUrl,
                reviewedAt: new Date(),
                reviewedBy: req.user.userId,
            },
        });
        // Update the listing's images array: replace temp preview URL with CDN URL if needed.
        // With the new upload flow the listing already has the CDN URL; avoid duplicating it.
        if (image.listingId) {
            const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
            if (listing) {
                const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
                const hasTempUrl = listing.images.includes(tempPreviewUrl);
                const hasCdnUrl = listing.images.includes(cdnUrl);
                if (hasTempUrl) {
                    // Replace legacy temp URL with CDN URL
                    await prisma_1.prisma.listing.update({
                        where: { id: image.listingId },
                        data: { images: listing.images.map((u) => (u === tempPreviewUrl ? cdnUrl : u)) },
                    });
                }
                else if (!hasCdnUrl) {
                    // CDN URL not yet in listing (edge case) – add it
                    await prisma_1.prisma.listing.update({
                        where: { id: image.listingId },
                        data: { images: [...listing.images, cdnUrl] },
                    });
                }
                // If listing already has the cdnUrl, no update is needed
            }
        }
        res.json(updated);
        // Notify the seller fully asynchronously after the response is flushed.
        const notifyApproved = async () => {
            if (!image.sellerId)
                return;
            const seller = await prisma_1.prisma.user.findUnique({ where: { id: image.sellerId }, select: { email: true, name: true } });
            if (!seller)
                return;
            const listing = image.listingId
                ? await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId }, select: { title: true } })
                : null;
            (0, email_1.sendImageApprovedEmail)(seller.email, seller.name, listing?.title).catch((err) => logger_1.logger.error(`Image approval email failed for ${seller.email}: ${String(err)}`));
        };
        setImmediate(() => { notifyApproved().catch((err) => logger_1.logger.error('notifyApproved error:', String(err))); });
    }
    catch (err) {
        next(err);
    }
});
router.put('/images/:id/reject', async (req, res, next) => {
    try {
        const { reason } = req.body;
        const image = await prisma_1.prisma.productImage.findUnique({ where: { id: req.params.id } });
        if (!image)
            throw (0, errorHandler_1.createError)('Image not found', 404);
        if (image.status !== 'PENDING')
            throw (0, errorHandler_1.createError)('Image is not pending review', 400);
        // Delete temp file.
        const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
        try {
            fs_1.default.unlinkSync(tempFilePath);
        }
        catch { /* best-effort */ }
        const updated = await prisma_1.prisma.productImage.update({
            where: { id: req.params.id },
            data: {
                status: 'REJECTED',
                reviewedAt: new Date(),
                reviewedBy: req.user.userId,
                rejectionReason: reason || null,
            },
        });
        // Remove the image URL(s) from the listing's images array.
        // The image may have been uploaded to CDN already (new flow) or still be a temp URL (legacy).
        if (image.listingId) {
            const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
            if (listing) {
                const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
                const urlsToRemove = new Set([tempPreviewUrl]);
                if (image.cdnUrl)
                    urlsToRemove.add(image.cdnUrl);
                await prisma_1.prisma.listing.update({
                    where: { id: image.listingId },
                    data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
                });
            }
        }
        res.json(updated);
        // Notify the seller fully asynchronously after the response is flushed.
        const notifyRejected = async () => {
            if (!image.sellerId)
                return;
            const seller = await prisma_1.prisma.user.findUnique({ where: { id: image.sellerId }, select: { email: true, name: true } });
            if (!seller)
                return;
            const listing = image.listingId
                ? await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId }, select: { title: true } })
                : null;
            (0, email_1.sendImageRejectedEmail)(seller.email, seller.name, reason || undefined, listing?.title).catch((err) => logger_1.logger.error(`Image rejection email failed for ${seller.email}: ${String(err)}`));
        };
        setImmediate(() => { notifyRejected().catch((err) => logger_1.logger.error('notifyRejected error:', String(err))); });
    }
    catch (err) {
        next(err);
    }
});
router.put('/images/bulk', async (req, res, next) => {
    try {
        const { ids, action, reason } = req.body;
        if (!Array.isArray(ids) || ids.length === 0)
            throw (0, errorHandler_1.createError)('ids array is required', 400);
        if (!['approve', 'reject', 'delete'].includes(action))
            throw (0, errorHandler_1.createError)('action must be approve, reject, or delete', 400);
        const adminUserId = req.user.userId;
        const processOne = async (id) => {
            const image = await prisma_1.prisma.productImage.findUnique({
                where: { id },
                include: { seller: { select: { name: true, personalId: true } } },
            });
            if (!image) {
                return { id, success: false, error: 'Not found' };
            }
            if (action === 'delete') {
                // Remove from listing images array
                if (image.listingId) {
                    const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
                    if (listing) {
                        const tempPreviewUrl = image.tempPath ? `/uploads/temp/${image.tempPath}` : null;
                        const urlsToRemove = new Set();
                        if (tempPreviewUrl)
                            urlsToRemove.add(tempPreviewUrl);
                        if (image.cdnUrl)
                            urlsToRemove.add(image.cdnUrl);
                        await prisma_1.prisma.listing.update({
                            where: { id: image.listingId },
                            data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
                        });
                    }
                }
                // Delete temp file best-effort
                if (image.tempPath) {
                    const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
                    try {
                        fs_1.default.unlinkSync(tempFilePath);
                    }
                    catch { /* best-effort */ }
                }
                await prisma_1.prisma.productImage.delete({ where: { id } });
                return { id, success: true };
            }
            if (image.status !== 'PENDING') {
                return { id, success: false, error: 'Not found or not pending' };
            }
            if (action === 'approve') {
                let cdnUrl;
                if (image.cdnUrl) {
                    // Image already uploaded to CDN during initial upload step; reuse the URL.
                    cdnUrl = image.cdnUrl;
                }
                else {
                    const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
                    if (!fs_1.default.existsSync(tempFilePath)) {
                        return { id, success: false, error: 'Temp file missing' };
                    }
                    cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, image.tempPath);
                    try {
                        fs_1.default.unlinkSync(tempFilePath);
                    }
                    catch { /* best-effort */ }
                }
                await prisma_1.prisma.productImage.update({
                    where: { id },
                    data: { status: 'APPROVED', cdnUrl, reviewedAt: new Date(), reviewedBy: adminUserId },
                });
                if (image.listingId) {
                    const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
                    if (listing) {
                        const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
                        const hasTempUrl = listing.images.includes(tempPreviewUrl);
                        const hasCdnUrl = listing.images.includes(cdnUrl);
                        if (hasTempUrl) {
                            await prisma_1.prisma.listing.update({
                                where: { id: image.listingId },
                                data: { images: listing.images.map((u) => (u === tempPreviewUrl ? cdnUrl : u)) },
                            });
                        }
                        else if (!hasCdnUrl) {
                            await prisma_1.prisma.listing.update({ where: { id: image.listingId }, data: { images: [...listing.images, cdnUrl] } });
                        }
                    }
                }
            }
            else {
                const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
                try {
                    fs_1.default.unlinkSync(tempFilePath);
                }
                catch { /* best-effort */ }
                await prisma_1.prisma.productImage.update({
                    where: { id },
                    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: adminUserId, rejectionReason: reason || null },
                });
                if (image.listingId) {
                    const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
                    if (listing) {
                        const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
                        const urlsToRemove = new Set([tempPreviewUrl]);
                        if (image.cdnUrl)
                            urlsToRemove.add(image.cdnUrl);
                        await prisma_1.prisma.listing.update({
                            where: { id: image.listingId },
                            data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
                        });
                    }
                }
            }
            return { id, success: true };
        };
        const settled = await Promise.allSettled(ids.map(processOne));
        const results = settled.map((s) => s.status === 'fulfilled'
            ? s.value
            : { id: 'unknown', success: false, error: s.reason.message });
        res.json({ results });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/images/:id', async (req, res, next) => {
    try {
        const image = await prisma_1.prisma.productImage.findUnique({ where: { id: req.params.id } });
        if (!image)
            throw (0, errorHandler_1.createError)('Image not found', 404);
        // Remove image URL(s) from the associated listing
        if (image.listingId) {
            const listing = await prisma_1.prisma.listing.findUnique({ where: { id: image.listingId } });
            if (listing) {
                const tempPreviewUrl = image.tempPath ? `/uploads/temp/${image.tempPath}` : null;
                const urlsToRemove = new Set();
                if (tempPreviewUrl)
                    urlsToRemove.add(tempPreviewUrl);
                if (image.cdnUrl)
                    urlsToRemove.add(image.cdnUrl);
                await prisma_1.prisma.listing.update({
                    where: { id: image.listingId },
                    data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
                });
            }
        }
        // Delete the temp file best-effort
        if (image.tempPath) {
            const tempFilePath = path_1.default.join(process.cwd(), 'uploads', 'temp', image.tempPath);
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch { /* best-effort */ }
        }
        await prisma_1.prisma.productImage.delete({ where: { id: req.params.id } });
        res.json({ message: 'Image deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Review Moderation ─────────────────────────────────────────────────────────
router.get('/reviews', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = (req.query.status || 'PENDING').toUpperCase();
        const where = { status };
        const [reviews, total] = await Promise.all([
            prisma_1.prisma.productReview.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    listing: { select: { id: true, title: true } },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.productReview.count({ where }),
        ]);
        res.json({ reviews, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/reviews/:id/approve', async (req, res, next) => {
    try {
        const review = await prisma_1.prisma.productReview.findUnique({ where: { id: req.params.id } });
        if (!review)
            throw (0, errorHandler_1.createError)('Review not found', 404);
        if (review.status !== 'PENDING')
            throw (0, errorHandler_1.createError)('Review is not pending', 400);
        const updated = await prisma_1.prisma.productReview.update({
            where: { id: req.params.id },
            data: { status: 'APPROVED', rejectionReason: null },
            include: {
                user: { select: { id: true, name: true, email: true } },
                listing: { select: { id: true, title: true } },
            },
        });
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
router.put('/reviews/:id/reject', async (req, res, next) => {
    try {
        const { reason } = req.body;
        const review = await prisma_1.prisma.productReview.findUnique({ where: { id: req.params.id } });
        if (!review)
            throw (0, errorHandler_1.createError)('Review not found', 404);
        if (review.status !== 'PENDING')
            throw (0, errorHandler_1.createError)('Review is not pending', 400);
        const updated = await prisma_1.prisma.productReview.update({
            where: { id: req.params.id },
            data: { status: 'REJECTED', rejectionReason: reason || null },
            include: {
                user: { select: { id: true, name: true, email: true } },
                listing: { select: { id: true, title: true } },
            },
        });
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
// ─── Orders Management ─────────────────────────────────────────────────────────
router.get('/orders', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = req.query.status;
        const where = { ...(status && { status }) };
        const [orders, total] = await Promise.all([
            prisma_1.prisma.order.findMany({
                where,
                include: {
                    buyer: { select: { id: true, name: true, email: true } },
                    seller: { select: { id: true, name: true, email: true } },
                    items: { include: { listing: { select: { id: true, title: true } } } },
                    payment: { select: { status: true, method: true, amount: true } },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.order.count({ where }),
        ]);
        res.json({ orders, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/orders/:id/status', async (req, res, next) => {
    try {
        const { status, trackingNumber, cancellationNote } = req.body;
        if (!status)
            return next((0, errorHandler_1.createError)('status is required', 400));
        const order = await prisma_1.prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order)
            return next((0, errorHandler_1.createError)('Order not found', 404));
        const updateData = { status };
        if (trackingNumber)
            updateData.trackingNumber = trackingNumber;
        if (status === 'SHIPPED')
            updateData.shippedAt = new Date();
        if (status === 'DELIVERED') {
            updateData.deliveredAt = new Date();
            const sellerShare = order.total - order.shippingCost;
            await prisma_1.prisma.user.update({ where: { id: order.sellerId }, data: { balance: { increment: sellerShare } } });
            await prisma_1.prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: 'COMPLETED', paidAt: new Date() } });
        }
        if (status === 'CANCELLED') {
            updateData.cancelledAt = new Date();
            if (cancellationNote)
                updateData.cancellationNote = cancellationNote;
        }
        const updated = await prisma_1.prisma.order.update({
            where: { id: req.params.id },
            data: updateData,
        });
        res.json({ order: updated });
    }
    catch (err) {
        next(err);
    }
});
// ─── Returns Management ────────────────────────────────────────────────────────
router.get('/returns', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = req.query.status;
        const where = { ...(status && { status }) };
        const [returns, total] = await Promise.all([
            prisma_1.prisma.return.findMany({
                where,
                include: {
                    buyer: { select: { id: true, name: true, email: true } },
                    order: { select: { id: true, orderNumber: true, total: true } },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.return.count({ where }),
        ]);
        res.json({ returns, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/returns/:id', async (req, res, next) => {
    try {
        const { status, resolution } = req.body;
        if (!status)
            return next((0, errorHandler_1.createError)('status is required', 400));
        const ret = await prisma_1.prisma.return.findUnique({ where: { id: req.params.id } });
        if (!ret)
            return next((0, errorHandler_1.createError)('Return not found', 404));
        const updated = await prisma_1.prisma.return.update({
            where: { id: req.params.id },
            data: {
                status,
                ...(resolution && { resolution }),
                ...(['APPROVED', 'REJECTED', 'REFUNDED'].includes(status) && { resolvedAt: new Date() }),
            },
        });
        // Notify buyer
        const order = await prisma_1.prisma.order.findUnique({ where: { id: ret.orderId } });
        if (order) {
            const notifType = status === 'APPROVED' ? 'RETURN_APPROVED' : status === 'REJECTED' ? 'RETURN_REJECTED' : undefined;
            if (notifType) {
                await prisma_1.prisma.notification.create({
                    data: {
                        userId: ret.buyerId,
                        type: notifType,
                        title: `Return ${status.toLowerCase()}`,
                        message: `Your return request for order ${order.orderNumber} has been ${status.toLowerCase()}.`,
                        data: { orderId: order.id, returnId: ret.id },
                    },
                });
            }
        }
        res.json({ return: updated });
    }
    catch (err) {
        next(err);
    }
});
// ─── Coupons Management ────────────────────────────────────────────────────────
router.get('/coupons', async (_req, res, next) => {
    try {
        const coupons = await prisma_1.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
        res.json({ coupons });
    }
    catch (err) {
        next(err);
    }
});
router.post('/coupons', async (req, res, next) => {
    try {
        const { code, type, value, minOrderAmount, maxUses, isActive, expiresAt } = req.body;
        if (!code || !type || value == null)
            return next((0, errorHandler_1.createError)('code, type, and value are required', 400));
        const existing = await prisma_1.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
        if (existing)
            return next((0, errorHandler_1.createError)('Coupon code already exists', 400));
        const coupon = await prisma_1.prisma.coupon.create({
            data: {
                code: code.trim().toUpperCase(),
                type,
                value: parseFloat(value),
                ...(minOrderAmount != null && { minOrderAmount: parseFloat(minOrderAmount) }),
                ...(maxUses != null && { maxUses: parseInt(maxUses) }),
                ...(isActive !== undefined && { isActive }),
                ...(expiresAt && { expiresAt: new Date(expiresAt) }),
            },
        });
        res.status(201).json({ coupon });
    }
    catch (err) {
        next(err);
    }
});
router.put('/coupons/:id', async (req, res, next) => {
    try {
        const { type, value, minOrderAmount, maxUses, isActive, expiresAt } = req.body;
        const coupon = await prisma_1.prisma.coupon.update({
            where: { id: req.params.id },
            data: {
                ...(type && { type }),
                ...(value != null && { value: parseFloat(value) }),
                ...(minOrderAmount !== undefined && { minOrderAmount: minOrderAmount ? parseFloat(minOrderAmount) : null }),
                ...(maxUses !== undefined && { maxUses: maxUses ? parseInt(maxUses) : null }),
                ...(isActive !== undefined && { isActive }),
                ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
            },
        });
        res.json({ coupon });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/coupons/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.coupon.delete({ where: { id: req.params.id } });
        res.json({ message: 'Coupon deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Withdrawals Management ────────────────────────────────────────────────────
router.get('/withdrawals', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '20'));
        const status = req.query.status;
        const where = { ...(status && { status }) };
        const [withdrawals, total] = await Promise.all([
            prisma_1.prisma.withdrawal.findMany({
                where,
                include: { user: { select: { id: true, name: true, email: true } } },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.withdrawal.count({ where }),
        ]);
        res.json({ withdrawals, pagination: { total, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/withdrawals/:id', async (req, res, next) => {
    try {
        const { status, note } = req.body;
        if (!status)
            return next((0, errorHandler_1.createError)('status is required', 400));
        const w = await prisma_1.prisma.withdrawal.findUnique({ where: { id: req.params.id } });
        if (!w)
            return next((0, errorHandler_1.createError)('Withdrawal not found', 404));
        const updated = await prisma_1.prisma.withdrawal.update({
            where: { id: req.params.id },
            data: {
                status,
                ...(note && { note }),
                ...(['COMPLETED', 'APPROVED'].includes(status) && { processedAt: new Date() }),
            },
        });
        // If rejected, refund balance to user
        if (status === 'REJECTED') {
            await prisma_1.prisma.user.update({ where: { id: w.userId }, data: { balance: { increment: w.amount } } });
        }
        // Notify seller
        const notifType = status === 'APPROVED' || status === 'COMPLETED' ? 'WITHDRAWAL_APPROVED' : status === 'REJECTED' ? 'WITHDRAWAL_REJECTED' : undefined;
        if (notifType) {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: w.userId,
                    type: notifType,
                    title: `Withdrawal ${status.toLowerCase()}`,
                    message: `Your withdrawal request of ${w.amount} ${w.currency} has been ${status.toLowerCase()}.`,
                    data: { withdrawalId: w.id },
                },
            });
        }
        res.json({ withdrawal: updated });
    }
    catch (err) {
        next(err);
    }
});
// ─── Shipping Rates Management ─────────────────────────────────────────────────
router.get('/shipping-rates', async (_req, res, next) => {
    try {
        const rates = await prisma_1.prisma.shippingRate.findMany({ orderBy: { createdAt: 'desc' } });
        res.json({ rates });
    }
    catch (err) {
        next(err);
    }
});
router.post('/shipping-rates', async (req, res, next) => {
    try {
        const { name, description, country, minDays, maxDays, priceAed, priceUgx, priceKes, priceCny, isActive } = req.body;
        if (!name || !country || minDays == null || maxDays == null) {
            return next((0, errorHandler_1.createError)('name, country, minDays, and maxDays are required', 400));
        }
        const rate = await prisma_1.prisma.shippingRate.create({
            data: {
                name,
                description,
                country,
                minDays: parseInt(minDays),
                maxDays: parseInt(maxDays),
                priceAed: parseFloat(priceAed || 0),
                priceUgx: parseFloat(priceUgx || 0),
                priceKes: parseFloat(priceKes || 0),
                priceCny: parseFloat(priceCny || 0),
                ...(isActive !== undefined && { isActive }),
            },
        });
        res.status(201).json({ rate });
    }
    catch (err) {
        next(err);
    }
});
router.put('/shipping-rates/:id', async (req, res, next) => {
    try {
        const { name, description, minDays, maxDays, priceAed, priceUgx, priceKes, priceCny, isActive } = req.body;
        const rate = await prisma_1.prisma.shippingRate.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(minDays != null && { minDays: parseInt(minDays) }),
                ...(maxDays != null && { maxDays: parseInt(maxDays) }),
                ...(priceAed != null && { priceAed: parseFloat(priceAed) }),
                ...(priceUgx != null && { priceUgx: parseFloat(priceUgx) }),
                ...(priceKes != null && { priceKes: parseFloat(priceKes) }),
                ...(priceCny != null && { priceCny: parseFloat(priceCny) }),
                ...(isActive !== undefined && { isActive }),
            },
        });
        res.json({ rate });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/shipping-rates/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.shippingRate.delete({ where: { id: req.params.id } });
        res.json({ message: 'Shipping rate deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── Seller Packages Management ───────────────────────────────────────────────
router.get('/packages', async (_req, res, next) => {
    try {
        const scope = parseScope(_req.query.scope);
        const packages = await prisma_1.prisma.sellerPackage.findMany({
            where: { scope },
            orderBy: [{ isFree: 'desc' }, { price: 'asc' }],
            include: { _count: { select: { subscriptions: true } } },
        });
        res.json({ packages });
    }
    catch (err) {
        next(err);
    }
});
// CV-scope packages have no subscription step — the builder always defers to
// a single, currently-governing package. So whenever the admin activates a
// CV package it "overwrites" (i.e. deactivates) any other active CV package,
// rather than letting several compete. Once the admin deactivates/deletes
// all of them, routes/cvPayment.ts falls back to the hard-coded default price.
async function deactivateOtherActiveCvPackages(keepId) {
    await prisma_1.prisma.sellerPackage.updateMany({
        where: { scope: 'CV', isActive: true, ...(keepId ? { id: { not: keepId } } : {}) },
        data: { isActive: false },
    });
}
router.post('/packages', async (req, res, next) => {
    try {
        const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive } = req.body;
        const scope = parseScope(scopeInput);
        if (!name)
            throw (0, errorHandler_1.createError)('name is required', 400);
        if (!durationDays || durationDays < 1)
            throw (0, errorHandler_1.createError)('durationDays must be at least 1', 400);
        const willBeActive = isActive !== false;
        const pkg = await prisma_1.prisma.sellerPackage.create({
            data: {
                name,
                description: description ?? null,
                scope,
                isFree: Boolean(isFree),
                price: isFree ? 0 : parseFloat(price) || 0,
                currency: currency ?? 'UGX',
                durationDays: parseInt(durationDays),
                maxListings: maxListings ? parseInt(maxListings) : null,
                isActive: willBeActive,
            },
        });
        if (scope === 'CV' && willBeActive) {
            await deactivateOtherActiveCvPackages(pkg.id);
        }
        res.status(201).json({ package: pkg });
    }
    catch (err) {
        next(err);
    }
});
router.put('/packages/:id', async (req, res, next) => {
    try {
        const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive } = req.body;
        const scope = scopeInput !== undefined ? parseScope(scopeInput) : undefined;
        const pkg = await prisma_1.prisma.sellerPackage.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(scope !== undefined && { scope }),
                ...(isFree !== undefined && { isFree: Boolean(isFree) }),
                ...(price !== undefined && { price: parseFloat(price) }),
                ...(currency !== undefined && { currency }),
                ...(durationDays !== undefined && { durationDays: parseInt(durationDays) }),
                ...(maxListings !== undefined && { maxListings: maxListings ? parseInt(maxListings) : null }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
            },
        });
        if (pkg.scope === 'CV' && pkg.isActive) {
            await deactivateOtherActiveCvPackages(pkg.id);
        }
        res.json({ package: pkg });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/packages/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.sellerPackage.delete({ where: { id: req.params.id } });
        res.json({ message: 'Package deleted' });
    }
    catch (err) {
        next(err);
    }
});
// ─── CV History ───────────────────────────────────────────────────────────────
// Every time a visitor initiates a CV download (free or paid) via the builder,
// a CvDownloadToken row is created with a snapshot of their core details. This
// lists that history for the admin dashboard.
router.get('/cv-history', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page || '1');
        const limit = parseInt(req.query.limit || '20');
        const status = req.query.status; // 'paid' | 'unpaid' | 'free'
        const search = req.query.search?.trim();
        const where = {
            ...(status === 'paid' ? { paid: true, amount: { gt: 0 } } : {}),
            ...(status === 'unpaid' ? { paid: false } : {}),
            ...(status === 'free' ? { amount: 0 } : {}),
            ...(search ? {
                OR: [
                    { holderName: { contains: search, mode: 'insensitive' } },
                    { holderEmail: { contains: search, mode: 'insensitive' } },
                    { holderTitle: { contains: search, mode: 'insensitive' } },
                    { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
                ],
            } : {}),
        };
        const [total, entries] = await Promise.all([
            prisma_1.prisma.cvDownloadToken.count({ where }),
            prisma_1.prisma.cvDownloadToken.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    package: { select: { id: true, name: true, isFree: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        const [totalCount, paidCount, freeCount, downloadedCount] = await Promise.all([
            prisma_1.prisma.cvDownloadToken.count(),
            prisma_1.prisma.cvDownloadToken.count({ where: { paid: true, amount: { gt: 0 } } }),
            prisma_1.prisma.cvDownloadToken.count({ where: { amount: 0, paid: true } }),
            prisma_1.prisma.cvDownloadToken.count({ where: { usedAt: { not: null } } }),
        ]);
        res.json({
            entries,
            total,
            page,
            pages: Math.ceil(total / limit),
            stats: { total: totalCount, paid: paidCount, free: freeCount, downloaded: downloadedCount },
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Seller Subscriptions Management ─────────────────────────────────────────
router.get('/subscriptions', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page || '1');
        const limit = parseInt(req.query.limit || '20');
        const status = req.query.status;
        const scope = parseScope(req.query.scope);
        // Expire any overdue subscriptions first
        await prisma_1.prisma.sellerSubscription.updateMany({
            where: { status: 'ACTIVE', endDate: { lt: new Date() } },
            data: { status: 'EXPIRED' },
        });
        const where = {
            ...(status ? { status: status } : {}),
            package: { scope },
        };
        const [total, subscriptions] = await Promise.all([
            prisma_1.prisma.sellerSubscription.count({ where }),
            prisma_1.prisma.sellerSubscription.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true, personalId: true } },
                    package: { select: { id: true, name: true, scope: true, isFree: true, price: true, currency: true, durationDays: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        res.json({ subscriptions, total, page, pages: Math.ceil(total / limit) });
    }
    catch (err) {
        next(err);
    }
});
router.put('/subscriptions/:id', async (req, res, next) => {
    try {
        const { status, endDate } = req.body;
        const allowedStatuses = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'];
        if (status && !allowedStatuses.includes(status)) {
            throw (0, errorHandler_1.createError)('Invalid status', 400);
        }
        const sub = await prisma_1.prisma.sellerSubscription.update({
            where: { id: req.params.id },
            data: {
                ...(status !== undefined && { status }),
                ...(endDate !== undefined && { endDate: new Date(endDate) }),
            },
            include: {
                user: { select: { id: true, name: true, email: true } },
                package: true,
            },
        });
        // Notify the seller about status changes and update verification status
        if (status === 'CANCELLED' || status === 'EXPIRED') {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: sub.userId,
                    type: 'SUBSCRIPTION_EXPIRED',
                    title: 'Subscription Ended',
                    message: `Your "${sub.package.name}" package subscription has been ${status.toLowerCase()}.`,
                    data: { subscriptionId: sub.id },
                },
            });
            // If the cancelled/expired package was paid, revoke verified status unless
            // the user still has another active paid subscription.
            if (!sub.package.isFree) {
                const otherActivePaid = await prisma_1.prisma.sellerSubscription.findFirst({
                    where: {
                        userId: sub.userId,
                        id: { not: sub.id },
                        status: 'ACTIVE',
                        package: { isFree: false },
                    },
                    include: { package: true },
                });
                if (!otherActivePaid) {
                    await prisma_1.prisma.user.update({ where: { id: sub.userId }, data: { isVerified: false } });
                }
            }
        }
        else if (status === 'ACTIVE') {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: sub.userId,
                    type: 'SUBSCRIPTION_ACTIVATED',
                    title: 'Subscription Activated',
                    message: `Your "${sub.package.name}" package has been activated until ${sub.endDate.toLocaleDateString()}.`,
                    data: { subscriptionId: sub.id },
                },
            });
            // Grant verified status when a paid (monthly/yearly) subscription is activated.
            if (!sub.package.isFree) {
                await prisma_1.prisma.user.update({ where: { id: sub.userId }, data: { isVerified: true } });
            }
            // Send subscription activation email (non-blocking)
            (0, email_1.sendSubscriptionActivatedEmail)(sub.user.email, sub.user.name, sub.package.name, sub.endDate)
                .catch((err) => logger_1.logger.error('Failed to send subscription activated email', err));
        }
        res.json({ subscription: sub });
    }
    catch (err) {
        next(err);
    }
});
// ─── Site Media Management ─────────────────────────────────────────────────────
// Admin can bulk-upload images to specific page sections (hero, banner, etc.)
const VALID_MEDIA_SECTIONS = ['hero', 'banner', 'featured', 'flash', 'collection', 'background', 'category', 'sticky-header', 'brand-logo', 'cv-generator'];
// GET /admin/media?section=hero — list site media (optionally filtered by section)
router.get('/media', async (req, res, next) => {
    try {
        const section = req.query.section;
        const where = section ? { section } : {};
        const media = await prisma_1.prisma.siteMedia.findMany({
            where,
            orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
        });
        res.json({ media });
    }
    catch (err) {
        next(err);
    }
});
// POST /admin/media/upload — bulk upload images to a page section
router.post('/media/upload', (req, res, next) => {
    mediaUpload.array('images', 50)(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const { section, altText, linkUrl, title, shortDescription, price, originalPrice, currency, } = req.body;
        if (!section || !VALID_MEDIA_SECTIONS.includes(section)) {
            return next((0, errorHandler_1.createError)(`section must be one of: ${VALID_MEDIA_SECTIONS.join(', ')}`, 400));
        }
        const parsedPrice = price !== undefined && price !== '' ? Number(price) : null;
        const parsedOriginalPrice = originalPrice !== undefined && originalPrice !== '' ? Number(originalPrice) : null;
        if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
            return next((0, errorHandler_1.createError)('price must be a valid non-negative number', 400));
        }
        if (parsedOriginalPrice !== null && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice < 0)) {
            return next((0, errorHandler_1.createError)('originalPrice must be a valid non-negative number', 400));
        }
        if (currency && !SUPPORTED_CURRENCIES.includes(currency)) {
            return next((0, errorHandler_1.createError)(`currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`, 400));
        }
        const files = req.files;
        if (!files || files.length === 0) {
            return next((0, errorHandler_1.createError)('No files uploaded', 400));
        }
        const results = [];
        for (const f of files) {
            const tempPath = path_1.default.join(mediaTempDir, f.filename);
            let cdnUrl;
            try {
                cdnUrl = await (0, cdn_1.uploadToCDN)(tempPath, f.filename, `media/${section}`);
            }
            finally {
                try {
                    fs_1.default.unlinkSync(tempPath);
                }
                catch { /* best-effort */ }
            }
            // Determine sort order = current max + 1
            const maxOrder = await prisma_1.prisma.siteMedia.count({ where: { section } });
            const record = await prisma_1.prisma.siteMedia.create({
                data: {
                    section,
                    cdnUrl,
                    altText: altText || null,
                    linkUrl: linkUrl || null,
                    title: title?.trim() || null,
                    shortDescription: shortDescription?.trim() || null,
                    price: parsedPrice,
                    originalPrice: parsedOriginalPrice,
                    currency: currency ? currency : null,
                    sortOrder: maxOrder,
                    uploadedBy: req.user.userId,
                },
            });
            results.push({ id: record.id, cdnUrl });
        }
        res.json({ uploaded: results.length, media: results });
    }
    catch (err) {
        next(err);
    }
});
// PUT /admin/media/:id — update metadata (altText, sortOrder, isActive)
router.put('/media/:id', async (req, res, next) => {
    try {
        const { altText, sortOrder, isActive, linkUrl, title, shortDescription, price, originalPrice, currency } = req.body;
        const parsedPrice = price !== undefined ? (price === null || price === '' ? null : Number(price)) : undefined;
        const parsedOriginalPrice = originalPrice !== undefined
            ? (originalPrice === null || originalPrice === '' ? null : Number(originalPrice))
            : undefined;
        if (parsedPrice !== undefined && parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
            return next((0, errorHandler_1.createError)('price must be a valid non-negative number', 400));
        }
        if (parsedOriginalPrice !== undefined && parsedOriginalPrice !== null && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice < 0)) {
            return next((0, errorHandler_1.createError)('originalPrice must be a valid non-negative number', 400));
        }
        if (currency !== undefined && currency !== null && currency !== '' && !SUPPORTED_CURRENCIES.includes(currency)) {
            return next((0, errorHandler_1.createError)(`currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`, 400));
        }
        const media = await prisma_1.prisma.siteMedia.update({
            where: { id: req.params.id },
            data: {
                ...(altText !== undefined && { altText }),
                ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
                ...(linkUrl !== undefined && { linkUrl: linkUrl || null }),
                ...(title !== undefined && { title: title?.trim() || null }),
                ...(shortDescription !== undefined && { shortDescription: shortDescription?.trim() || null }),
                ...(parsedPrice !== undefined && { price: parsedPrice }),
                ...(parsedOriginalPrice !== undefined && { originalPrice: parsedOriginalPrice }),
                ...(currency !== undefined && { currency: currency ? currency : null }),
            },
        });
        res.json({ media });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /admin/media/bulk — remove selected site media entries
router.delete('/media/bulk', async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return next((0, errorHandler_1.createError)('ids array is required', 400));
        }
        const result = await prisma_1.prisma.siteMedia.deleteMany({ where: { id: { in: ids } } });
        res.json({ deleted: result.count });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /admin/media/:id — remove a site media entry
router.delete('/media/:id', async (req, res, next) => {
    try {
        await prisma_1.prisma.siteMedia.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
// ─── Logo Management ──────────────────────────────────────────────────────────
// Logo display height, in px, is clamped to a sane range so a bad admin
// input can't blow up the header layout.
const LOGO_SIZE_MIN = 16;
const LOGO_SIZE_MAX = 96;
const DEFAULT_LOGO_SIZE = 28;
function clampLogoSize(size) {
    if (size == null || Number.isNaN(size))
        return DEFAULT_LOGO_SIZE;
    return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(size)));
}
// POST /admin/site-config/logo/upload — upload a logo image file directly to the
// CDN and return its URL. Deliberately does NOT create a SiteMedia record (unlike
// /media/upload) because the logo URL is already tracked on SiteConfig.logoUrl —
// previously this reused /media/upload with section:'hero' as a workaround, which
// silently inserted a stray slide into the homepage Hero Slideshow (section='hero')
// every single time a logo was uploaded or replaced. This endpoint mirrors the
// interview-demo-video upload pattern below, which never had that problem.
router.post('/site-config/logo/upload', (req, res, next) => {
    mediaUpload.single('logo')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No logo file uploaded', 400));
        }
        const tempFilePath = path_1.default.join(mediaTempDir, file.filename);
        let logoUrl;
        try {
            logoUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename, 'media/logo');
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch { /* best-effort cleanup */ }
        }
        res.json({ url: logoUrl });
    }
    catch (err) {
        next(err);
    }
});
// GET /admin/site-config/logo — get current logo settings
router.get('/site-config/logo', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        res.json({
            logoUrl: config.logoUrl || null,
            logoPages: config.logoPages || [],
            logoAltText: config.logoAltText || null,
            logoSize: clampLogoSize(config.logoSize),
            logoLinkUrl: config.logoLinkUrl || null,
            logoDisplayMode: config.logoDisplayMode || 'inline',
        });
    }
    catch (err) {
        next(err);
    }
});
// PUT /admin/site-config/logo — update logo URL, pages, alt text, size, link URL, and display mode
router.put('/site-config/logo', async (req, res, next) => {
    try {
        const { logoUrl, logoPages, logoAltText, logoSize, logoLinkUrl, logoDisplayMode } = req.body;
        const clampedSize = logoSize !== undefined ? clampLogoSize(logoSize) : undefined;
        const validatedMode = logoDisplayMode === 'replace' || logoDisplayMode === 'inline' ? logoDisplayMode : undefined;
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: {
                id: SITE_CONFIG_ID,
                logoUrl: logoUrl || null,
                logoPages: logoPages || [],
                logoAltText: logoAltText || null,
                logoSize: clampedSize ?? DEFAULT_LOGO_SIZE,
                logoLinkUrl: logoLinkUrl || null,
                logoDisplayMode: validatedMode ?? 'inline',
            },
            update: {
                ...(logoUrl !== undefined && { logoUrl: logoUrl || null }),
                ...(logoPages !== undefined && { logoPages }),
                ...(logoAltText !== undefined && { logoAltText: logoAltText || null }),
                ...(clampedSize !== undefined && { logoSize: clampedSize }),
                ...(logoLinkUrl !== undefined && { logoLinkUrl: logoLinkUrl || null }),
                ...(validatedMode !== undefined && { logoDisplayMode: validatedMode }),
            },
        });
        res.json({
            logoUrl: config.logoUrl || null,
            logoPages: config.logoPages || [],
            logoAltText: config.logoAltText || null,
            logoSize: clampLogoSize(config.logoSize),
            logoLinkUrl: config.logoLinkUrl || null,
            logoDisplayMode: config.logoDisplayMode || 'inline',
        });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /admin/site-config/logo — remove the logo
router.delete('/site-config/logo', async (_req, res, next) => {
    try {
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID },
            update: { logoUrl: null, logoPages: [], logoAltText: null, logoSize: null, logoLinkUrl: null, logoDisplayMode: null },
        });
        res.json({ ok: true, logoUrl: config.logoUrl });
    }
    catch (err) {
        next(err);
    }
});
// ─── Interview Demo Video Management ───────────────────────────────────────────
// GET /admin/site-config/interview-video — get current demo video settings
router.get('/site-config/interview-video', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        res.json({
            videoUrl: config.interviewDemoVideoUrl || null,
            videoTitle: config.interviewDemoVideoTitle || null,
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /admin/site-config/interview-video — upload a new demo video and save it
router.post('/site-config/interview-video', (req, res, next) => {
    videoUpload.single('video')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No video file uploaded', 400));
        }
        const tempFilePath = path_1.default.join(mediaTempDir, file.filename);
        let videoUrl;
        try {
            videoUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename);
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch {
                // best-effort cleanup
            }
        }
        const { title } = req.body;
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, interviewDemoVideoUrl: videoUrl, interviewDemoVideoTitle: title?.trim() || null },
            update: { interviewDemoVideoUrl: videoUrl, interviewDemoVideoTitle: title?.trim() || null },
        });
        res.json({
            videoUrl: config.interviewDemoVideoUrl,
            videoTitle: config.interviewDemoVideoTitle,
        });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /admin/site-config/interview-video — remove the demo video
router.delete('/site-config/interview-video', async (_req, res, next) => {
    try {
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID },
            update: { interviewDemoVideoUrl: null, interviewDemoVideoTitle: null },
        });
        res.json({ ok: true, videoUrl: config.interviewDemoVideoUrl });
    }
    catch (err) {
        next(err);
    }
});
// ─── Homepage Promo Video Management ───────────────────────────────────────────
// Powers the "LIVE NOW / SHOP NOW" video shown beside the homepage hero
// slideshow (PromoSideCards). Mirrors the Interview Demo Video pattern above —
// the frontend shows a branded placeholder only when no video has been uploaded.
// GET /admin/site-config/promo-video — get current promo video settings
router.get('/site-config/promo-video', async (_req, res, next) => {
    try {
        const config = await getSiteConfig();
        res.json({
            videoUrl: config.promoVideoUrl || null,
            videoTitle: config.promoVideoTitle || null,
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /admin/site-config/promo-video — upload a new promo video and save it
router.post('/site-config/promo-video', (req, res, next) => {
    videoUpload.single('video')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No video file uploaded', 400));
        }
        const tempFilePath = path_1.default.join(mediaTempDir, file.filename);
        let videoUrl;
        try {
            videoUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename);
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch {
                // best-effort cleanup
            }
        }
        const { title } = req.body;
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID, promoVideoUrl: videoUrl, promoVideoTitle: title?.trim() || null },
            update: { promoVideoUrl: videoUrl, promoVideoTitle: title?.trim() || null },
        });
        res.json({
            videoUrl: config.promoVideoUrl,
            videoTitle: config.promoVideoTitle,
        });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /admin/site-config/promo-video — remove the promo video (reverts to the bundled default)
router.delete('/site-config/promo-video', async (_req, res, next) => {
    try {
        const config = await prisma_1.prisma.siteConfig.upsert({
            where: { id: SITE_CONFIG_ID },
            create: { id: SITE_CONFIG_ID },
            update: { promoVideoUrl: null, promoVideoTitle: null },
        });
        res.json({ ok: true, videoUrl: config.promoVideoUrl });
    }
    catch (err) {
        next(err);
    }
});
// ─── Partner store management ─────────────────────────────────────────────────
/**
 * GET /admin/stores/partners
 * List all stores with their partner approval status so admin can manage them.
 */
router.get('/stores/partners', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (_req, res, next) => {
    try {
        const stores = await prisma_1.prisma.store.findMany({
            select: {
                id: true,
                name: true,
                slug: true,
                logo: true,
                partnerApproved: true,
                partnerLogoUrl: true,
                partnerName: true,
                partnerWebsite: true,
                partnerApprovedAt: true,
                isActive: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        companyName: true,
                        country: true,
                        role: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ stores });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PATCH /admin/stores/:storeId/partner-approve
 * Grant a store partner status — allows the store owner to upload a partner
 * logo that appears on the public /stores Partners wall.
 */
router.patch('/stores/:storeId/partner-approve', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const { storeId } = req.params;
        const store = await prisma_1.prisma.store.update({
            where: { id: storeId },
            data: {
                partnerApproved: true,
                partnerApprovedAt: new Date(),
            },
        });
        res.json({ store });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PATCH /admin/stores/:storeId/partner-revoke
 * Revoke partner status — removes logo from public wall immediately.
 */
router.patch('/stores/:storeId/partner-revoke', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const { storeId } = req.params;
        const store = await prisma_1.prisma.store.update({
            where: { id: storeId },
            data: {
                partnerApproved: false,
                partnerApprovedAt: null,
                partnerLogoUrl: null,
            },
        });
        res.json({ store });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map