import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { Prisma, Currency, ListingStatus, Placement, Role } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, invalidateAccountStatus } from '../middleware/auth';
import { getAdminAlerts } from '../utils/adminAlerts';
import { adminUpdateSubscription, effectiveStatus, daysRemaining, termsOf } from '../utils/subscriptionService';
import { resolveSpecialOffers } from '../utils/offers';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { uploadToCDN } from '../utils/cdn';
import { sendImageApprovedEmail, sendImageRejectedEmail, sendListingApprovedEmail, sendSubscriptionActivatedEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { DEFAULT_PLACEMENT_HOURS, DEFAULT_PLACEMENT_MS } from '../utils/placement';
import { loadHomeLayout, invalidateHomeLayoutCache } from './homeLayout';
import { BUILT_IN_SECTIONS, MAX_COLLECTIONS, MAX_COLLECTION_ITEMS, normalizeHomeLayout } from '../utils/homeLayout';

import { GENERAL_DEFAULTS, invalidateGeneralSettings, normalizeGeneralSettings } from '../utils/siteSettings';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { parsePaging } from '../utils/paging';
import { recordAdminAudit } from '../utils/adminAudit';
import { MAX_ADMINS, withAdminCapLock, assertAdminSlotFree } from '../utils/adminLimits';

// ─── Site Media Multer Setup ───────────────────────────────────────────────────

const mediaTempDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(mediaTempDir)) fs.mkdirSync(mediaTempDir, { recursive: true });

const mediaStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => cb(null, mediaTempDir),
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `media-${uuidv4()}${ext}`);
  },
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
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

const videoUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — enough for a short demo video
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only MP4, WEBM, MOV and AVI video files are allowed'));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

const PACKAGE_SCOPES = ['LISTING', 'CV', 'STORE'] as const;
type PackageScope = (typeof PACKAGE_SCOPES)[number];
const ADMIN_MANAGEABLE_ROLES: Role[] = ['BUYER', 'SELLER', 'ADMIN', 'AGENT', 'ORGANIZATION', 'COMPANY'];
const SUPPORTED_CURRENCIES: Currency[] = ['UGX'];

function parseScope(scope?: string): PackageScope {
  if (!scope) return 'LISTING';
  if (PACKAGE_SCOPES.includes(scope as PackageScope)) return scope as PackageScope;
  throw createError('scope must be LISTING, CV or STORE', 400);
}

/** STORE packages carry the visibility tier a webstore gets; every other scope has none. */
function parseStoreTier(scope: PackageScope, raw: unknown): 'FREE' | 'GOLD' | 'PLATINUM' | null {
  if (scope !== 'STORE') return null;
  const t = String(raw ?? 'FREE').toUpperCase();
  if (t !== 'FREE' && t !== 'GOLD' && t !== 'PLATINUM') throw createError('storeTier must be FREE, GOLD or PLATINUM', 400);
  return t;
}

router.use(authenticate, authorize('ADMIN'));

// ─── Site settings defaults ─────────────────────────────────────────────────────
// Persisted values live in SiteConfig.generalSettings (see the /settings routes
// below); this object only supplies fallback defaults for any key not yet set.

const defaultSettings: Record<string, unknown> = { ...GENERAL_DEFAULTS };

// ─── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      users,
      listings,
      reports,
      activeListings,
      pendingListings,
      newUsersThisMonth,
      newListingsThisMonth,
      recentUsers,
      recentListings,
      listingsByStatusRaw,
      usersByCountryRaw,
      siteStat,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.listing.count(),
      prisma.report.count({ where: { status: 'OPEN' } }),
      prisma.listing.count({ where: { status: 'ACTIVE' } }),
      prisma.listing.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.listing.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.listing.findMany({
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.listing.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.user.groupBy({ by: ['country'], _count: { country: true } }),
      prisma.siteStat.findUnique({ where: { id: 'global' } }),
    ]);

    const listingsByStatus = listingsByStatusRaw.reduce(
      (acc, row) => ({ ...acc, [row.status]: row._count.status }),
      {} as Record<string, number>,
    );

    const usersByCountry = usersByCountryRaw.reduce(
      (acc, row) => ({ ...acc, [row.country]: row._count.country }),
      {} as Record<string, number>,
    );

    // Parse visitor countries from site stats (tracked from Cloudflare headers)
    let visitorCountries: string[] = [];
    // Parse per-country visit counts for the Countries Reached list display
    let countryVisitCounts: Record<string, number> = {};
    if (siteStat?.visitorCountries) {
      try { visitorCountries = JSON.parse(siteStat.visitorCountries) as string[]; } catch { visitorCountries = []; }
    }
    if (siteStat?.countryVisitCounts) {
      try { countryVisitCounts = JSON.parse(siteStat.countryVisitCounts) as Record<string, number>; } catch { countryVisitCounts = {}; }
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
  } catch (err) {
    next(err);
  }
});

// ─── Dashboard alerts ─────────────────────────────────────────────────────────
// GET /api/admin/alerts[?since=<ISO time>&activity=<n>]
// What needs the admin's attention right now: pending counts per queue, how many arrived since
// `since` (drives pulse/animation), which queues have items overdue by 24h+, upcoming expiries and
// a recent-activity feed. Cheap enough to poll every 10-30s; supports If-None-Match -> 304 so an
// unchanged dashboard costs almost nothing. Never cached by shared caches (admin data).
router.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activity = parseInt(String(req.query.activity ?? '15'), 10);
    const alerts = await getAdminAlerts({ since: req.query.since, activityLimit: Number.isFinite(activity) ? activity : 15 });
    res.set('Cache-Control', 'private, no-cache');
    res.set('ETag', alerts.etag);
    if (req.headers['if-none-match'] === alerts.etag) {
      res.status(304).end();
      return;
    }
    const { etag: _etag, ...body } = alerts;
    res.json(body);
  } catch (err) {
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
const VISITOR_DEVICE_CATEGORIES = ['Mobile', 'Desktop', 'Tablet', 'Unknown device'] as const;

// Columns safe to sort visitor logs by — allowlisted so `sortBy` can never
// be used to inject an arbitrary/unexpected Prisma orderBy key.
const VISITOR_LOG_SORT_COLUMNS = [
  'lastSeenAt', 'firstSeenAt', 'visitCount', 'durationSeconds', 'country', 'device', 'ip',
] as const;
type VisitorLogSortColumn = (typeof VISITOR_LOG_SORT_COLUMNS)[number];

router.get('/visitor-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1'));
    const limit = Math.min(100, parseInt((req.query.limit as string) || '25'));
    const search = ((req.query.search as string) || '').trim();
    const date = ((req.query.date as string) || '').trim(); // exact dayKey, e.g. 2026-08-25
    const country = ((req.query.country as string) || '').trim().toUpperCase();
    const deviceCategory = ((req.query.deviceCategory as string) || '').trim();

    const requestedSortBy = (req.query.sortBy as string) || 'lastSeenAt';
    const sortBy: VisitorLogSortColumn = (VISITOR_LOG_SORT_COLUMNS as readonly string[]).includes(requestedSortBy)
      ? (requestedSortBy as VisitorLogSortColumn)
      : 'lastSeenAt';
    const sortDir: 'asc' | 'desc' = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const where: Record<string, unknown> = {};
    if (date) {
      where.dayKey = date;
    }
    if (country) {
      where.country = country;
    }
    if (deviceCategory && (VISITOR_DEVICE_CATEGORIES as readonly string[]).includes(deviceCategory)) {
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
      prisma.visitorLog.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.visitorLog.count({ where }),
      prisma.visitorLog.groupBy({ by: ['deviceId'], where }).then((rows) => rows.length),
      prisma.visitorLog.groupBy({
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
  } catch (err) {
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
const SEARCH_LOG_SORT_COLUMNS = ['createdAt', 'resultCount', 'query'] as const;
type SearchLogSortColumn = typeof SEARCH_LOG_SORT_COLUMNS[number];

router.get('/search-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1'));
    const limit = Math.min(100, parseInt((req.query.limit as string) || '25'));
    const search = ((req.query.search as string) || '').trim();
    const dateFrom = ((req.query.dateFrom as string) || '').trim();
    const dateTo = ((req.query.dateTo as string) || '').trim();

    const requestedSortBy = (req.query.sortBy as string) || 'createdAt';
    const sortBy: SearchLogSortColumn = (SEARCH_LOG_SORT_COLUMNS as readonly string[]).includes(requestedSortBy)
      ? (requestedSortBy as SearchLogSortColumn)
      : 'createdAt';
    const sortDir: 'asc' | 'desc' = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const where: Prisma.SearchLogWhereInput = {
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
      prisma.searchLog.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.searchLog.count({ where }),
    ]);

    res.json({ logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

const CLICK_LOG_SORT_COLUMNS = ['createdAt', 'listingTitle'] as const;
type ClickLogSortColumn = typeof CLICK_LOG_SORT_COLUMNS[number];

router.get('/click-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1'));
    const limit = Math.min(100, parseInt((req.query.limit as string) || '25'));
    const search = ((req.query.search as string) || '').trim();
    const dateFrom = ((req.query.dateFrom as string) || '').trim();
    const dateTo = ((req.query.dateTo as string) || '').trim();

    const requestedSortBy = (req.query.sortBy as string) || 'createdAt';
    const sortBy: ClickLogSortColumn = (CLICK_LOG_SORT_COLUMNS as readonly string[]).includes(requestedSortBy)
      ? (requestedSortBy as ClickLogSortColumn)
      : 'createdAt';
    const sortDir: 'asc' | 'desc' = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const where: Prisma.ListingClickLogWhereInput = {
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
      prisma.listingClickLog.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.listingClickLog.count({ where }),
    ]);

    res.json({ logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// Aggregated "most clicked items" — grouped by listing so a still-active
// listing shows its live click count. Deleted listings (listingId set to
// null by the FK's onDelete: SetNull) are grouped separately by their
// snapshotted title/image so they still surface in the ranking instead of
// silently disappearing.
router.get('/click-logs/most-clicked', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20')));

    const [byListing, byDeletedListing] = await Promise.all([
      prisma.listingClickLog.groupBy({
        by: ['listingId'],
        where: { listingId: { not: null } },
        _count: { listingId: true },
        orderBy: { _count: { listingId: 'desc' } },
        take: limit,
      }),
      prisma.listingClickLog.groupBy({
        by: ['listingTitle', 'listingImage'],
        where: { listingId: null },
        _count: { listingTitle: true },
        orderBy: { _count: { listingTitle: 'desc' } },
        take: limit,
      }),
    ]);

    const listingIds = byListing.map((row) => row.listingId).filter((id): id is string => id !== null);
    const listings = await prisma.listing.findMany({
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
    interface MostClickedListing {
      id: string;
      title: string;
      images: string[];
      status: string;
      productImages: { cdnUrl: string | null }[];
    }
    const listingMap = new Map<string, MostClickedListing>(
      (listings as MostClickedListing[]).map((l) => [l.id, l]),
    );

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
      status: 'DELETED' as const,
      clicks: row._count.listingTitle,
    }));

    const mostClicked = [...activeItems, ...deletedItems]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit);

    res.json({ items: mostClicked });
  } catch (err) {
    next(err);
  }
});

// ─── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeEnd = new Date();
    rangeEnd.setHours(23, 59, 59, 999);
    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 29);
    rangeStart.setHours(0, 0, 0, 0);

    const [
      recentUsers,
      recentListings,
      topCategoriesRaw,
      listingsByCountryRaw,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.listing.findMany({
        where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.listing.groupBy({
        by: ['categoryId'],
        _count: { categoryId: true },
        orderBy: { _count: { categoryId: 'desc' } },
        take: 10,
      }),
      prisma.listing.groupBy({
        by: ['country'],
        _count: { country: true },
      }),
    ]);

    // Bucket users and listings by date
    const bucketByDate = (records: { createdAt: Date }[]) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date(rangeStart);
        d.setDate(d.getDate() + i);
        counts[d.toISOString().slice(0, 10)] = 0;
      }
      for (const record of records) {
        const key = record.createdAt.toISOString().slice(0, 10);
        if (key in counts) counts[key]++;
      }
      return Object.entries(counts).map(([date, count]) => ({ date, count }));
    };

    const userGrowth = bucketByDate(recentUsers);
    const listingGrowth = bucketByDate(recentListings);

    // Resolve category names for topCategories
    const categoryIds = topCategoriesRaw.map((c) => c.categoryId);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const topCategories = topCategoriesRaw.map((row) => ({
      name: categoryMap.get(row.categoryId) ?? 'Unknown',
      count: row._count.categoryId,
    }));

    const listingsByCountry = listingsByCountryRaw.reduce(
      (acc, row) => ({ ...acc, [row.country]: row._count.country }),
      {} as Record<string, number>,
    );

    res.json({
      userGrowth,
      listingGrowth,
      topCategories,
      listingsByCountry,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const search = (req.query.search as string || '').trim();

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, country: true, isBanned: true, isVerified: true, createdAt: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.get('/users/admin-approval-audit', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Durable, append-only table first; older approvals that only exist as notifications follow.
    const rows = await prisma.adminAuditLog.findMany({
      where: { action: 'ADMIN_ROLE_APPROVAL' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const legacy = await prisma.notification.findMany({
      where: { type: 'SYSTEM', title: 'Admin role approved' },
      select: { id: true, createdAt: true, userId: true, user: { select: { name: true, email: true } }, data: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const audit = [
      ...rows.map((r) => ({
        id: r.id,
        action: r.action,
        approvedAt: r.createdAt,
        approvedUserId: r.targetId,
        approvedUserName: null as string | null,
        approvedUserEmail: r.targetEmail,
        approverId: r.actorId,
        approverName: null as string | null,
        approverEmail: r.actorEmail,
      })),
      ...legacy.map((log) => {
        const meta = (log.data ?? {}) as { approverId?: string; approverName?: string; approverEmail?: string };
        return {
          id: log.id,
          action: 'ADMIN_ROLE_APPROVAL',
          approvedAt: log.createdAt,
          approvedUserId: log.userId as string | null,
          approvedUserName: log.user.name as string | null,
          approvedUserEmail: log.user.email as string | null,
          approverId: meta.approverId ?? null,
          approverName: meta.approverName ?? null,
          approverEmail: meta.approverEmail ?? null,
        };
      }),
    ].sort((x, y) => +new Date(y.approvedAt) - +new Date(x.approvedAt)).slice(0, 100);

    res.json({ audit });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { isBanned, isVerified, role } = req.body;
    const targetUserId = req.params.id;
    const actorUserId = req.user?.userId;

    if (typeof isBanned !== 'undefined' && typeof isBanned !== 'boolean') {
      throw createError('isBanned must be a boolean', 400);
    }

    if (typeof isVerified !== 'undefined' && typeof isVerified !== 'boolean') {
      throw createError('isVerified must be a boolean', 400);
    }
    // isVerified is EMAIL confirmation and login is refused without it: an admin may confirm an
    // account by hand, but un-verifying would silently lock the user out (ban them instead).
    if (isVerified === false) {
      throw createError('Email verification cannot be removed. Ban the account instead if access must be blocked.', 400);
    }

    let validatedRole: Role | undefined;
    if (typeof role !== 'undefined') {
      if (typeof role !== 'string' || !ADMIN_MANAGEABLE_ROLES.includes(role as Role)) {
        throw createError('Invalid role value', 400);
      }
      validatedRole = role as Role;
    }

    if (actorUserId && actorUserId === targetUserId && (
      typeof isBanned !== 'undefined' ||
      typeof validatedRole !== 'undefined' ||
      typeof isVerified !== 'undefined'
    )) {
      throw createError('You cannot change your own role, ban state, or verification state', 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw createError('User not found', 404);
    }

    // Admins are peers: one admin cannot ban, demote or un-verify another. (Removing an admin is a
    // deliberate, out-of-band operation — see the database / seed scripts.)
    if (targetUser.role === 'ADMIN' && actorUserId !== targetUserId) {
      throw createError('You cannot change another administrator\'s account', 403);
    }

    const promoting = validatedRole === 'ADMIN' && targetUser.role !== 'ADMIN';
    const roleChanged = !!validatedRole && validatedRole !== targetUser.role;
    const applyUpdate = (db: Prisma.TransactionClient | typeof prisma) => db.user.update({
      where: { id: targetUserId },
      data: {
        ...(isBanned !== undefined && { isBanned }),
        ...(isVerified !== undefined && { isVerified }),
        ...(validatedRole && { role: validatedRole }),
        // Banning or changing a role must end existing sessions: drop the stored
        // refresh token so the user cannot mint new access tokens.
        ...((isBanned === true || (validatedRole && validatedRole !== targetUser.role)) && { refreshToken: null }),
      },
      select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
    });
    // Promotions take the admin-cap lock so two simultaneous requests cannot both pass the count.
    const audited = async (tx: Prisma.TransactionClient) => {
      const updated = await applyUpdate(tx);
      if (roleChanged || isBanned !== undefined || isVerified !== undefined) {
        const actor = actorUserId ? await tx.user.findUnique({ where: { id: actorUserId }, select: { email: true } }) : null;
        await recordAdminAudit({
          action: promoting ? 'ADMIN_ROLE_APPROVAL' : roleChanged ? 'USER_ROLE_CHANGE' : isBanned !== undefined ? 'USER_BAN_CHANGE' : 'USER_VERIFY_CHANGE',
          actorId: actorUserId ?? null, actorEmail: actor?.email ?? null,
          targetId: updated.id, targetEmail: updated.email,
          meta: { fromRole: targetUser.role, toRole: updated.role, ...(isBanned !== undefined && { isBanned }), ...(isVerified !== undefined && { isVerified }) },
        }, tx);
      }
      return updated;
    };
    const user = promoting
      ? await withAdminCapLock(async (tx) => { await assertAdminSlotFree(tx); return audited(tx); })
      : await prisma.$transaction(audited);
    invalidateAccountStatus(targetUserId);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── KYC (Know Your Customer) identity verification queue ─────────────────────

router.get('/kyc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const status = (req.query.status as string || 'PENDING').trim();
    const validStatuses = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'];
    const where = validStatuses.includes(status) ? { kycStatus: status as 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true, country: true,
          kycStatus: true, kycDocumentType: true, kycDocumentUrl: true, kycDocumentBackUrl: true, kycSelfieUrl: true,
          kycFullName: true, kycSubmittedAt: true, kycReviewedAt: true, kycRejectionReason: true,
          isKycVerified: true,
          kycPurpose: true, kycBusinessName: true, kycBusinessRegNumber: true, kycPhone: true, kycAddress: true,
        },
        // Oldest submission first (FIFO), so the queue processes in submission order.
        orderBy: { kycSubmittedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/kyc/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, kycStatus: true },
    });
    if (!target) throw createError('User not found', 404);
    if (target.kycStatus !== 'PENDING') {
      throw createError('Only submissions with status PENDING can be approved', 400);
    }

    const user = await prisma.user.update({
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

    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'KYC_APPROVED',
        title: 'Identity Verified',
        message: 'Your identity verification (KYC) has been approved. Your listings now get priority review and your profile shows a KYC Verified badge.',
        data: {},
      },
    }).catch((err) => logger.error('Failed to create KYC_APPROVED notification', err));

    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/kyc/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw createError('A rejection reason is required', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, kycStatus: true },
    });
    if (!target) throw createError('User not found', 404);
    if (target.kycStatus !== 'PENDING') {
      throw createError('Only submissions with status PENDING can be rejected', 400);
    }

    const user = await prisma.user.update({
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

    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'KYC_REJECTED',
        title: 'Identity Verification Rejected',
        message: `Your KYC submission was rejected: ${user.kycRejectionReason}. You can resubmit with corrected documents.`,
        data: {},
      },
    }).catch((err) => logger.error('Failed to create KYC_REJECTED notification', err));

    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/approve-admin', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.userId === req.params.id) {
      throw createError('Your account is already admin-approved', 400);
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true },
    });

    if (!existingUser) {
      throw createError('User not found', 404);
    }

    if (existingUser.role === 'ADMIN') {
      throw createError('User is already an admin', 400);
    }

    const approver = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: { id: true, name: true, email: true },
    });

    if (!approver) {
      throw createError('Approver account not found', 401);
    }

    const user = await withAdminCapLock(async (tx) => {
      await assertAdminSlotFree(tx);
      const promoted = await tx.user.update({
        where: { id: req.params.id },
        data: { role: 'ADMIN', isVerified: true },
        select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
      });
      await recordAdminAudit({
        action: 'ADMIN_ROLE_APPROVAL', actorId: approver.id, actorEmail: approver.email,
        targetId: promoted.id, targetEmail: promoted.email, meta: { fromRole: existingUser.role },
      }, tx);
      return promoted;
    });
    invalidateAccountStatus(user.id);

    await prisma.notification.create({
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
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.userId === req.params.id) {
      throw createError('Cannot delete your own account', 400);
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
    if (target?.role === 'ADMIN') throw createError('Administrator accounts cannot be deleted here', 403);
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── Listings ──────────────────────────────────────────────────────────────────

const LISTING_SORT_COLUMNS = ['createdAt', 'price', 'title', 'views'] as const;
type ListingSortColumn = typeof LISTING_SORT_COLUMNS[number];

router.get('/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const search = (req.query.search as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const categoryId = (req.query.categoryId as string || '').trim();
    const country = (req.query.country as string || '').trim();
    const dateFrom = (req.query.dateFrom as string || '').trim();
    const dateTo = (req.query.dateTo as string || '').trim();
    const requestedSortBy = (req.query.sortBy as string || '').trim();
    const sortBy: ListingSortColumn | '' = (LISTING_SORT_COLUMNS as readonly string[]).includes(requestedSortBy)
      ? (requestedSortBy as ListingSortColumn)
      : '';
    const sortDir: 'asc' | 'desc' = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const where: Record<string, unknown> = {};

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
      prisma.listing.findMany({
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
      prisma.listing.count({ where }),
    ]);

    res.json({ listings, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, placement, placementExpiresAt, categoryId } = req.body;
    const nextStatus = status as ListingStatus | undefined;
    const nextPlacement = placement as Placement | undefined;
    const validStatuses: ListingStatus[] = ['ACTIVE', 'PENDING', 'SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'];
    const validPlacements: Placement[] = ['NONE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE', 'BACK_TO_SCHOOL'];
    if (nextStatus && !validStatuses.includes(nextStatus)) {
      throw createError('Invalid listing status', 400);
    }
    if (nextPlacement && !validPlacements.includes(nextPlacement)) {
      throw createError('Invalid listing placement', 400);
    }

    if (categoryId) {
      const targetCategory = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!targetCategory) {
        throw createError('Category not found', 404);
      }
    }

    // Flash Deals cap: max 100 active flash-sale listings
    const FLASH_DEAL_MAX = 100;
    if (nextPlacement === 'FLASH_SALE') {
      const currentFlashCount = await prisma.listing.count({
        where: { placement: 'FLASH_SALE', id: { not: req.params.id } },
      });
      if (currentFlashCount >= FLASH_DEAL_MAX) {
        throw createError(`Flash Deals are limited to ${FLASH_DEAL_MAX} listings. Remove one before adding another.`, 400);
      }
    }

    const mustClearPlacement = nextStatus && ['SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'].includes(nextStatus);

    // Re-categorizing a listing without also explicitly setting a placement
    // resets it to NONE — a featured slot from the old category shouldn't
    // silently carry over into the new one.
    const mustClearPlacementForRecategorize = categoryId && nextPlacement === undefined;

    const listing = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...(nextStatus && { status: nextStatus, hiddenByModerator: nextStatus === 'HIDDEN' }),
        ...(categoryId && { categoryId }),
        ...(nextPlacement !== undefined && { placement: nextPlacement }),
        ...(placementExpiresAt !== undefined && { placementExpiresAt: placementExpiresAt ? new Date(placementExpiresAt) : null }),
        ...(mustClearPlacement && { placement: 'NONE', placementExpiresAt: null }),
        ...(nextPlacement === 'NONE' && { placementExpiresAt: null }),
        ...(mustClearPlacementForRecategorize && { placement: 'NONE', placementExpiresAt: null }),
      },
    });
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// ─── Bulk move listings to a different category ────────────────────────────────
// Only ever touches categoryId + placement/placementExpiresAt on the moved
// listings — title, images, price, status, etc. are left untouched.
router.post('/listings/move-category', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, categoryId } = req.body as { ids?: string[]; categoryId?: string };

    if (!Array.isArray(ids) || ids.length === 0) {
      throw createError('ids must be a non-empty array', 400);
    }
    if (!categoryId) {
      throw createError('categoryId is required', 400);
    }

    const targetCategory = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!targetCategory) {
      throw createError('Category not found', 404);
    }

    const featuredClearedCount = await prisma.listing.count({
      where: { id: { in: ids }, placement: { not: 'NONE' } },
    });

    const result = await prisma.listing.updateMany({
      where: { id: { in: ids } },
      data: { categoryId, placement: 'NONE', placementExpiresAt: null },
    });

    res.json({
      message: `Moved ${result.count} listing(s) to ${targetCategory.name}${featuredClearedCount > 0 ? `, cleared featured placement on ${featuredClearedCount} of them` : ''}.`,
      moved: result.count,
      placementCleared: featuredClearedCount,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Approve listing with placement & duration ─────────────────────────────────

// Confirm (or set/clear) a listing's visibility tier — the admin-side half
// of the ordinary-user pricing selector shown just before "Post Listing".
// The seller only ever *requests* GOLD/PLATINUM (Listing.requestedTier);
// since those are paid tiers, nothing promotes the listing until an admin
// confirms payment here. Deliberately separate from /approve above: an
// admin may approve a listing on content grounds while payment for its
// requested tier is still outstanding, and the other way round.
//   body: { tier: 'FREE' | 'GOLD' | 'PLATINUM', durationDays?: number }
// FREE clears any tier expiry. GOLD/PLATINUM start a tierExpiresAt window of
// `durationDays` (default: SiteConfig.tierPricing.listingTierDurationDays,
// no built-in default — it must be set there or passed). Admin-owned listings never get an expiry — they
// are exempt from every expiry rule, per the spec.
router.put('/listings/:id/tier', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tier, durationDays } = req.body as { tier?: string; durationDays?: number };
    if (!tier || !['FREE', 'GOLD', 'PLATINUM'].includes(tier)) {
      throw createError('tier must be one of FREE, GOLD, PLATINUM', 400);
    }
    if (durationDays !== undefined && (typeof durationDays !== 'number' || durationDays <= 0)) {
      throw createError('durationDays must be a positive number', 400);
    }

    const existing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, userId: true, user: { select: { role: true } } },
    });
    if (!existing) throw createError('Listing not found', 404);

    const config = await getSiteConfig();
    const pricing = { ...DEFAULT_TIER_PRICING, ...((config.tierPricing as Partial<TierPricingConfig>) || {}) };
    const days = durationDays ?? pricing.listingTierDurationDays;

    const isOwnerAdmin = existing.user?.role === 'ADMIN';
    if (tier !== 'FREE' && !isOwnerAdmin && !(typeof days === 'number' && days > 0)) {
      throw createError('Set the tier duration in Site Config → Tier Pricing, or pass durationDays.', 400);
    }
    const tierExpiresAt =
      tier === 'FREE' || isOwnerAdmin ? null : new Date(Date.now() + (days as number) * 24 * 60 * 60 * 1000);

    const listing = await prisma.listing.update({
      where: { id: existing.id },
      data: { tier: tier as 'FREE' | 'GOLD' | 'PLATINUM', tierExpiresAt, requestedTier: null },
    });

    if (tier !== 'FREE') {
      await prisma.notification.create({
        data: {
          userId: existing.userId,
          type: 'SYSTEM',
          title: `${tier === 'GOLD' ? 'Gold' : 'Platinum'} visibility activated`,
          message: tierExpiresAt
            ? `Your listing "${existing.title}" now has ${tier === 'GOLD' ? 'Gold' : 'Platinum'} visibility until ${tierExpiresAt.toLocaleDateString()}.`
            : `Your listing "${existing.title}" now has ${tier === 'GOLD' ? 'Gold' : 'Platinum'} visibility.`,
          data: { listingId: existing.id },
        },
      }).catch((err) => logger.error('Failed to create tier notification', err));
    }

    res.json(listing);
  } catch (err) {
    next(err);
  }
});

router.put('/listings/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { placement, durationHours, customExpiry } = req.body;

    if (!placement || !['LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE', 'BACK_TO_SCHOOL'].includes(placement)) {
      throw createError('placement must be LATEST_COLLECTIONS, FEATURED_DEAL, FLASH_SALE, or BACK_TO_SCHOOL', 400);
    }

    // Flash Deals cap: max 100 at a time
    if (placement === 'FLASH_SALE') {
      const flashCount = await prisma.listing.count({
        where: { placement: 'FLASH_SALE', id: { not: req.params.id } },
      });
      if (flashCount >= 100) {
        throw createError('Flash Deals are limited to 100 listings. Remove one before adding another.', 400);
      }
    }

    let placementExpiresAt: Date;
    if (customExpiry) {
      placementExpiresAt = new Date(customExpiry);
      if (isNaN(placementExpiresAt.getTime())) {
        throw createError('Invalid customExpiry date', 400);
      }
    } else {
      const hours = parseInt(durationHours) || DEFAULT_PLACEMENT_HOURS;
      placementExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    // Fetch current listing to get the owner's userId and role
    const currentListing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { userId: true, user: { select: { role: true } } },
    });
    if (!currentListing) throw createError('Listing not found', 404);

    // Admin-owned listings never expire unless the admin explicitly sets a date.
    // For non-admin sellers, derive expiry from their active subscription.
    const now = new Date();
    const isOwnerAdmin = currentListing.user?.role === 'ADMIN';
    let listingExpiresAt: Date | null = null;

    if (!isOwnerAdmin) {
      const activeSub = await prisma.sellerSubscription.findFirst({
        where: { userId: currentListing.userId, status: 'ACTIVE', endDate: { gt: now }, package: { scope: 'LISTING' } },
        include: { package: true },
        orderBy: { endDate: 'desc' },
      });
      listingExpiresAt = activeSub
        ? activeSub.endDate
        : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    const listing = await prisma.listing.update({
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
    await prisma.notification.create({
      data: {
        userId: listing.user.id,
        type: 'LISTING_APPROVED',
        title: 'Listing Approved',
        message: listingExpiresAt
          ? `Your listing "${listing.title}" has been approved and is now live until ${listingExpiresAt.toLocaleDateString()}.`
          : `Your listing "${listing.title}" has been approved and is now live.`,
        data: { listingId: listing.id, listingTitle: listing.title },
      },
    }).catch((err) => logger.error('Failed to create LISTING_APPROVED notification', err));

    // Approval email (non-blocking)
    sendListingApprovedEmail(listing.user.email, listing.user.name, listing.title, listingExpiresAt)
      .catch((err) => logger.error('Failed to send listing approved email', err));

    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// ─── Reject listing ────────────────────────────────────────────────────────────

router.put('/listings/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', placement: 'NONE', placementExpiresAt: null },
      include: {
        user: { select: { id: true } },
      },
    });
    await prisma.notification.create({
      data: {
        userId: listing.user.id,
        type: 'LISTING_REJECTED',
        title: 'Listing Rejected',
        message: `Your listing "${listing.title}" was rejected by an administrator.`,
        data: { listingId: listing.id },
      },
    }).catch((err) => logger.error('Failed to create LISTING_REJECTED notification', err));
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

router.delete('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.listing.delete({ where: { id: req.params.id } });
    res.json({ message: 'Listing deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Bulk Actions (approve / reject / delete) ────────────────────────────
// POST /admin/listings/bulk-action
// Body: { ids: string[], action: 'approve' | 'reject' | 'delete' | 'feature' }

router.post('/listings/bulk-action', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, action } = req.body as { ids: string[]; action: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      throw createError('ids array is required and must not be empty', 400);
    }
    if (!['approve', 'reject', 'delete', 'feature'].includes(action)) {
      throw createError('action must be one of: approve, reject, delete, feature', 400);
    }

    if (action === 'delete') {
      await prisma.listing.deleteMany({ where: { id: { in: ids } } });
      return res.json({ message: `${ids.length} listing(s) deleted`, affected: ids.length });
    }

    const statusMap: Record<string, 'ACTIVE' | 'REJECTED'> = {
      approve: 'ACTIVE',
      reject: 'REJECTED',
      feature: 'ACTIVE',
    };

    const updateData: {
      status: 'ACTIVE' | 'REJECTED';
      placement?: Placement;
      placementExpiresAt?: Date;
    } = { status: statusMap[action] };
    if (action === 'feature') {
      const placementExpiry = new Date(Date.now() + DEFAULT_PLACEMENT_MS);
      updateData.placement = 'LATEST_COLLECTIONS';
      updateData.placementExpiresAt = placementExpiry;
    }

    await prisma.listing.updateMany({ where: { id: { in: ids } }, data: updateData });
    return res.json({ message: `${ids.length} listing(s) updated`, affected: ids.length });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Bulk Listing Creation ───────────────────────────────────────────────

// Shared shape for a single item in a bulk-post request — mirrors the fields
// accepted by POST /listings (see routes/listings.ts) so that bulk-created
// listings are indistinguishable from ones made through the regular
// single-listing flow: same category-specific detail blocks, same product
// options, same optional geolocation.
interface BulkListingItem {
  title: string;
  description: string;
  price: number;
  priceUnit?: string;
  currency: string;
  condition: string;
  country: string;
  location: string;
  categoryId: string;
  categorySlug?: string;
  quantity?: number | string | null;
  tags?: string[];
  motorDetails?: Record<string, unknown>;
  propertyDetails?: Record<string, unknown>;
  jobDetails?: Record<string, unknown>;
  productOptions?: Array<{ name: string; values: string[] }>;
  latitude?: number | string;
  longitude?: number | string;
}

// Validates the required fields for every item in a bulk-post batch before
// any database writes happen, so a single bad row fails the whole batch
// with a precise message instead of a confusing partial Prisma error deep
// into the transaction. Stock is mandatory (mirrors the single-listing
// POST /listings endpoint) — every bulk-posted listing must declare how
// many units are available.
function validateBulkItems(items: BulkListingItem[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = i + 1;
    if (!item.title || !item.title.trim()) return `Row ${row}: title is required`;
    if (!item.description || !item.description.trim()) return `Row ${row}: description is required`;
    if (item.price == null || isNaN(Number(item.price)) || Number(item.price) < 0) {
      return `Row ${row}: price must be a valid non-negative number`;
    }
    if (!item.country) return `Row ${row}: country is required`;
    if (!item.location || !item.location.trim()) return `Row ${row}: location is required`;
    if (!item.categoryId) return `Row ${row}: category is required`;
    if (item.quantity != null && String(item.quantity).trim() !== '') {
      const parsedQty = parseInt(String(item.quantity), 10);
      if (isNaN(parsedQty) || parsedQty < 0 || String(parsedQty) !== String(item.quantity).trim()) {
        return `Row ${row}: quantity must be a valid non-negative whole number`;
      }
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
function buildBulkListingData(
  item: BulkListingItem,
  adminId: string,
  images: string[],
) {
  return {
    title: item.title,
    description: item.description,
    price: Number(item.price),
    priceUnit: (['ITEM', 'KG', 'TONNE'].includes(String(item.priceUnit).toUpperCase())
      ? (String(item.priceUnit).toUpperCase() as 'ITEM' | 'KG' | 'TONNE')
      : 'ITEM'),
    currency: item.currency as 'UGX',
    condition: (item.condition as 'NEW' | 'USED') || 'NEW',
    country: item.country as 'UGANDA',
    location: item.location,
    categoryId: item.categoryId,
    userId: adminId,
    status: 'ACTIVE' as const,
    quantity: item.quantity != null && String(item.quantity).trim() !== '' ? parseInt(String(item.quantity), 10) : null,
    tags: item.tags ?? [],
    images,
    ...(item.motorDetails && Object.values(item.motorDetails).some(Boolean) && { motorDetails: item.motorDetails as Prisma.InputJsonValue }),
    ...(item.propertyDetails && Object.values(item.propertyDetails).some(Boolean) && { propertyDetails: item.propertyDetails as Prisma.InputJsonValue }),
    ...(item.jobDetails && Object.values(item.jobDetails).some(Boolean) && { jobDetails: item.jobDetails as Prisma.InputJsonValue }),
    ...(item.productOptions && item.productOptions.length > 0 && { productOptions: item.productOptions }),
    ...(item.latitude != null && item.latitude !== '' && { latitude: parseFloat(String(item.latitude)) }),
    ...(item.longitude != null && item.longitude !== '' && { longitude: parseFloat(String(item.longitude)) }),
  };
}

router.post('/listings/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listings: items } = req.body as { listings: BulkListingItem[] };

    if (!Array.isArray(items) || items.length === 0) {
      throw createError('listings array is required and must not be empty', 400);
    }
    if (items.length > 50) {
      throw createError('Cannot create more than 50 listings in a single bulk request', 400);
    }

    const validationError = validateBulkItems(items);
    if (validationError) throw createError(validationError, 400);

    const adminId = (req as AuthRequest).user!.userId;

    const created = await prisma.$transaction(
      items.map((item) =>
        prisma.listing.create({ data: buildBulkListingData(item, adminId, []) })
      )
    );

    res.status(201).json({ created: created.length, listings: created });
  } catch (err) {
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

const bulkListingStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) =>
    cb(null, mediaTempDir),
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `blk-${uuidv4()}${ext}`);
  },
});

const bulkListingUpload = multer({
  storage: bulkListingStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, GIF and WEBP images are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/listings/bulk-media',
  (req: Request, res: Response, next: NextFunction) => {
    bulkListingUpload.any()(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) return next(createError(err.message, 400));
      if (err) return next(createError((err as Error).message || 'Upload failed', 400));
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rawListings = req.body?.listings;
      if (!rawListings) throw createError('listings field (JSON string) is required', 400);

      let items: BulkListingItem[];

      try {
        items = JSON.parse(rawListings);
      } catch {
        throw createError('listings must be a valid JSON string', 400);
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw createError('listings array is required and must not be empty', 400);
      }
      if (items.length > 50) {
        throw createError('Cannot create more than 50 listings in a single bulk request', 400);
      }

      const validationError = validateBulkItems(items);
      if (validationError) throw createError(validationError, 400);

      const adminId = req.user!.userId;
      const uploadedFiles = (req.files as Express.Multer.File[]) || [];

      // Build a map: fieldName → files (e.g. images_0 → [file, file, ...])
      const filesByIndex = new Map<number, Express.Multer.File[]>();
      for (const f of uploadedFiles) {
        const match = f.fieldname.match(/^images_(\d+)$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          if (!filesByIndex.has(idx)) filesByIndex.set(idx, []);
          filesByIndex.get(idx)!.push(f);
        }
      }

      // Resolve category slugs for folder organisation (batch lookup)
      const categoryIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))];
      const categoryRecords = await prisma.category.findMany({
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
      const imageUrlsByIndex: string[][] = await Promise.all(
        items.map(async (item, idx) => {
          const files = filesByIndex.get(idx) || [];
          if (files.length === 0) return [];

          const country = (item.country || 'UGANDA').toUpperCase().replace(/[^A-Z0-9_]/g, '');
          const catSlug = item.categorySlug || categorySlugMap.get(item.categoryId) || 'general';
          const folder = `${country}/${catSlug}`;

          const urls: string[] = [];
          for (const f of files) {
            const tempPath = path.join(mediaTempDir, f.filename);
            let cdnUrl: string;
            try {
              cdnUrl = await uploadToCDN(tempPath, f.filename, folder);
              urls.push(cdnUrl);
            } catch (uploadErr) {
              logger.error(`Bulk image upload failed for row ${idx + 1} (${f.originalname}):`, uploadErr);
              throw createError(
                `Row ${idx + 1}: failed to upload image "${f.originalname}". Please try again, or remove the image and retry.`,
                502,
              );
            } finally {
              try { fs.unlinkSync(tempPath); } catch { /* best-effort */ }
            }
          }
          return urls;
        })
      );

      // Create listings in a single transaction. Uses the same field-mapping
      // as the JSON-only endpoint above (via buildBulkListingData) so images
      // are the only thing that differs between the two bulk-post paths.
      const created = await prisma.$transaction(
        items.map((item, idx) =>
          prisma.listing.create({
            data: buildBulkListingData(item, adminId, imageUrlsByIndex[idx] ?? []),
          })
        )
      );

      res.status(201).json({ created: created.length, listings: created });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Categories ────────────────────────────────────────────────────────────────

// Countries the marketplace operates in (mirrors SECTION_COUNT_COUNTRIES
// further down this file). Used to flag categories that are under-stocked
// in a given country and to scope the populate action below.
const CATEGORY_COUNTRIES = ['UGANDA'] as const;
// Below this many ACTIVE listings (for the selected country), a category is
// flagged as low-inventory in the admin UI.
const LOW_INVENTORY_THRESHOLD = 20;

router.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { listings: true } } },
      orderBy: { name: 'asc' },
    });

    // Per-country ACTIVE listing counts for each category, so the admin UI
    // can flag categories with fewer than LOW_INVENTORY_THRESHOLD active
    // listings in the currently selected country.
    const countryCountsByCategory = await Promise.all(
      categories.map(async (cat) => {
        const perCountry = await Promise.all(
          CATEGORY_COUNTRIES.map(async (country) => {
            const count = await prisma.listing.count({
              where: { categoryId: cat.id, country, status: 'ACTIVE' },
            });
            return [country, count] as const;
          })
        );
        return [cat.id, Object.fromEntries(perCountry)] as const;
      })
    );
    const countryCountsMap = Object.fromEntries(countryCountsByCategory);

    res.json(
      categories.map((cat) => ({ ...cat, countryCounts: countryCountsMap[cat.id] }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug, icon, parentId, fieldSchema } = req.body;
    if (!name || !slug) {
      throw createError('Name and slug are required', 400);
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        ...(icon && { icon }),
        ...(parentId && { parentId }),
        ...(fieldSchema !== undefined && { fieldSchema }),
      },
    });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug, icon, parentId, fieldSchema } = req.body;
    const category = await prisma.category.update({
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
  } catch (err) {
    next(err);
  }
});

router.delete('/categories/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
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
router.post('/categories/:id/populate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { country } = req.body as { country?: string };
    if (!country || !CATEGORY_COUNTRIES.includes(country as typeof CATEGORY_COUNTRIES[number])) {
      return next(createError(`country must be one of: ${CATEGORY_COUNTRIES.join(', ')}`, 400));
    }
    const countryTyped = country as typeof CATEGORY_COUNTRIES[number];

    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) throw createError('Category not found', 404);

    const currentCount = await prisma.listing.count({
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
    const candidates = await prisma.listing.findMany({
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

    await prisma.listing.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { status: 'ACTIVE' },
    });

    res.json({ updated: candidates.length, newCount: currentCount + candidates.length });
  } catch (err) {
    next(err);
  }
});

// ─── Reports ───────────────────────────────────────────────────────────────────

const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
type ReportStatusValue = typeof REPORT_STATUSES[number];

router.get('/reports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = String(req.query.status || 'OPEN').toUpperCase();
    const status = (REPORT_STATUSES as readonly string[]).includes(raw) ? (raw as ReportStatusValue) : undefined; // ALL → no filter

    const [reports, grouped] = await Promise.all([
      prisma.report.findMany({
        where: status ? { status } : {},
        include: {
          reporter: { select: { id: true, name: true, email: true } },
          listing: {
            select: {
              id: true, title: true, status: true,
              user: { select: { id: true, name: true, email: true, isBanned: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    // How many reports each listing in this view has (repeat reports = stronger signal).
    const perListing = new Map<string, number>();
    for (const r of reports) perListing.set(r.listingId, (perListing.get(r.listingId) || 0) + 1);

    const counts = { OPEN: 0, RESOLVED: 0, DISMISSED: 0 } as Record<ReportStatusValue, number>;
    for (const g of grouped) counts[g.status as ReportStatusValue] = g._count._all;

    res.json({
      reports: reports.map((r) => ({ ...r, listingReportCount: perListing.get(r.listingId) || 1 })),
      counts,
    });
  } catch (err) {
    next(err);
  }
});

// Act on a report. REMOVE_LISTING hides the listing from the marketplace;
// WARN_SELLER notifies the seller; BAN_SELLER bans the seller account and
// hides all their live listings; NO_ACTION closes it as reviewed-and-fine.
// Other OPEN reports on the same listing are closed with it.
const REPORT_ACTIONS = ['REMOVE_LISTING', 'WARN_SELLER', 'BAN_SELLER', 'NO_ACTION'] as const;
type ReportAction = typeof REPORT_ACTIONS[number];

router.put('/reports/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, note } = req.body as { action?: string; note?: string };
    if (!action || !(REPORT_ACTIONS as readonly string[]).includes(action)) {
      return next(createError(`action must be one of: ${REPORT_ACTIONS.join(', ')}`, 400));
    }
    const adminNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';

    const report = await prisma.report.findUnique({
      where: { id: req.params.id },
      include: { listing: { select: { id: true, title: true, userId: true } } },
    });
    if (!report) return next(createError('Report not found', 404));
    if (report.status !== 'OPEN') return next(createError('This report has already been handled', 409));

    const sellerId = report.listing.userId;
    const doAction = action as ReportAction;

    if (doAction === 'REMOVE_LISTING') {
      // REJECTED, not HIDDEN: a seller can flip HIDDEN back to ACTIVE, which would undo the takedown.
      await prisma.listing.update({ where: { id: report.listingId }, data: { status: 'REJECTED', placement: 'NONE', placementExpiresAt: null } });
    } else if (doAction === 'BAN_SELLER') {
      await prisma.user.update({ where: { id: sellerId }, data: { isBanned: true, refreshToken: null } });
      invalidateAccountStatus(sellerId);
      // REJECTED (not HIDDEN): owners can re-activate HIDDEN listings themselves.
      await prisma.listing.updateMany({ where: { userId: sellerId, status: { in: ['ACTIVE', 'PENDING', 'HIDDEN'] } }, data: { status: 'REJECTED' } });
    }

    const now = new Date();
    const adminId = (req as Request & { user?: { userId: string } }).user?.userId ?? null;
    await prisma.report.updateMany({
      where: { status: 'OPEN', OR: [{ id: report.id }, ...(doAction === 'NO_ACTION' || doAction === 'WARN_SELLER' ? [] : [{ listingId: report.listingId }])] },
      data: { status: 'RESOLVED', resolution: doAction, adminNote: adminNote || null, resolvedAt: now, resolvedById: adminId },
    });

    if (doAction !== 'NO_ACTION') {
      const messages: Record<Exclude<ReportAction, 'NO_ACTION'>, string> = {
        REMOVE_LISTING: `Your listing "${report.listing.title}" was removed after a report was reviewed.`,
        WARN_SELLER: `Your listing "${report.listing.title}" was reported and reviewed. Please make sure it follows our listing rules.`,
        BAN_SELLER: 'Your account has been suspended after reports were reviewed.',
      };
      await prisma.notification.create({
        data: {
          userId: sellerId,
          type: 'SYSTEM',
          title: doAction === 'WARN_SELLER' ? 'Listing report warning' : 'Moderation notice',
          message: messages[doAction as Exclude<ReportAction, 'NO_ACTION'>] + (adminNote ? ` Note: ${adminNote}` : ''),
          data: { reportId: report.id, listingId: report.listingId },
        },
      }).catch((err) => logger.error('Failed to create report notification', err));
    }

    // Tell the reporter their report was looked at.
    await prisma.notification.create({
      data: {
        userId: report.reporterId,
        type: 'SYSTEM',
        title: 'Report reviewed',
        message: `Thanks — we reviewed your report on "${report.listing.title}"${doAction === 'NO_ACTION' ? ' and found no violation' : ' and took action'}.`,
        data: { reportId: report.id },
      },
    }).catch((err) => logger.error('Failed to create reporter notification', err));

    res.json({ message: 'Report resolved', action: doAction });
  } catch (err) {
    next(err);
  }
});

// Dismiss keeps the record (unlike DELETE below) so repeat false reporters stay visible.
router.put('/reports/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const report = await prisma.report.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!report) return next(createError('Report not found', 404));
    if (report.status !== 'OPEN') return next(createError('This report has already been handled', 409));
    await prisma.report.update({
      where: { id: req.params.id },
      data: {
        status: 'DISMISSED', resolution: 'DISMISSED', adminNote: note || null, resolvedAt: new Date(),
        resolvedById: (req as Request & { user?: { userId: string } }).user?.userId ?? null,
      },
    });
    res.json({ message: 'Report dismissed' });
  } catch (err) {
    next(err);
  }
});

// ─── Settings ──────────────────────────────────────────────────────────────────
// Persisted in SiteConfig.generalSettings (a JSON blob) rather than kept in a
// plain in-memory variable, which previously reset on every server
// restart/redeploy and was inconsistent across multiple server instances —
// making saves here appear to silently fail.

router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    // Always return what the site actually enforces (clamped / typed), not the raw stored blob.
    res.json(normalizeGeneralSettings(config.generalSettings as Record<string, unknown> | null));
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedKeys = Object.keys(defaultSettings);
    const config = await getSiteConfig();
    const current = (config.generalSettings as Record<string, unknown>) || {};
    const merged: Record<string, unknown> = { ...current };
    for (const key of Object.keys(req.body ?? {})) {
      if (allowedKeys.includes(key)) merged[key] = req.body[key];
    }
    // Validate + clamp on write with the same normaliser the site reads through,
    // so the admin screen can never show a value different from the one enforced.
    const normalized = normalizeGeneralSettings(merged);
    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, generalSettings: normalized as unknown as Prisma.InputJsonValue },
      update: { generalSettings: normalized as unknown as Prisma.InputJsonValue },
    });
    invalidateGeneralSettings();
    res.json(normalizeGeneralSettings(updated.generalSettings as Record<string, unknown> | null));
  } catch (err) {
    next(err);
  }
});

// ─── Site Config (WhatsApp number, Today's Deals, header theme) ───────────────

const SITE_CONFIG_ID = 'global';

async function getSiteConfig() {
  return prisma.siteConfig.upsert({
    where: { id: SITE_CONFIG_ID },
    create: { id: SITE_CONFIG_ID },
    update: {},
  });
}

router.get('/site-config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { whatsappNumber } = req.body;
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, whatsappNumber: whatsappNumber || null },
      update: { whatsappNumber: whatsappNumber || null },
    });
    res.json({ whatsappNumber: config.whatsappNumber });
  } catch (err) {
    next(err);
  }
});

// Today's Deals CRUD
router.get('/site-config/deals', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({ deals: (config.todaysDeals as unknown[]) || [] });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/deals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { deals } = req.body;
    if (!Array.isArray(deals)) return next(createError('deals must be an array', 400));
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, todaysDeals: deals },
      update: { todaysDeals: deals },
    });
    res.json({ deals: (config.todaysDeals as unknown[]) || [] });
  } catch (err) {
    next(err);
  }
});

// ─── Homepage Blog Popup (admin-configurable interval) ─────────────────────────
// Stored as a JSON blob on the singleton SiteConfig row: { enabled,
// intervalSeconds, postId }. `postId` pins a specific post; leaving it unset
// falls back to the most recently published post at render time (see
// GET /api/blog/popup, which does the resolution for the public site).

interface BlogPopupConfig {
  enabled: boolean;
  intervalSeconds: number;
  postId: string | null;
}

const DEFAULT_BLOG_POPUP: BlogPopupConfig = {
  enabled: false,
  intervalSeconds: 60,
  postId: null,
};

const MIN_BLOG_POPUP_INTERVAL_SECONDS = 10;

router.get('/site-config/blog-popup', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    const stored = (config.blogPopup as Partial<BlogPopupConfig>) || {};
    res.json({ ...DEFAULT_BLOG_POPUP, ...stored });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/blog-popup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled, intervalSeconds, postId } = req.body as Partial<BlogPopupConfig>;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return next(createError('enabled must be a boolean', 400));
    }
    if (intervalSeconds !== undefined) {
      if (typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds) || intervalSeconds < MIN_BLOG_POPUP_INTERVAL_SECONDS) {
        return next(createError(`intervalSeconds must be a number of at least ${MIN_BLOG_POPUP_INTERVAL_SECONDS}`, 400));
      }
    }
    if (postId !== undefined && postId !== null) {
      const post = await prisma.blogPost.findUnique({ where: { id: postId } });
      if (!post) return next(createError('No blog post found with that id', 400));
    }

    const config = await getSiteConfig();
    const current = { ...DEFAULT_BLOG_POPUP, ...((config.blogPopup as Partial<BlogPopupConfig>) || {}) };
    const merged: BlogPopupConfig = {
      enabled: enabled !== undefined ? enabled : current.enabled,
      intervalSeconds: intervalSeconds !== undefined ? intervalSeconds : current.intervalSeconds,
      postId: postId !== undefined ? postId : current.postId,
    };

    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, blogPopup: merged as unknown as Prisma.InputJsonValue },
      update: { blogPopup: merged as unknown as Prisma.InputJsonValue },
    });
    res.json({ ...DEFAULT_BLOG_POPUP, ...(updated.blogPopup as Partial<BlogPopupConfig>) });
  } catch (err) {
    next(err);
  }
});

// ─── "Special Offers" section (admin-controlled switch, discount threshold, window) ──
// Stored as a JSON blob on SiteConfig.specialOffers. The public site reads it through
// utils/offers.ts (resolveSpecialOffers), which also supplies the legacy
// generalSettings.specialFindsEnabled fallback for `enabled` until this is first saved.

router.get('/site-config/special-offers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    const { enabled, minDiscountPercent, startAt, endAt } = resolveSpecialOffers(config);
    res.json({ enabled, minDiscountPercent, startAt, endAt });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/special-offers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled, minDiscountPercent, startAt, endAt } = (req.body ?? {}) as {
      enabled?: unknown; minDiscountPercent?: unknown; startAt?: unknown; endAt?: unknown;
    };

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return next(createError('enabled must be a boolean', 400));
    }
    if (minDiscountPercent !== undefined) {
      if (typeof minDiscountPercent !== 'number' || !Number.isFinite(minDiscountPercent) || minDiscountPercent < 1 || minDiscountPercent > 99) {
        return next(createError('minDiscountPercent must be a number between 1 and 99', 400));
      }
    }
    if (startAt !== undefined && !isValidIsoDateOrNull(startAt)) {
      return next(createError('startAt must be a valid date string or null', 400));
    }
    if (endAt !== undefined && !isValidIsoDateOrNull(endAt)) {
      return next(createError('endAt must be a valid date string or null', 400));
    }

    const config = await getSiteConfig();
    const current = resolveSpecialOffers(config);
    const merged = {
      enabled: enabled !== undefined ? enabled : current.enabled,
      minDiscountPercent: minDiscountPercent !== undefined ? Math.round(minDiscountPercent as number) : current.minDiscountPercent,
      startAt: startAt !== undefined ? (startAt as string | null) : current.startAt,
      endAt: endAt !== undefined ? (endAt as string | null) : current.endAt,
    };
    if (merged.startAt && merged.endAt && new Date(merged.startAt).getTime() >= new Date(merged.endAt).getTime()) {
      return next(createError('startAt must be before endAt', 400));
    }

    await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, specialOffers: merged as unknown as Prisma.InputJsonValue },
      update: { specialOffers: merged as unknown as Prisma.InputJsonValue },
    });
    res.json(merged);
  } catch (err) {
    next(err);
  }
});

// ─── "Back to School" section (admin-controlled visibility + timing) ──────────
// Stored as a JSON blob on the singleton SiteConfig row: { enabled, startAt,
// endAt }. This only controls whether the section shows at all and, if set,
// a scheduled window — WHICH listings appear is controlled separately via
// Listing.placement = 'BACK_TO_SCHOOL' (assigned the same way as
// FLASH_SALE/FEATURED_DEAL/LATEST_COLLECTIONS, see PUT /listings/:id and
// POST /listings/:id/approve below). See GET /api/listings/back-to-school
// for the resolved, timing-checked list served to the public site.

interface BackToSchoolConfig {
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
}

const DEFAULT_BACK_TO_SCHOOL: BackToSchoolConfig = {
  enabled: false,
  startAt: null,
  endAt: null,
};

function isValidIsoDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  return !Number.isNaN(new Date(value).getTime());
}

router.get('/site-config/back-to-school', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    const stored = (config.backToSchool as Partial<BackToSchoolConfig>) || {};
    res.json({ ...DEFAULT_BACK_TO_SCHOOL, ...stored });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/back-to-school', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled, startAt, endAt } = req.body as Partial<BackToSchoolConfig>;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return next(createError('enabled must be a boolean', 400));
    }
    if (startAt !== undefined && !isValidIsoDateOrNull(startAt)) {
      return next(createError('startAt must be a valid date string or null', 400));
    }
    if (endAt !== undefined && !isValidIsoDateOrNull(endAt)) {
      return next(createError('endAt must be a valid date string or null', 400));
    }
    if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      return next(createError('startAt must be before endAt', 400));
    }

    const config = await getSiteConfig();
    const current = { ...DEFAULT_BACK_TO_SCHOOL, ...((config.backToSchool as Partial<BackToSchoolConfig>) || {}) };
    const merged: BackToSchoolConfig = {
      enabled: enabled !== undefined ? enabled : current.enabled,
      startAt: startAt !== undefined ? startAt : current.startAt,
      endAt: endAt !== undefined ? endAt : current.endAt,
    };

    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, backToSchool: merged as unknown as Prisma.InputJsonValue },
      update: { backToSchool: merged as unknown as Prisma.InputJsonValue },
    });
    res.json({ ...DEFAULT_BACK_TO_SCHOOL, ...(updated.backToSchool as Partial<BackToSchoolConfig>) });
  } catch (err) {
    next(err);
  }
});

// ─── AI Customer Support chat FAQ context (Module 2) ───────────────────────────
// Plain text, not a JSON blob like the two sections above — an admin just
// pastes in their FAQ/policies as free-form text (see
// backend/src/routes/support.ts, which restricts every chat answer to only
// this context, falling back to a human-transfer message otherwise).
router.get('/site-config/support-faq', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({ supportFaqContext: config.supportFaqContext || '' });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/support-faq', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supportFaqContext } = req.body as { supportFaqContext?: string };
    if (supportFaqContext !== undefined && typeof supportFaqContext !== 'string') {
      return next(createError('supportFaqContext must be a string', 400));
    }

    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, supportFaqContext: supportFaqContext || null },
      update: { supportFaqContext: supportFaqContext || null },
    });
    res.json({ supportFaqContext: updated.supportFaqContext || '' });
  } catch (err) {
    next(err);
  }
});

// ─── Tier Pricing (Free/Gold/Platinum catalog prices) ──────────────────────────
// Single admin-managed price catalog for both purchase paths described in
// the multi-tier listing/store spec this was built from:
//   - listingGoldPrice/listingPlatinumPrice/listingTierDurationDays: what an
//     ordinary user pays (and for how long) when they pick Gold/Platinum on
//     the pricing selector shown just before "Post Listing" — see
//     POST /listings (routes/listings.ts) for where the request lands, and
//     PUT /listings/:id/approve below for where an admin actually confirms
//     it and starts the tierExpiresAt clock.
//   Webstore fees are NOT here any more: they are packages (Admin → Packages,
//   scope "Webstore"), see routes/storeRentals.ts.
interface TierPricingConfig {
  currency: 'UGX';
  // null = the admin has not set it yet. There are no built-in prices: an unset tier is simply not offered.
  listingGoldPrice: number | null;
  listingPlatinumPrice: number | null;
  listingTierDurationDays: number | null;
}

const DEFAULT_TIER_PRICING: TierPricingConfig = {
  currency: 'UGX',
  listingGoldPrice: null,
  listingPlatinumPrice: null,
  listingTierDurationDays: null,
};

router.get('/site-config/tier-pricing', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({ ...DEFAULT_TIER_PRICING, ...(config.tierPricing as Partial<TierPricingConfig>) });
  } catch (err) {
    next(err);
  }
});

router.put('/site-config/tier-pricing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Partial<TierPricingConfig>;
    const numericFields: (keyof TierPricingConfig)[] = [
      'listingGoldPrice', 'listingPlatinumPrice', 'listingTierDurationDays',
    ];
    for (const field of numericFields) {
      if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== 'number' || (body[field] as number) < 0)) {
        return next(createError(`${field} must be a non-negative number (or empty to leave it unset)`, 400));
      }
    }
    if (body.currency !== undefined && !['UGX'].includes(body.currency)) {
      return next(createError('currency must be UGX', 400));
    }

    const config = await getSiteConfig();
    const current = { ...DEFAULT_TIER_PRICING, ...((config.tierPricing as Partial<TierPricingConfig>) || {}) };
    const merged: TierPricingConfig = { ...current, ...body };

    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, tierPricing: merged as unknown as Prisma.InputJsonValue },
      update: { tierPricing: merged as unknown as Prisma.InputJsonValue },
    });
    res.json({ ...DEFAULT_TIER_PRICING, ...(updated.tierPricing as Partial<TierPricingConfig>) });
  } catch (err) {
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
const SECTION_COUNT_COUNTRIES = ['UGANDA'] as const;
const RECENT_CATEGORY_SLUGS = ['motors', 'electronics', 'property', 'fashion'] as const;
const ROW_TARGET = 6;

router.get('/section-counts', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const config = await getSiteConfig();
    const allDeals = ((config.todaysDeals as unknown[]) || []) as Array<{ countries?: string[]; expiresAt?: string | null }>;

    const sections: Record<string, Record<string, number>> = {
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
      const placementWhereBase = { status: 'ACTIVE' as const, country: country as 'UGANDA', placementExpiresAt: { gt: now } };

      const [flash, latest, featured, other] = await Promise.all([
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'FLASH_SALE' } }),
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'LATEST_COLLECTIONS' } }),
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'FEATURED_DEAL' } }),
        prisma.listing.count({ where: { status: 'ACTIVE', country: country as 'UGANDA' } }),
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
        const count = await prisma.listing.count({
          where: {
            status: 'ACTIVE',
            country: country as 'UGANDA',
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
  } catch (err) {
    next(err);
  }
});

// POST /admin/section-counts/auto-fill — bring a placement-driven row (Flash
// Sale, Latest Collections, or Featured Deal) up to 6 items for one country
// by assigning that placement to real, currently-unplaced ACTIVE listings —
// never fabricates listings. Sets a genuine 30-day (DEFAULT_PLACEMENT_DAYS) placementExpiresAt (see
// the fix note on PATCH /listings/:id/placement) so filled listings actually
// appear, rather than silently saving with a null expiry.
router.post('/section-counts/auto-fill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { section, country } = req.body as { section?: string; country?: string };
    const validSections = ['FLASH_SALE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL'] as const;
    if (!section || !validSections.includes(section as typeof validSections[number])) {
      return next(createError(`section must be one of: ${validSections.join(', ')}`, 400));
    }
    if (!country || !SECTION_COUNT_COUNTRIES.includes(country as typeof SECTION_COUNT_COUNTRIES[number])) {
      return next(createError(`country must be one of: ${SECTION_COUNT_COUNTRIES.join(', ')}`, 400));
    }

    const now = new Date();
    const placement = section as Placement;
    const countryTyped = country as 'UGANDA';

    const currentCount = await prisma.listing.count({
      where: { status: 'ACTIVE', country: countryTyped, placement, placementExpiresAt: { gt: now } },
    });
    const needed = Math.max(0, ROW_TARGET - currentCount);

    if (needed === 0) {
      return res.json({ updated: 0, newCount: currentCount, message: 'Already has 6 or more items — no changes made.' });
    }

    // Flash Sale has a platform-wide cap of 100 (mirrors the existing cap
    // enforced in PUT /admin/listings/:id and PUT /admin/listings/:id/approve).
    if (placement === 'FLASH_SALE') {
      const totalFlash = await prisma.listing.count({ where: { placement: 'FLASH_SALE' } });
      if (totalFlash >= 100) {
        return next(createError('Flash Deals are limited to 100 listings platform-wide. Remove some before auto-filling more.', 400));
      }
    }

    // Pick unplaced ACTIVE listings in this country, most recent first.
    const candidates = await prisma.listing.findMany({
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

    const placementExpiresAt = new Date(Date.now() + DEFAULT_PLACEMENT_MS);
    await prisma.listing.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { placement, placementExpiresAt },
    });

    res.json({ updated: candidates.length, newCount: currentCount + candidates.length });
  } catch (err) {
    next(err);
  }
});

// ─── Homepage section layout (order, visibility, titles, custom collections) ──
// Powers the "Sections" tab of /admin/homepage-layout. The public page reads it from GET /api/home-layout.
router.get('/home-layout/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const layout = await loadHomeLayout();
    res.json({ layout, builtIns: BUILT_IN_SECTIONS, limits: { collections: MAX_COLLECTIONS, items: MAX_COLLECTION_ITEMS } });
  } catch (err) {
    next(err);
  }
});

router.put('/home-layout/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { order?: unknown; settings?: unknown; collections?: unknown };
    if (!body || typeof body !== 'object' || !Array.isArray(body.order) || !Array.isArray(body.collections)) {
      throw createError('order and collections are required', 400);
    }
    if (body.collections.length > MAX_COLLECTIONS) throw createError(`You can have at most ${MAX_COLLECTIONS} custom collections`, 400);
    const layout = normalizeHomeLayout(body);
    // Category / listing references must exist, otherwise the row would silently show nothing.
    for (const c of layout.collections) {
      if (c.source.type === 'category') {
        const exists = await prisma.category.findUnique({ where: { slug: c.source.slug }, select: { id: true } });
        if (!exists) throw createError(`Collection "${c.title}": category "${c.source.slug}" does not exist`, 400);
      }
    }
    await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, homeLayout: layout as unknown as Prisma.InputJsonValue },
      update: { homeLayout: layout as unknown as Prisma.InputJsonValue },
    });
    invalidateHomeLayoutCache();
    res.json({ layout });
  } catch (err) {
    next(err);
  }
});

// ─── Homepage Layout (pin / arrange rows) ────────────────────────────────────
// Powers /admin/homepage-layout. Each section lists exactly what the public
// row shows, in the same order the public endpoint uses (pinned first, then
// the row's normal ordering), so what the admin sees is what visitors get.
// Pinning writes Listing.pinOrder / Store.pinOrder (lower = first, null =
// unpinned); see PIN_FIRST in routes/listings.ts and GET /stores.
const LAYOUT_SECTIONS = ['FLASH_SALE', 'FEATURED_DEAL', 'LATEST_COLLECTIONS', 'BACK_TO_SCHOOL', 'STORES'] as const;
type LayoutSection = typeof LAYOUT_SECTIONS[number];
const LAYOUT_PIN_FIRST = { pinOrder: { sort: 'asc', nulls: 'last' } } as const;
const LAYOUT_TIER_RANK: Record<string, number> = { FREE: 0, GOLD: 1, PLATINUM: 2 };

function parsePinOrder(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw createError('pinOrder must be a whole number from 1 to 100000, or null to unpin', 400);
  return n;
}

router.get('/homepage-layout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = String(req.query.section || '') as LayoutSection;
    if (!LAYOUT_SECTIONS.includes(section)) {
      throw createError(`section must be one of: ${LAYOUT_SECTIONS.join(', ')}`, 400);
    }
    const now = new Date();

    if (section === 'STORES') {
      const stores = await prisma.store.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, slug: true, logo: true, pinOrder: true, createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
        take: 2000,
      });
      const rentals = await prisma.storeRental.findMany({
        where: { userId: { in: stores.map((st) => st.user.id) }, status: 'ACTIVE', endDate: { gt: now } },
        select: { userId: true, tier: true },
      });
      const tierByUser = new Map<string, string>();
      for (const r of rentals) {
        if ((LAYOUT_TIER_RANK[r.tier] ?? 0) >= (LAYOUT_TIER_RANK[tierByUser.get(r.userId) ?? 'FREE'] ?? 0)) tierByUser.set(r.userId, r.tier);
      }
      const items = stores
        .map((st) => ({ ...st, tier: tierByUser.get(st.user.id) ?? 'FREE' }))
        .sort((a, b) => {
          const pa = a.pinOrder ?? Number.MAX_SAFE_INTEGER;
          const pb = b.pinOrder ?? Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          const ta = LAYOUT_TIER_RANK[a.tier] ?? 0;
          const tb = LAYOUT_TIER_RANK[b.tier] ?? 0;
          if (ta !== tb) return tb - ta;
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, 100)
        .map((st) => ({
          id: st.id, kind: 'store' as const, title: st.name, image: st.logo, tier: st.tier,
          pinOrder: st.pinOrder, owner: st.user.name || st.user.email, slug: st.slug,
        }));
      res.json({ section, items });
      return;
    }

    const where: Prisma.ListingWhereInput =
      section === 'LATEST_COLLECTIONS'
        ? {
            status: 'ACTIVE',
            OR: [
              { placement: 'LATEST_COLLECTIONS', placementExpiresAt: { gt: now } },
              { tier: { in: ['GOLD', 'PLATINUM'] }, OR: [{ tierExpiresAt: null }, { tierExpiresAt: { gt: now } }] },
            ],
          }
        : { status: 'ACTIVE', placement: section, placementExpiresAt: { gt: now } };

    const listings = await prisma.listing.findMany({
      where,
      select: {
        id: true, title: true, tier: true, pinOrder: true, placement: true, placementExpiresAt: true, price: true, images: true,
        user: { select: { name: true, email: true } },
        productImages: { select: { cdnUrl: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
      },
      orderBy: section === 'LATEST_COLLECTIONS'
        ? [LAYOUT_PIN_FIRST, { tier: 'desc' }, { updatedAt: 'desc' }]
        : [LAYOUT_PIN_FIRST, { updatedAt: 'desc' }],
      take: 100,
    });
    res.json({
      section,
      items: listings.map((l) => ({
        id: l.id, kind: 'listing' as const, title: l.title, image: l.productImages[0]?.cdnUrl || l.images?.[0] || null,
        tier: l.tier, pinOrder: l.pinOrder, placement: l.placement, placementExpiresAt: l.placementExpiresAt,
        owner: l.user?.name || l.user?.email || '', price: l.price,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/homepage-layout/order — { section, ids: [...] }
// Pins the given items in exactly that order (1 = first). Items not listed
// are left as they are.
router.put('/homepage-layout/order', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { section, ids } = req.body as { section?: string; ids?: unknown };
    if (!section || !LAYOUT_SECTIONS.includes(section as LayoutSection)) {
      throw createError(`section must be one of: ${LAYOUT_SECTIONS.join(', ')}`, 400);
    }
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || ids.some((i) => typeof i !== 'string')) {
      throw createError('ids must be a non-empty array of up to 200 ids', 400);
    }
    const list = ids as string[];
    if (section === 'STORES') {
      await prisma.$transaction(list.map((id, i) => prisma.store.update({ where: { id }, data: { pinOrder: i + 1 } })));
    } else {
      await prisma.$transaction(list.map((id, i) => prisma.listing.update({ where: { id }, data: { pinOrder: i + 1 } })));
    }
    res.json({ ok: true, pinned: list.length });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/listings/:id/pin — { pinOrder: number | null }
router.put('/listings/:id/pin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pinOrder = parsePinOrder((req.body as { pinOrder?: unknown }).pinOrder);
    const listing = await prisma.listing.update({ where: { id: req.params.id }, data: { pinOrder }, select: { id: true, pinOrder: true } });
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// PUT /admin/stores/:id/pin — { pinOrder: number | null }
router.put('/stores/:id/pin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pinOrder = parsePinOrder((req.body as { pinOrder?: unknown }).pinOrder);
    const store = await prisma.store.update({ where: { id: req.params.id }, data: { pinOrder }, select: { id: true, pinOrder: true } });
    res.json(store);
  } catch (err) {
    next(err);
  }
});

// ─── Social Links ──────────────────────────────────────────────────────────────

router.get('/social-links', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const links = await prisma.socialLinks.findUnique({ where: { id: 'global' } });
    res.json(links || { id: 'global', facebook: null, instagram: null, linkedin: null, x: null, whatsapp: null, youtube: null, tiktok: null });
  } catch (err) {
    next(err);
  }
});

router.put('/social-links', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { facebook, instagram, linkedin, x, whatsapp, youtube, tiktok } = req.body;
    const links = await prisma.socialLinks.upsert({
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
  } catch (err) {
    next(err);
  }
});

// ─── Image Moderation ──────────────────────────────────────────────────────────

router.get('/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const status = (req.query.status as string || 'PENDING').toUpperCase();
    const sellerId = req.query.sellerId as string | undefined;

    const where: Record<string, unknown> = { status };
    if (sellerId) where.sellerId = sellerId;

    const [images, total] = await Promise.all([
      prisma.productImage.findMany({
        where,
        include: {
          seller: { select: { id: true, name: true, email: true } },
          listing: { select: { id: true, title: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.productImage.count({ where }),
    ]);

    const imagesWithUrls = images.map((img) => ({
      ...img,
      previewUrl: img.cdnUrl || (img.tempPath ? `/uploads/temp/${img.tempPath}` : null),
    }));

    res.json({ images: imagesWithUrls, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/images/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const image = await prisma.productImage.findUnique({
      where: { id: req.params.id },
      include: { seller: { select: { name: true, personalId: true } } },
    });
    if (!image) throw createError('Image not found', 404);
    if (image.status !== 'PENDING') throw createError('Image is not pending review', 400);

    let cdnUrl: string;

    if (image.cdnUrl) {
      // Just use the existing CDN URL and mark as approved without re-uploading.
      cdnUrl = image.cdnUrl;
    } else {
      const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
      if (!fs.existsSync(tempFilePath)) {
        throw createError('Temporary file not found; it may have already been processed', 404);
      }

      try {
        cdnUrl = await uploadToCDN(tempFilePath, image.tempPath);
      } catch (cdnErr) {
        throw createError(`CDN upload failed: ${(cdnErr as Error).message}`, 502);
      }

      // Delete temp file after CDN upload.
      try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
    }

    const updated = await prisma.productImage.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        cdnUrl,
        reviewedAt: new Date(),
        reviewedBy: req.user!.userId,
      },
    });

    // Update the listing's images array: replace temp preview URL with CDN URL if needed.
    // With the new upload flow the listing already has the CDN URL; avoid duplicating it.
    if (image.listingId) {
      const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
      if (listing) {
        const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
        const hasTempUrl = listing.images.includes(tempPreviewUrl);
        const hasCdnUrl = listing.images.includes(cdnUrl);
        if (hasTempUrl) {
          // Replace legacy temp URL with CDN URL
          await prisma.listing.update({
            where: { id: image.listingId },
            data: { images: listing.images.map((u) => (u === tempPreviewUrl ? cdnUrl : u)) },
          });
        } else if (!hasCdnUrl) {
          // CDN URL not yet in listing (edge case) – add it
          await prisma.listing.update({
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
      if (!image.sellerId) return;
      const seller = await prisma.user.findUnique({ where: { id: image.sellerId }, select: { email: true, name: true } });
      if (!seller) return;
      const listing = image.listingId
        ? await prisma.listing.findUnique({ where: { id: image.listingId }, select: { title: true } })
        : null;
      sendImageApprovedEmail(seller.email, seller.name, listing?.title).catch((err) =>
        logger.error(`Image approval email failed for ${seller.email}: ${String(err)}`)
      );
    };
    setImmediate(() => { notifyApproved().catch((err) => logger.error('notifyApproved error:', String(err))); });
  } catch (err) {
    next(err);
  }
});

router.put('/images/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const image = await prisma.productImage.findUnique({ where: { id: req.params.id } });
    if (!image) throw createError('Image not found', 404);
    if (image.status !== 'PENDING') throw createError('Image is not pending review', 400);

    // Delete temp file.
    const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
    try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }

    const updated = await prisma.productImage.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedBy: req.user!.userId,
        rejectionReason: reason || null,
      },
    });

    // Remove the image URL(s) from the listing's images array.
    // The image may have been uploaded to CDN already (new flow) or still be a temp URL (legacy).
    if (image.listingId) {
      const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
      if (listing) {
        const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
        const urlsToRemove = new Set([tempPreviewUrl]);
        if (image.cdnUrl) urlsToRemove.add(image.cdnUrl);
        await prisma.listing.update({
          where: { id: image.listingId },
          data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
        });
      }
    }

    res.json(updated);

    // Notify the seller fully asynchronously after the response is flushed.
    const notifyRejected = async () => {
      if (!image.sellerId) return;
      const seller = await prisma.user.findUnique({ where: { id: image.sellerId }, select: { email: true, name: true } });
      if (!seller) return;
      const listing = image.listingId
        ? await prisma.listing.findUnique({ where: { id: image.listingId }, select: { title: true } })
        : null;
      sendImageRejectedEmail(seller.email, seller.name, reason || undefined, listing?.title).catch((err) =>
        logger.error(`Image rejection email failed for ${seller.email}: ${String(err)}`)
      );
    };
    setImmediate(() => { notifyRejected().catch((err) => logger.error('notifyRejected error:', String(err))); });
  } catch (err) {
    next(err);
  }
});

router.put('/images/bulk', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ids, action, reason } = req.body as { ids: string[]; action: 'approve' | 'reject' | 'delete'; reason?: string };
    if (!Array.isArray(ids) || ids.length === 0) throw createError('ids array is required', 400);
    if (!['approve', 'reject', 'delete'].includes(action)) throw createError('action must be approve, reject, or delete', 400);

    const adminUserId = req.user!.userId;

    const processOne = async (id: string): Promise<{ id: string; success: boolean; error?: string }> => {
      const image = await prisma.productImage.findUnique({
        where: { id },
        include: { seller: { select: { name: true, personalId: true } } },
      });
      if (!image) {
        return { id, success: false, error: 'Not found' };
      }

      if (action === 'delete') {
        // Remove from listing images array
        if (image.listingId) {
          const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
          if (listing) {
            const tempPreviewUrl = image.tempPath ? `/uploads/temp/${image.tempPath}` : null;
            const urlsToRemove = new Set<string>();
            if (tempPreviewUrl) urlsToRemove.add(tempPreviewUrl);
            if (image.cdnUrl) urlsToRemove.add(image.cdnUrl);
            await prisma.listing.update({
              where: { id: image.listingId },
              data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
            });
          }
        }
        // Delete temp file best-effort
        if (image.tempPath) {
          const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
          try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
        }
        await prisma.productImage.delete({ where: { id } });
        return { id, success: true };
      }

      if (image.status !== 'PENDING') {
        return { id, success: false, error: 'Not found or not pending' };
      }

      if (action === 'approve') {
        let cdnUrl: string;

        if (image.cdnUrl) {
          // Image already uploaded to CDN during initial upload step; reuse the URL.
          cdnUrl = image.cdnUrl;
        } else {
          const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
          if (!fs.existsSync(tempFilePath)) {
            return { id, success: false, error: 'Temp file missing' };
          }

          cdnUrl = await uploadToCDN(tempFilePath, image.tempPath);
          try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
        }

        await prisma.productImage.update({
          where: { id },
          data: { status: 'APPROVED', cdnUrl, reviewedAt: new Date(), reviewedBy: adminUserId },
        });
        if (image.listingId) {
          const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
          if (listing) {
            const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
            const hasTempUrl = listing.images.includes(tempPreviewUrl);
            const hasCdnUrl = listing.images.includes(cdnUrl);
            if (hasTempUrl) {
              await prisma.listing.update({
                where: { id: image.listingId },
                data: { images: listing.images.map((u) => (u === tempPreviewUrl ? cdnUrl : u)) },
              });
            } else if (!hasCdnUrl) {
              await prisma.listing.update({ where: { id: image.listingId }, data: { images: [...listing.images, cdnUrl] } });
            }
          }
        }
      } else {
        const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
        try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
        await prisma.productImage.update({
          where: { id },
          data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: adminUserId, rejectionReason: reason || null },
        });
        if (image.listingId) {
          const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
          if (listing) {
            const tempPreviewUrl = `/uploads/temp/${image.tempPath}`;
            const urlsToRemove = new Set([tempPreviewUrl]);
            if (image.cdnUrl) urlsToRemove.add(image.cdnUrl);
            await prisma.listing.update({
              where: { id: image.listingId },
              data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
            });
          }
        }
      }

      return { id, success: true };
    };

    const settled = await Promise.allSettled(ids.map(processOne));
    const results = settled.map((s) =>
      s.status === 'fulfilled'
        ? s.value
        : { id: 'unknown', success: false, error: (s.reason as Error).message },
    );

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.delete('/images/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const image = await prisma.productImage.findUnique({ where: { id: req.params.id } });
    if (!image) throw createError('Image not found', 404);

    // Remove image URL(s) from the associated listing
    if (image.listingId) {
      const listing = await prisma.listing.findUnique({ where: { id: image.listingId } });
      if (listing) {
        const tempPreviewUrl = image.tempPath ? `/uploads/temp/${image.tempPath}` : null;
        const urlsToRemove = new Set<string>();
        if (tempPreviewUrl) urlsToRemove.add(tempPreviewUrl);
        if (image.cdnUrl) urlsToRemove.add(image.cdnUrl);
        await prisma.listing.update({
          where: { id: image.listingId },
          data: { images: listing.images.filter((u) => !urlsToRemove.has(u)) },
        });
      }
    }

    // Delete the temp file best-effort
    if (image.tempPath) {
      const tempFilePath = path.join(process.cwd(), 'uploads', 'temp', image.tempPath);
      try { fs.unlinkSync(tempFilePath); } catch { /* best-effort */ }
    }

    await prisma.productImage.delete({ where: { id: req.params.id } });
    res.json({ message: 'Image deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Review Moderation ─────────────────────────────────────────────────────────

router.get('/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const status = (req.query.status as string || 'PENDING').toUpperCase();

    const where: Record<string, unknown> = { status };

    const [reviews, total] = await Promise.all([
      prisma.productReview.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          listing: { select: { id: true, title: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.productReview.count({ where }),
    ]);

    res.json({ reviews, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/reviews/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const review = await prisma.productReview.findUnique({ where: { id: req.params.id } });
    if (!review) throw createError('Review not found', 404);
    if (review.status !== 'PENDING') throw createError('Review is not pending', 400);

    const updated = await prisma.productReview.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', rejectionReason: null },
      include: {
        user: { select: { id: true, name: true, email: true } },
        listing: { select: { id: true, title: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.put('/reviews/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const review = await prisma.productReview.findUnique({ where: { id: req.params.id } });
    if (!review) throw createError('Review not found', 404);
    if (review.status !== 'PENDING') throw createError('Review is not pending', 400);

    const updated = await prisma.productReview.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectionReason: reason || null },
      include: {
        user: { select: { id: true, name: true, email: true } },
        listing: { select: { id: true, title: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Transaction History ────────────────────────────────────────────────────────
// Unifies the otherwise-separate platform-revenue tables into one admin view:
// StoreRental (store
// fees), SellerSubscription (subscription payments), and CvDownloadToken
// (CV download purchases). There is no single "Transaction" table in the
// schema — building one and migrating five tables of financial history onto
// it would be a major, high-risk schema change, so instead this reads each
// source table with its own filters and normalizes the results into one
// shape in application code (typed, easy-to-review Prisma queries, matching
// every other admin list endpoint in this file — no raw SQL).
//
// Trade-off, stated plainly: when no `type` filter narrows the request to a
// single source, all five tables are queried and merged/sorted/paginated in
// memory (each capped at TRANSACTION_UNFILTERED_PER_SOURCE_CAP rows). This
// keeps every query fully typed and independently testable, at the cost of
// not scaling to unbounded row counts the way a single indexed table with
// server-side pagination would. Fine for a marketplace admin dashboard at
// current scale; if transaction volume grows enough for this to matter, the
// root-cause fix is a dedicated ledger table (e.g. written to at the same
// time as each of these five records) rather than optimizing this reader.

// MOMO_PAYMENT rows come from PaymentTransaction — the only source of money actually received over
// MTN MoMo. The other three are application RECORDS (what a store/subscription/download was quoted
// at); `isQuote` marks the ones that have not been paid, so they are never read as revenue.
type TransactionType = 'SUBSCRIPTION' | 'STORE_FEE' | 'CV_DOWNLOAD' | 'MOMO_PAYMENT';

interface TransactionRow {
  id: string;            // prefixed by source so ids never collide across tables, e.g. "payment:abc123"
  type: TransactionType;
  date: string;           // ISO — the moment this specific row represents (paid/refunded/processed/created)
  amount: number;
  currency: string;
  status: string;         // the underlying record's own status enum value, passed through as-is (see block comment above the route below for why this isn't normalized to one taxonomy)
  method: string | null;
  reference: string | null;
  description: string;
  userId: string | null;
  userName: string;
  userEmail: string | null;
  /** true when this row is an unpaid quote/request rather than received money. */
  isQuote?: boolean;
}

const TRANSACTION_UNFILTERED_PER_SOURCE_CAP = 300;
const TRANSACTION_EXPORT_CAP = 5000;

interface TransactionFilters {
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  status?: string;
  search?: string; // matched against user name/email, case-insensitive
  limit: number; // per-source cap when fetching for the merged view; a real hard cap when a single `type` is requested
  /** Set by a fetcher when its source returned `limit` rows, i.e. older rows were cut off. */
  truncated?: boolean;
}

function amountInRange(amount: number, f: TransactionFilters): boolean {
  if (f.minAmount !== undefined && amount < f.minAmount) return false;
  if (f.maxAmount !== undefined && amount > f.maxAmount) return false;
  return true;
}

async function fetchStoreFeeTransactions(f: TransactionFilters): Promise<TransactionRow[]> {
  const where: Record<string, unknown> = {
    ...((f.dateFrom || f.dateTo) && { createdAt: { ...(f.dateFrom && { gte: f.dateFrom }), ...(f.dateTo && { lte: f.dateTo }) } }),
    ...(f.status && { status: f.status }),
    ...(f.search && {
      user: { OR: [{ name: { contains: f.search, mode: 'insensitive' } }, { email: { contains: f.search, mode: 'insensitive' } }] },
    }),
  };

  const rentals = await prisma.storeRental.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  if (rentals.length >= f.limit) f.truncated = true;

  return rentals
    .filter((r) => amountInRange(r.fee, f))
    .map((r) => ({
      id: `rental:${r.id}`,
      type: 'STORE_FEE' as const,
      date: r.createdAt.toISOString(),
      amount: r.fee,
      currency: r.currency,
      status: r.status,
      method: null,
      reference: r.id,
      description: `Store rental fee (${r.entityType.toLowerCase()})`,
      isQuote: r.fee > 0 && (r.placements as { paymentStatus?: string } | null)?.paymentStatus !== 'CONFIRMED',
      userId: r.user.id,
      userName: r.user.name,
      userEmail: r.user.email,
    }));
}

async function fetchSubscriptionTransactions(f: TransactionFilters): Promise<TransactionRow[]> {
  const where: Record<string, unknown> = {
    ...((f.dateFrom || f.dateTo) && { createdAt: { ...(f.dateFrom && { gte: f.dateFrom }), ...(f.dateTo && { lte: f.dateTo }) } }),
    ...(f.status && { status: f.status }),
    ...(f.search && {
      user: { OR: [{ name: { contains: f.search, mode: 'insensitive' } }, { email: { contains: f.search, mode: 'insensitive' } }] },
    }),
  };

  const subscriptions = await prisma.sellerSubscription.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      package: { select: { name: true, price: true, currency: true, durationDays: true, maxListings: true, isFree: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  if (subscriptions.length >= f.limit) f.truncated = true;

  return subscriptions
    // The price the customer agreed to when they requested the term (snapshot). Rows created before
    // snapshots existed were backfilled from their package by the migration; any that still have no
    // snapshot fall back to the package's current price.
    .map((s) => ({ s, t: termsOf(s) }))
    .filter(({ t }) => amountInRange(t.price, f))
    .map(({ s, t }) => ({
      id: `subscription:${s.id}`,
      type: 'SUBSCRIPTION' as const,
      date: s.createdAt.toISOString(),
      amount: t.price,
      currency: t.currency,
      status: s.status,
      method: null,
      reference: s.paymentRef || s.id,
      description: `Subscription: ${t.packageName}`,
      isQuote: s.status === 'PENDING_PAYMENT',
      userId: s.user.id,
      userName: s.user.name,
      userEmail: s.user.email,
    }));
}

async function fetchCvDownloadTransactions(f: TransactionFilters): Promise<TransactionRow[]> {
  const where: Record<string, unknown> = {
    ...((f.dateFrom || f.dateTo) && { createdAt: { ...(f.dateFrom && { gte: f.dateFrom }), ...(f.dateTo && { lte: f.dateTo }) } }),
    ...(f.search && {
      OR: [
        { user: { OR: [{ name: { contains: f.search, mode: 'insensitive' } }, { email: { contains: f.search, mode: 'insensitive' } }] } },
        { holderName: { contains: f.search, mode: 'insensitive' } },
        { holderEmail: { contains: f.search, mode: 'insensitive' } },
      ],
    }),
  };

  const tokens = await prisma.cvDownloadToken.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  if (tokens.length >= f.limit) f.truncated = true;

  const rows: TransactionRow[] = [];
  for (const t of tokens) {
    const status = t.paid ? 'COMPLETED' : 'PENDING';
    if (f.status && f.status !== status) continue;
    const amount = Number(t.amount); // Prisma Decimal -> number for the unified numeric shape
    if (!amountInRange(amount, f)) continue;
    rows.push({
      id: `cv:${t.id}`,
      type: 'CV_DOWNLOAD',
      date: t.createdAt.toISOString(),
      amount,
      currency: t.currency,
      status,
      method: null,
      reference: t.id,
      // Guest downloads (no account) still capture the name/email typed
      // into the CV builder at download time — used here so a guest
      // transaction isn't just an anonymous blank row.
      description: 'CV download',
      isQuote: !t.paid,
      userId: t.user?.id || null,
      userName: t.user?.name || t.holderName || 'Guest',
      userEmail: t.user?.email || t.holderEmail || null,
    });
  }
  return rows;
}

const MOMO_PURPOSE_LABEL: Record<string, string> = {
  SUBSCRIPTION: 'Subscription', SUBSCRIPTION_RENEWAL: 'Subscription renewal', SUBSCRIPTION_UPGRADE: 'Subscription upgrade',
  STORE_RENTAL: 'Store rental', STORE_RENEWAL: 'Store renewal', LISTING_TIER: 'Listing visibility tier', CV_DOWNLOAD: 'CV download',
};

// Money actually collected over MTN MoMo (every status is shown, so failed/refunded/needs-review are visible too).
async function fetchMomoTransactions(f: TransactionFilters): Promise<TransactionRow[]> {
  let userIds: string[] | undefined;
  if (f.search) {
    const users = await prisma.user.findMany({
      where: { OR: [{ name: { contains: f.search, mode: 'insensitive' } }, { email: { contains: f.search, mode: 'insensitive' } }] },
      select: { id: true }, take: 200,
    });
    userIds = users.map((u) => u.id);
  }
  const payments = await prisma.paymentTransaction.findMany({
    where: {
      ...((f.dateFrom || f.dateTo) && { createdAt: { ...(f.dateFrom && { gte: f.dateFrom }), ...(f.dateTo && { lte: f.dateTo }) } }),
      ...(f.status && { status: f.status as never }),
      ...(userIds && { userId: { in: userIds } }),
    },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  if (payments.length >= f.limit) f.truncated = true;

  const ids = Array.from(new Set(payments.map((p) => p.userId).filter((x): x is string => !!x)));
  const owners = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(owners.map((u) => [u.id, u]));

  return payments
    .map((p) => ({ p, amount: Number(p.amount) }))
    .filter(({ amount }) => amountInRange(amount, f))
    .map(({ p, amount }) => {
      const u = p.userId ? byId.get(p.userId) : undefined;
      return {
        id: `momo:${p.id}`,
        type: 'MOMO_PAYMENT' as const,
        date: p.createdAt.toISOString(),
        amount,
        currency: p.currency,
        status: p.status,
        method: p.provider,
        reference: p.referenceId,
        description: `MoMo: ${MOMO_PURPOSE_LABEL[p.purpose] ?? p.purpose}`,
        userId: p.userId,
        userName: u?.name || 'Guest',
        userEmail: u?.email || null,
      };
    });
}

const TRANSACTION_FETCHERS: Record<TransactionType, (f: TransactionFilters) => Promise<TransactionRow[]>> = {
  STORE_FEE: fetchStoreFeeTransactions,
  SUBSCRIPTION: fetchSubscriptionTransactions,
  CV_DOWNLOAD: fetchCvDownloadTransactions,
  MOMO_PAYMENT: fetchMomoTransactions,
};

async function resolveTransactions(req: Request, limitPerSource: number): Promise<{ rows: TransactionRow[]; truncated: boolean }> {
  const typeParam = req.query.type as string | undefined;
  const filters: TransactionFilters = {
    dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
    dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
    minAmount: req.query.minAmount !== undefined ? Number(req.query.minAmount) : undefined,
    maxAmount: req.query.maxAmount !== undefined ? Number(req.query.maxAmount) : undefined,
    status: (req.query.status as string) || undefined,
    search: (req.query.search as string) || undefined,
    limit: limitPerSource,
  };
  if (filters.dateFrom && Number.isNaN(filters.dateFrom.getTime())) filters.dateFrom = undefined;
  if (filters.dateTo && Number.isNaN(filters.dateTo.getTime())) filters.dateTo = undefined;
  if (filters.minAmount !== undefined && Number.isNaN(filters.minAmount)) filters.minAmount = undefined;
  if (filters.maxAmount !== undefined && Number.isNaN(filters.maxAmount)) filters.maxAmount = undefined;

  const types: TransactionType[] = typeParam && typeParam in TRANSACTION_FETCHERS
    ? [typeParam as TransactionType]
    : ['MOMO_PAYMENT', 'STORE_FEE', 'SUBSCRIPTION', 'CV_DOWNLOAD'];

  // Dedupe fetchers — PURCHASE and REFUND share one function (a single
  // Payment table scan yields both row kinds), so calling it once covers
  // both even if a caller somehow requested both types together.
  const uniqueFetchers = Array.from(new Set(types.map((t) => TRANSACTION_FETCHERS[t])));
  const results = await Promise.all(uniqueFetchers.map((fn) => fn(filters)));
  let rows = results.flat();

  // If a specific single type was requested, drop the sibling type the
  // shared fetcher also produced (e.g. `type=PURCHASE` should not also
  // surface REFUND rows, and vice versa).
  if (typeParam && typeParam in TRANSACTION_FETCHERS) {
    rows = rows.filter((r) => r.type === typeParam);
  }

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { rows, truncated: Boolean(filters.truncated) };
}

router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePaging(req.query);
    const typeParam = req.query.type as string | undefined;

    // When a single type is requested, a generous cap comfortably covers
    // "page N of that one table" without needing DB-level pagination per
    // source; when merging all sources, each is capped independently (see
    // the block comment above) before the combined, sorted list is sliced
    // for the requested page.
    const perSourceCap = typeParam ? Math.max(limit * page + limit, 200) : TRANSACTION_UNFILTERED_PER_SOURCE_CAP;
    const { rows: all, truncated } = await resolveTransactions(req, perSourceCap);

    const total = all.length;
    const start = (page - 1) * limit;
    const transactions = all.slice(start, start + limit);

    res.json({ transactions, truncated, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: all, truncated } = await resolveTransactions(req, TRANSACTION_EXPORT_CAP);

    const header = ['Date', 'Type', 'Description', 'User Name', 'User Email', 'Amount', 'Currency', 'Status', 'Method', 'Reference', 'Unpaid quote'];
    const escapeCsv = (raw: string) => {
      // Neutralise spreadsheet formula injection: a text cell starting with = + - @ (or tab/CR)
      // is executed by Excel/Sheets. User-controlled names/descriptions end up in this export.
      // Plain numbers (including negatives) are left alone so amounts stay numeric.
      const value = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
      // Quote whenever the field could otherwise be misread (comma, quote,
      // or newline), doubling any embedded quotes — standard CSV escaping.
      if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };
    const lines = [
      header.join(','),
      ...all.map((t) =>
        [
          t.date,
          t.type,
          t.description,
          t.userName,
          t.userEmail || '',
          String(t.amount),
          t.currency,
          t.status,
          t.method || '',
          t.reference || '',
          t.isQuote ? 'yes' : '',
        ].map((v) => escapeCsv(String(v))).join(',')
      ),
    ];

    if (truncated) res.setHeader('X-Export-Truncated', 'true'); // older rows beyond the per-source cap are NOT in this file
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

// ─── Seller Packages Management ───────────────────────────────────────────────

router.get('/packages', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = parseScope(_req.query.scope as string | undefined);

    const packages = await prisma.sellerPackage.findMany({
      where: { scope },
      orderBy: [{ isFree: 'desc' }, { price: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    res.json({ packages });
  } catch (err) {
    next(err);
  }
});

// CV-scope packages have no subscription step — the builder always defers to
// a single, currently-governing package. So whenever the admin activates a
// CV package it "overwrites" (i.e. deactivates) any other active CV package,
// rather than letting several compete. Once the admin deactivates/deletes
// all of them, routes/cvPayment.ts falls back to the hard-coded default price.
async function deactivateOtherActiveCvPackages(keepId?: string) {
  await prisma.sellerPackage.updateMany({
    where: { scope: 'CV', isActive: true, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { isActive: false },
  });
}

router.post('/packages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive, storeTier } = req.body;
    const scope = parseScope(scopeInput);
    if (!name) throw createError('name is required', 400);
    if (!durationDays || durationDays < 1) throw createError('durationDays must be at least 1', 400);
    // A package is either Free (ticked, price 0) or paid (price above 0) — never ambiguous.
    if (!isFree && !(parseFloat(price) > 0)) throw createError('A paid package needs a price above 0. Tick "Free" for a free package.', 400);
    const tier = parseStoreTier(scope, storeTier);

    const willBeActive = isActive !== false;

    const pkg = await prisma.sellerPackage.create({
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
        storeTier: tier,
      },
    });

    if (scope === 'CV' && willBeActive) {
      await deactivateOtherActiveCvPackages(pkg.id);
    }

    res.status(201).json({ package: pkg });
  } catch (err) {
    next(err);
  }
});

// Editing a package changes what NEW subscribers get. Existing subscriptions keep the terms they
// were requested under (see the snapshot columns on SellerSubscription), so an edit can never
// silently shorten, reprice or cap someone's running plan.
router.put('/packages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive, storeTier } = req.body;
    const scope = scopeInput !== undefined ? parseScope(scopeInput) : undefined;

    const existing = await prisma.sellerPackage.findUnique({ where: { id: req.params.id }, include: { _count: { select: { subscriptions: true } } } });
    if (!existing) throw createError('Package not found', 404);
    if (scope !== undefined && scope !== existing.scope && existing._count.subscriptions > 0) {
      throw createError('This package already has subscribers, so its scope (Listing/CV) cannot change. Create a new package instead.', 409);
    }
    if (name !== undefined && !String(name).trim()) throw createError('name cannot be empty', 400);
    if (durationDays !== undefined && !(parseInt(durationDays) >= 1)) throw createError('durationDays must be at least 1', 400);
    if (price !== undefined && !(parseFloat(price) >= 0)) throw createError('price cannot be negative', 400);
    if (maxListings !== undefined && maxListings && !(parseInt(maxListings) >= 1)) throw createError('maxListings must be at least 1 (leave blank for unlimited)', 400);

    const makingFree = isFree !== undefined ? Boolean(isFree) : existing.isFree;
    const nextPrice = makingFree ? 0 : (price !== undefined ? parseFloat(price) : existing.price);
    if (!makingFree && !(nextPrice > 0)) throw createError('A paid package needs a price above 0. Tick "Free" for a free package.', 400);
    const nextScope = scope ?? (existing.scope as PackageScope);
    const nextTier = storeTier !== undefined || scope !== undefined ? parseStoreTier(nextScope, storeTier ?? existing.storeTier) : undefined;
    const pkg = await prisma.sellerPackage.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(description !== undefined && { description }),
        ...(scope !== undefined && { scope }),
        ...(isFree !== undefined && { isFree: Boolean(isFree) }),
        ...((price !== undefined || isFree !== undefined) && { price: nextPrice }),
        ...(nextTier !== undefined && { storeTier: nextTier }),
        ...(currency !== undefined && { currency }),
        ...(durationDays !== undefined && { durationDays: parseInt(durationDays) }),
        ...(maxListings !== undefined && { maxListings: maxListings ? parseInt(maxListings) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
      include: { _count: { select: { subscriptions: true } } },
    });

    if (pkg.scope === 'CV' && pkg.isActive) {
      await deactivateOtherActiveCvPackages(pkg.id);
    }

    res.json({ package: pkg, appliesTo: 'new subscriptions only', existingSubscribers: pkg._count.subscriptions });
  } catch (err) {
    next(err);
  }
});

// POST /admin/packages/:id/duplicate — start a new (inactive) package from an existing one.
router.post('/packages/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const src = await prisma.sellerPackage.findUnique({ where: { id: req.params.id } });
    if (!src) throw createError('Package not found', 404);
    const copy = await prisma.sellerPackage.create({
      data: {
        name: `${src.name} (copy)`.slice(0, 120), description: src.description, scope: src.scope, isFree: src.isFree,
        price: src.price, currency: src.currency, durationDays: src.durationDays, maxListings: src.maxListings,
        isActive: false, // never goes live (or displaces the live CV package) until the admin reviews it
      },
    });
    res.status(201).json({ package: copy });
  } catch (err) {
    next(err);
  }
});

router.delete('/packages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subs = await prisma.sellerSubscription.count({ where: { packageId: req.params.id } });
    if (subs > 0) {
      // Deleting would orphan (or fail on) real subscription history. Retire it instead.
      throw createError(`This package has ${subs} subscription${subs === 1 ? '' : 's'} on record and cannot be deleted. Deactivate it instead — it disappears from the plans page but existing subscribers are unaffected.`, 409);
    }
    await prisma.sellerPackage.delete({ where: { id: req.params.id } });
    res.json({ message: 'Package deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── CV History ───────────────────────────────────────────────────────────────
// Every time a visitor initiates a CV download (free or paid) via the builder,
// a CvDownloadToken row is created with a snapshot of their core details. This
// lists that history for the admin dashboard.
router.get('/cv-history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const status = req.query.status as string | undefined; // 'paid' | 'unpaid' | 'free'
    const search = (req.query.search as string | undefined)?.trim();

    const where: Record<string, unknown> = {
      ...(status === 'paid'   ? { paid: true, amount: { gt: 0 } } : {}),
      ...(status === 'unpaid' ? { paid: false } : {}),
      ...(status === 'free'   ? { amount: 0 } : {}),
      ...(search ? {
        OR: [
          { holderName:  { contains: search, mode: 'insensitive' } },
          { holderEmail: { contains: search, mode: 'insensitive' } },
          { holderTitle: { contains: search, mode: 'insensitive' } },
          { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const [total, entries] = await Promise.all([
      prisma.cvDownloadToken.count({ where }),
      prisma.cvDownloadToken.findMany({
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
      prisma.cvDownloadToken.count(),
      prisma.cvDownloadToken.count({ where: { paid: true, amount: { gt: 0 } } }),
      prisma.cvDownloadToken.count({ where: { amount: 0, paid: true } }),
      prisma.cvDownloadToken.count({ where: { usedAt: { not: null } } }),
    ]);

    res.json({
      entries,
      total,
      page,
      pages: Math.ceil(total / limit),
      stats: { total: totalCount, paid: paidCount, free: freeCount, downloaded: downloadedCount },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Seller Subscriptions Management ─────────────────────────────────────────

router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const scope = parseScope(req.query.scope as string | undefined);
    const now = new Date();

    // Real-time status filter: an ACTIVE row past its end date counts as EXPIRED right away,
    // whether or not the sweep has flipped it yet (so no write is needed on a GET).
    let statusWhere: Record<string, unknown> = {};
    if (status === 'ACTIVE') statusWhere = { status: 'ACTIVE', endDate: { gt: now } };
    else if (status === 'EXPIRED') statusWhere = { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', endDate: { lte: now } }] };
    else if (status === 'CANCELLED' || status === 'PENDING_PAYMENT') statusWhere = { status };
    else if (status) throw createError('Invalid status filter', 400);

    const where = { ...statusWhere, package: { scope } };

    const [total, rows] = await Promise.all([
      prisma.sellerSubscription.count({ where }),
      prisma.sellerSubscription.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, personalId: true } },
          package: { select: { id: true, name: true, scope: true, isFree: true, price: true, currency: true, durationDays: true, maxListings: true, isActive: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // For upgrades/renewals, name the plan being replaced so the approver sees the whole change.
    const replacesIds = Array.from(new Set(rows.map((r) => r.replacesId).filter((v): v is string => !!v)));
    const replacedRows = replacesIds.length
      ? await prisma.sellerSubscription.findMany({ where: { id: { in: replacesIds } }, include: { package: true } })
      : [];
    const replacedById = new Map(replacedRows.map((r) => [r.id, r]));

    const subscriptions = rows.map((s) => {
      const old = s.replacesId ? replacedById.get(s.replacesId) : undefined;
      return {
        ...s,
        status: effectiveStatus(s, now),
        storedStatus: s.status,
        daysRemaining: effectiveStatus(s, now) === 'ACTIVE' ? daysRemaining(s.endDate, now) : 0,
        // What the customer actually requested/agreed to (snapshot) — this, not the live package, is what gets approved.
        terms: termsOf(s),
        replaces: old ? { id: old.id, packageName: termsOf(old).packageName, endDate: old.endDate, status: effectiveStatus(old, now) } : null,
      };
    });
    res.json({ subscriptions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/subscriptions/:id — confirm a payment (PENDING_PAYMENT -> ACTIVE), cancel, expire,
// revive, or adjust the end date. Validated against the status machine in
// utils/subscriptionService.ts. NOTE: this no longer touches User.isVerified — that flag is EMAIL
// confirmation (login is refused without it), and clearing it when a paid subscription ended
// locked the customer out of their account.
router.put('/subscriptions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = (req as AuthRequest).user?.userId ?? null;
    const { subscription, activatedNow, replaced, terms } = await adminUpdateSubscription(req.params.id, req.body ?? {}, adminId);
    if (activatedNow) {
      sendSubscriptionActivatedEmail(subscription.user.email, subscription.user.name, terms.packageName, subscription.endDate)
        .catch((err) => logger.error('Failed to send subscription activated email', err));
    }
    res.json({ subscription: { ...subscription, terms }, replaced });
  } catch (err) {
    next(err);
  }
});

// ─── Site Media Management ─────────────────────────────────────────────────────
// Admin can bulk-upload images to specific page sections (hero, banner, etc.)

const VALID_MEDIA_SECTIONS = ['hero', 'banner', 'featured', 'flash', 'collection', 'background', 'category', 'sticky-header', 'brand-logo', 'cv-generator'] as const;

// GET /admin/media?section=hero — list site media (optionally filtered by section)
router.get('/media', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = req.query.section as string | undefined;
    const where = section ? { section } : {};
    const media = await prisma.siteMedia.findMany({
      where,
      orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ media });
  } catch (err) {
    next(err);
  }
});

// POST /admin/media/upload — bulk upload images to a page section
router.post(
  '/media/upload',
  (req: Request, res: Response, next: NextFunction) => {
    mediaUpload.array('images', 50)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        section,
        altText,
        linkUrl,
        title,
        shortDescription,
        price,
        originalPrice,
        currency,
      } = req.body as {
        section?: string;
        altText?: string;
        linkUrl?: string;
        title?: string;
        shortDescription?: string;
        price?: string | number;
        originalPrice?: string | number;
        currency?: string;
      };
      if (!section || !VALID_MEDIA_SECTIONS.includes(section as typeof VALID_MEDIA_SECTIONS[number])) {
        return next(createError(`section must be one of: ${VALID_MEDIA_SECTIONS.join(', ')}`, 400));
      }
      const parsedPrice = price !== undefined && price !== '' ? Number(price) : null;
      const parsedOriginalPrice = originalPrice !== undefined && originalPrice !== '' ? Number(originalPrice) : null;
      if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
        return next(createError('price must be a valid non-negative number', 400));
      }
      if (parsedOriginalPrice !== null && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice < 0)) {
        return next(createError('originalPrice must be a valid non-negative number', 400));
      }
      if (currency && !SUPPORTED_CURRENCIES.includes(currency as Currency)) {
        return next(createError(`currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`, 400));
      }
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return next(createError('No files uploaded', 400));
      }
      if (section === 'brand-logo' && files.length !== 1) {
        return next(createError('Exactly one image may be uploaded for the Site Logo', 400));
      }

      const results: { id: string; cdnUrl: string }[] = [];
      for (const f of files) {
        const tempPath = path.join(mediaTempDir, f.filename);
        let cdnUrl: string;
        try {
          cdnUrl = await uploadToCDN(tempPath, f.filename, `media/${section}`);
        } finally {
          try { fs.unlinkSync(tempPath); } catch { /* best-effort */ }
        }
        // Determine sort order = current max + 1
        const maxOrder = await prisma.siteMedia.count({ where: { section } });
        const record = await prisma.siteMedia.create({
          data: {
            section,
            cdnUrl,
            altText: altText || null,
            linkUrl: linkUrl || null,
            title: title?.trim() || null,
            shortDescription: shortDescription?.trim() || null,
            price: parsedPrice,
            originalPrice: parsedOriginalPrice,
            currency: currency ? currency as Currency : null,
            sortOrder: maxOrder,
            uploadedBy: req.user!.userId,
          },
        });
        if (section === 'brand-logo') {
          await prisma.siteMedia.updateMany({
            where: { section, id: { not: record.id }, isActive: true },
            data: { isActive: false },
          });
        }
        results.push({ id: record.id, cdnUrl });
      }

      res.json({ uploaded: results.length, media: results });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /admin/media/:id — update metadata (altText, sortOrder, isActive)
router.put('/media/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { altText, sortOrder, isActive, linkUrl, title, shortDescription, price, originalPrice, currency } = req.body as {
      altText?: string;
      sortOrder?: number;
      isActive?: boolean;
      linkUrl?: string;
      title?: string;
      shortDescription?: string;
      price?: number | string | null;
      originalPrice?: number | string | null;
      currency?: string | null;
    };
    const parsedPrice = price !== undefined ? (price === null || price === '' ? null : Number(price)) : undefined;
    const parsedOriginalPrice = originalPrice !== undefined
      ? (originalPrice === null || originalPrice === '' ? null : Number(originalPrice))
      : undefined;
    if (parsedPrice !== undefined && parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      return next(createError('price must be a valid non-negative number', 400));
    }
    if (parsedOriginalPrice !== undefined && parsedOriginalPrice !== null && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice < 0)) {
      return next(createError('originalPrice must be a valid non-negative number', 400));
    }
    if (currency !== undefined && currency !== null && currency !== '' && !SUPPORTED_CURRENCIES.includes(currency as Currency)) {
      return next(createError(`currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`, 400));
    }
    const media = await prisma.siteMedia.update({
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
        ...(currency !== undefined && { currency: currency ? currency as Currency : null }),
      },
    });
    res.json({ media });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/media/bulk — remove selected site media entries
router.delete('/media/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return next(createError('ids array is required', 400));
    }
    const result = await prisma.siteMedia.deleteMany({ where: { id: { in: ids } } });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/media/:id — remove a site media entry
router.delete('/media/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.siteMedia.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Interview Demo Video Management ───────────────────────────────────────────

// GET /admin/site-config/interview-video — get current demo video settings
router.get('/site-config/interview-video', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({
      videoUrl: config.interviewDemoVideoUrl || null,
      videoTitle: config.interviewDemoVideoTitle || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/site-config/interview-video — upload a new demo video and save it
router.post(
  '/site-config/interview-video',
  (req: Request, res: Response, next: NextFunction) => {
    videoUpload.single('video')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return next(createError('No video file uploaded', 400));
      }

      const tempFilePath = path.join(mediaTempDir, file.filename);
      let videoUrl: string;
      try {
        videoUrl = await uploadToCDN(tempFilePath, file.filename);
      } finally {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // best-effort cleanup
        }
      }

      const { title } = req.body as { title?: string };
      const config = await prisma.siteConfig.upsert({
        where: { id: SITE_CONFIG_ID },
        create: { id: SITE_CONFIG_ID, interviewDemoVideoUrl: videoUrl, interviewDemoVideoTitle: title?.trim() || null },
        update: { interviewDemoVideoUrl: videoUrl, interviewDemoVideoTitle: title?.trim() || null },
      });

      res.json({
        videoUrl: config.interviewDemoVideoUrl,
        videoTitle: config.interviewDemoVideoTitle,
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /admin/site-config/interview-video — remove the demo video
router.delete('/site-config/interview-video', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID },
      update: { interviewDemoVideoUrl: null, interviewDemoVideoTitle: null },
    });
    res.json({ ok: true, videoUrl: config.interviewDemoVideoUrl });
  } catch (err) {
    next(err);
  }
});

// ─── Homepage Promo Video Management ───────────────────────────────────────────
// Powers the "LIVE NOW / SHOP NOW" video shown beside the homepage hero
// slideshow (PromoSideCards). Mirrors the Interview Demo Video pattern above —
// the frontend shows a branded placeholder only when no video has been uploaded.

// GET /admin/site-config/promo-video — get current promo video settings
router.get('/site-config/promo-video', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({
      videoUrl: config.promoVideoUrl || null,
      videoTitle: config.promoVideoTitle || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/site-config/promo-video — upload a new promo video and save it
router.post(
  '/site-config/promo-video',
  (req: Request, res: Response, next: NextFunction) => {
    videoUpload.single('video')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return next(createError('No video file uploaded', 400));
      }

      const tempFilePath = path.join(mediaTempDir, file.filename);
      let videoUrl: string;
      try {
        videoUrl = await uploadToCDN(tempFilePath, file.filename);
      } finally {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // best-effort cleanup
        }
      }

      const { title } = req.body as { title?: string };
      const config = await prisma.siteConfig.upsert({
        where: { id: SITE_CONFIG_ID },
        create: { id: SITE_CONFIG_ID, promoVideoUrl: videoUrl, promoVideoTitle: title?.trim() || null },
        update: { promoVideoUrl: videoUrl, promoVideoTitle: title?.trim() || null },
      });

      res.json({
        videoUrl: config.promoVideoUrl,
        videoTitle: config.promoVideoTitle,
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /admin/site-config/promo-video — remove the promo video (reverts to the bundled default)
router.delete('/site-config/promo-video', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID },
      update: { promoVideoUrl: null, promoVideoTitle: null },
    });
    res.json({ ok: true, videoUrl: config.promoVideoUrl });
  } catch (err) {
    next(err);
  }
});

// ─── Partner store management ─────────────────────────────────────────────────

/**
 * GET /admin/stores/partners
 * List all stores with their partner approval status so admin can manage them.
 */
router.get('/stores/partners', authenticate, authorize('ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await prisma.store.findMany({
      select: {
        id:                true,
        name:              true,
        slug:              true,
        logo:              true,
        partnerApproved:   true,
        partnerLogoUrl:    true,
        partnerName:       true,
        partnerWebsite:    true,
        partnerApprovedAt: true,
        isActive:          true,
        createdAt:         true,
        user: {
          select: {
            id:          true,
            name:        true,
            email:       true,
            companyName: true,
            country:     true,
            role:        true,
            kycStatus:   true,
            isKycVerified: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ stores });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/stores/:storeId/partner-approve
 * Grant a store partner status — allows the store owner to upload a partner
 * logo that appears on the public /stores Partners wall.
 */
router.patch('/stores/:storeId/partner-approve', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params;
    // A partner must have passed identity (KYC) verification first.
    const owner = await prisma.store.findUnique({ where: { id: storeId }, select: { user: { select: { isKycVerified: true, kycStatus: true, name: true } } } });
    if (!owner) throw createError('Store not found', 404);
    if (!owner.user.isKycVerified) {
      throw createError(`${owner.user.name} has not passed KYC verification (status: ${owner.user.kycStatus.toLowerCase().replace('_', ' ')}). A partner must be verified first.`, 409);
    }
    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        partnerApproved:   true,
        partnerApprovedAt: new Date(),
      },
    });
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/stores/:storeId/partner-revoke
 * Revoke partner status — removes logo from public wall immediately.
 */
router.patch('/stores/:storeId/partner-revoke', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params;
    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        partnerApproved:   false,
        partnerApprovedAt: null,
        partnerLogoUrl:    null,
      },
    });
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

export default router;
