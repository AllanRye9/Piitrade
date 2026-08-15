import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { Prisma, Currency, ListingStatus, Placement, Role } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { uploadToCDN } from '../utils/cdn';
import { sendImageApprovedEmail, sendImageRejectedEmail, sendListingApprovedEmail, sendSubscriptionActivatedEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

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

const PACKAGE_SCOPES = ['LISTING', 'CV'] as const;
type PackageScope = (typeof PACKAGE_SCOPES)[number];
const ADMIN_MANAGEABLE_ROLES: Role[] = ['BUYER', 'SELLER', 'ADMIN', 'AGENT', 'ORGANIZATION', 'COMPANY'];
const SUPPORTED_CURRENCIES: Currency[] = ['AED', 'UGX', 'KES', 'CNY', 'USD'];

function parseScope(scope?: string): PackageScope {
  if (!scope) return 'LISTING';
  if (PACKAGE_SCOPES.includes(scope as PackageScope)) return scope as PackageScope;
  throw createError('scope must be LISTING or CV', 400);
}

router.use(authenticate, authorize('ADMIN'));

// ─── Site settings defaults ─────────────────────────────────────────────────────
// Persisted values live in SiteConfig.generalSettings (see the /settings routes
// below); this object only supplies fallback defaults for any key not yet set.

const defaultSettings: Record<string, unknown> = {
  siteName: 'Piitrade',
  maintenanceMode: false,
  allowRegistration: true,
  defaultCountry: 'UAE',
  itemsPerPage: 20,
  maxImagesPerListing: 10,
  trialDays: 7, // Free trial period for new ordinary users (admin-configurable)
};

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
      prisma.report.count(),
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

    // Revenue by category (sum of prices, top 10)
    const revenueByCategoryRaw = await prisma.listing.groupBy({
      by: ['categoryId'],
      _sum: { price: true },
      orderBy: { _sum: { price: 'desc' } },
      take: 10,
    });

    const revCategoryIds = revenueByCategoryRaw.map((r) => r.categoryId);
    const revCategories = await prisma.category.findMany({
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
  } catch (err) {
    next(err);
  }
});

// ─── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
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
    const logs = await prisma.notification.findMany({
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
      const meta = (log.data ?? {}) as {
        approverId?: string;
        approverName?: string;
        approverEmail?: string;
      };

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

    if (validatedRole === 'ADMIN' && targetUser.role !== 'ADMIN') {
      const existingAdmins = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (existingAdmins >= 3) {
        throw createError('Maximum admin limit reached (3)', 400);
      }
    }

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        ...(isBanned !== undefined && { isBanned }),
        ...(isVerified !== undefined && { isVerified }),
        ...(validatedRole && { role: validatedRole }),
      },
      select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
    });
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

    const existingAdmins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (existingAdmins >= 3) {
      throw createError('Maximum admin limit reached (3)', 400);
    }

    const approver = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: { id: true, name: true, email: true },
    });

    if (!approver) {
      throw createError('Approver account not found', 401);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: 'ADMIN', isVerified: true },
      select: { id: true, email: true, name: true, role: true, isBanned: true, isVerified: true },
    });

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

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── Listings ──────────────────────────────────────────────────────────────────

router.get('/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const search = (req.query.search as string || '').trim();
    const status = (req.query.status as string || '').trim();

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

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          category: { select: { name: true } },
          productImages: {
            where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
            select: { cdnUrl: true },
            orderBy: { uploadedAt: 'asc' },
            take: 1,
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
    const { status, placement, placementExpiresAt } = req.body;
    const nextStatus = status as ListingStatus | undefined;
    const nextPlacement = placement as Placement | undefined;
    const validStatuses: ListingStatus[] = ['ACTIVE', 'PENDING', 'SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'];
    const validPlacements: Placement[] = ['NONE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE'];
    if (nextStatus && !validStatuses.includes(nextStatus)) {
      throw createError('Invalid listing status', 400);
    }
    if (nextPlacement && !validPlacements.includes(nextPlacement)) {
      throw createError('Invalid listing placement', 400);
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

    const listing = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...(nextStatus && { status: nextStatus }),
        ...(nextPlacement !== undefined && { placement: nextPlacement }),
        ...(placementExpiresAt !== undefined && { placementExpiresAt: placementExpiresAt ? new Date(placementExpiresAt) : null }),
        ...(mustClearPlacement && { placement: 'NONE', placementExpiresAt: null }),
        ...(nextPlacement === 'NONE' && { placementExpiresAt: null }),
      },
    });
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// ─── Approve listing with placement & duration ─────────────────────────────────

router.put('/listings/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { placement, durationHours, customExpiry } = req.body;

    if (!placement || !['LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE'].includes(placement)) {
      throw createError('placement must be LATEST_COLLECTIONS, FEATURED_DEAL, or FLASH_SALE', 400);
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
      const hours = parseInt(durationHours) || 48;
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
      const placementExpiry = new Date();
      placementExpiry.setHours(placementExpiry.getHours() + 48);
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
  currency: string;
  condition: string;
  country: string;
  location: string;
  categoryId: string;
  categorySlug?: string;
  stock: number | string;
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
    if (item.stock == null || (item.stock as unknown as string) === '') {
      return `Row ${row}: stock is required`;
    }
    const parsedStock = parseInt(String(item.stock), 10);
    if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== String(item.stock).trim()) {
      return `Row ${row}: stock must be a valid non-negative whole number`;
    }
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
    currency: item.currency as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD',
    condition: (item.condition as 'NEW' | 'USED') || 'NEW',
    country: item.country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA',
    location: item.location,
    categoryId: item.categoryId,
    userId: adminId,
    status: 'ACTIVE' as const,
    stock: parseInt(String(item.stock), 10),
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


      // Process images for each listing item.
      const imageUrlsByIndex: string[][] = await Promise.all(
        items.map(async (item, idx) => {
          const files = filesByIndex.get(idx) || [];
          if (files.length === 0) return [];

          const country = (item.country || 'UAE').toUpperCase().replace(/[^A-Z0-9_]/g, '');
          const catSlug = item.categorySlug || categorySlugMap.get(item.categoryId) || 'general';
          const folder = `${country}/${catSlug}`;

          const urls: string[] = [];
          for (const f of files) {
            const tempPath = path.join(mediaTempDir, f.filename);
            let cdnUrl: string;
            try {
              cdnUrl = await uploadToCDN(tempPath, f.filename, folder);
              urls.push(cdnUrl);
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
const CATEGORY_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'] as const;
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

router.get('/reports', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const reports = await prisma.report.findMany({
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        listing: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (err) {
    next(err);
  }
});

router.delete('/reports/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.report.delete({ where: { id: req.params.id } });
    res.json({ message: 'Report dismissed successfully' });
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
    const stored = (config.generalSettings as Record<string, unknown>) || {};
    res.json({ ...defaultSettings, ...stored });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedKeys = Object.keys(defaultSettings);
    const config = await getSiteConfig();
    const current = ((config.generalSettings as Record<string, unknown>) || {}) as Record<string, Prisma.InputJsonValue>;
    const merged: Record<string, Prisma.InputJsonValue> = { ...defaultSettings, ...current } as Record<string, Prisma.InputJsonValue>;
    for (const key of Object.keys(req.body)) {
      if (allowedKeys.includes(key)) {
        merged[key] = req.body[key] as Prisma.InputJsonValue;
      }
    }
    const updated = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, generalSettings: merged as Prisma.InputJsonValue },
      update: { generalSettings: merged as Prisma.InputJsonValue },
    });
    res.json({ ...defaultSettings, ...(updated.generalSettings as Record<string, unknown>) });
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

router.put('/site-config/header-theme', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { headerTheme } = req.body;
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, headerTheme: headerTheme || null },
      update: { headerTheme: headerTheme || null },
    });
    res.json({ headerTheme: config.headerTheme });
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
const SECTION_COUNT_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'] as const;
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
      const placementWhereBase = { status: 'ACTIVE' as const, country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA', placementExpiresAt: { gt: now } };

      const [flash, latest, featured, other] = await Promise.all([
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'FLASH_SALE' } }),
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'LATEST_COLLECTIONS' } }),
        prisma.listing.count({ where: { ...placementWhereBase, placement: 'FEATURED_DEAL' } }),
        prisma.listing.count({ where: { status: 'ACTIVE', country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA' } }),
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
            country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA',
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
// never fabricates listings. Sets a genuine 90-day placementExpiresAt (see
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
    const countryTyped = country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA';

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

    const placementExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await prisma.listing.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { placement, placementExpiresAt },
    });

    res.json({ updated: candidates.length, newCount: currentCount + candidates.length });
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
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
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
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
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

// ─── Orders Management ─────────────────────────────────────────────────────────

router.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = { ...(status && { status }) };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
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
      prisma.order.count({ where }),
    ]);

    res.json({ orders, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/orders/:id/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, trackingNumber, cancellationNote } = req.body;
    if (!status) return next(createError('status is required', 400));

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return next(createError('Order not found', 404));

    const updateData: Record<string, unknown> = { status };
    if (trackingNumber) updateData.trackingNumber = trackingNumber;
    if (status === 'SHIPPED') updateData.shippedAt = new Date();
    if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
      const sellerShare = order.total - order.shippingCost;
      await prisma.user.update({ where: { id: order.sellerId }, data: { balance: { increment: sellerShare } } });
      await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: 'COMPLETED', paidAt: new Date() } });
    }
    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      if (cancellationNote) updateData.cancellationNote = cancellationNote;
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: updateData as Parameters<typeof prisma.order.update>[0]['data'],
    });

    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Returns Management ────────────────────────────────────────────────────────

router.get('/returns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = { ...(status && { status }) };

    const [returns, total] = await Promise.all([
      prisma.return.findMany({
        where,
        include: {
          buyer: { select: { id: true, name: true, email: true } },
          order: { select: { id: true, orderNumber: true, total: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.return.count({ where }),
    ]);

    res.json({ returns, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/returns/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, resolution } = req.body;
    if (!status) return next(createError('status is required', 400));

    const ret = await prisma.return.findUnique({ where: { id: req.params.id } });
    if (!ret) return next(createError('Return not found', 404));

    const updated = await prisma.return.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(resolution && { resolution }),
        ...(['APPROVED', 'REJECTED', 'REFUNDED'].includes(status) && { resolvedAt: new Date() }),
      },
    });

    // Notify buyer
    const order = await prisma.order.findUnique({ where: { id: ret.orderId } });
    if (order) {
      const notifType = status === 'APPROVED' ? 'RETURN_APPROVED' : status === 'REJECTED' ? 'RETURN_REJECTED' : undefined;
      if (notifType) {
        await prisma.notification.create({
          data: {
            userId: ret.buyerId,
            type: notifType as 'RETURN_APPROVED',
            title: `Return ${status.toLowerCase()}`,
            message: `Your return request for order ${order.orderNumber} has been ${status.toLowerCase()}.`,
            data: { orderId: order.id, returnId: ret.id },
          },
        });
      }
    }

    res.json({ return: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Coupons Management ────────────────────────────────────────────────────────

router.get('/coupons', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ coupons });
  } catch (err) {
    next(err);
  }
});

router.post('/coupons', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, type, value, minOrderAmount, maxUses, isActive, expiresAt } = req.body;
    if (!code || !type || value == null) return next(createError('code, type, and value are required', 400));

    const existing = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (existing) return next(createError('Coupon code already exists', 400));

    const coupon = await prisma.coupon.create({
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
  } catch (err) {
    next(err);
  }
});

router.put('/coupons/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, value, minOrderAmount, maxUses, isActive, expiresAt } = req.body;
    const coupon = await prisma.coupon.update({
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
  } catch (err) {
    next(err);
  }
});

router.delete('/coupons/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.coupon.delete({ where: { id: req.params.id } });
    res.json({ message: 'Coupon deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Withdrawals Management ────────────────────────────────────────────────────

router.get('/withdrawals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = { ...(status && { status }) };

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.withdrawal.count({ where }),
    ]);

    res.json({ withdrawals, pagination: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

router.put('/withdrawals/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, note } = req.body;
    if (!status) return next(createError('status is required', 400));

    const w = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!w) return next(createError('Withdrawal not found', 404));

    const updated = await prisma.withdrawal.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(note && { note }),
        ...(['COMPLETED', 'APPROVED'].includes(status) && { processedAt: new Date() }),
      },
    });

    // If rejected, refund balance to user
    if (status === 'REJECTED') {
      await prisma.user.update({ where: { id: w.userId }, data: { balance: { increment: w.amount } } });
    }

    // Notify seller
    const notifType = status === 'APPROVED' || status === 'COMPLETED' ? 'WITHDRAWAL_APPROVED' : status === 'REJECTED' ? 'WITHDRAWAL_REJECTED' : undefined;
    if (notifType) {
      await prisma.notification.create({
        data: {
          userId: w.userId,
          type: notifType as 'WITHDRAWAL_APPROVED',
          title: `Withdrawal ${status.toLowerCase()}`,
          message: `Your withdrawal request of ${w.amount} ${w.currency} has been ${status.toLowerCase()}.`,
          data: { withdrawalId: w.id },
        },
      });
    }

    res.json({ withdrawal: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Shipping Rates Management ─────────────────────────────────────────────────

router.get('/shipping-rates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rates = await prisma.shippingRate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ rates });
  } catch (err) {
    next(err);
  }
});

router.post('/shipping-rates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, country, minDays, maxDays, priceAed, priceUgx, priceKes, priceCny, isActive } = req.body;
    if (!name || !country || minDays == null || maxDays == null) {
      return next(createError('name, country, minDays, and maxDays are required', 400));
    }

    const rate = await prisma.shippingRate.create({
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
  } catch (err) {
    next(err);
  }
});

router.put('/shipping-rates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, minDays, maxDays, priceAed, priceUgx, priceKes, priceCny, isActive } = req.body;
    const rate = await prisma.shippingRate.update({
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
  } catch (err) {
    next(err);
  }
});

router.delete('/shipping-rates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.shippingRate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Shipping rate deleted' });
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
    const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive } = req.body;
    const scope = parseScope(scopeInput);
    if (!name) throw createError('name is required', 400);
    if (!durationDays || durationDays < 1) throw createError('durationDays must be at least 1', 400);

    const willBeActive = isActive !== false;

    const pkg = await prisma.sellerPackage.create({
      data: {
        name,
        description: description ?? null,
        scope,
        isFree: Boolean(isFree),
        price: isFree ? 0 : parseFloat(price) || 0,
        currency: currency ?? 'AED',
        durationDays: parseInt(durationDays),
        maxListings: maxListings ? parseInt(maxListings) : null,
        isActive: willBeActive,
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

router.put('/packages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, scope: scopeInput, isFree, price, currency, durationDays, maxListings, isActive } = req.body;
    const scope = scopeInput !== undefined ? parseScope(scopeInput) : undefined;

    const pkg = await prisma.sellerPackage.update({
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
  } catch (err) {
    next(err);
  }
});

router.delete('/packages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const where: Prisma.CvDownloadTokenWhereInput = {
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
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const status = req.query.status as string | undefined;
    const scope = parseScope(req.query.scope as string | undefined);

    // Expire any overdue subscriptions first
    await prisma.sellerSubscription.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const where = {
      ...(status ? { status: status as 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING_PAYMENT' } : {}),
      package: { scope },
    };

    const [total, subscriptions] = await Promise.all([
      prisma.sellerSubscription.count({ where }),
      prisma.sellerSubscription.findMany({
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
  } catch (err) {
    next(err);
  }
});

router.put('/subscriptions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, endDate } = req.body;
    const allowedStatuses = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'];
    if (status && !allowedStatuses.includes(status)) {
      throw createError('Invalid status', 400);
    }

    const sub = await prisma.sellerSubscription.update({
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
      await prisma.notification.create({
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
        const otherActivePaid = await prisma.sellerSubscription.findFirst({
          where: {
            userId: sub.userId,
            id: { not: sub.id },
            status: 'ACTIVE',
            package: { isFree: false },
          },
          include: { package: true },
        });
        if (!otherActivePaid) {
          await prisma.user.update({ where: { id: sub.userId }, data: { isVerified: false } });
        }
      }
    } else if (status === 'ACTIVE') {
      await prisma.notification.create({
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
        await prisma.user.update({ where: { id: sub.userId }, data: { isVerified: true } });
      }
      // Send subscription activation email (non-blocking)
      sendSubscriptionActivatedEmail(sub.user.email, sub.user.name, sub.package.name, sub.endDate)
        .catch((err) => logger.error('Failed to send subscription activated email', err));
    }

    res.json({ subscription: sub });
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

// ─── Logo Management ──────────────────────────────────────────────────────────

// Logo display height, in px, is clamped to a sane range so a bad admin
// input can't blow up the header layout.
const LOGO_SIZE_MIN = 16;
const LOGO_SIZE_MAX = 96;
const DEFAULT_LOGO_SIZE = 28;
function clampLogoSize(size: number | null | undefined): number {
  if (size == null || Number.isNaN(size)) return DEFAULT_LOGO_SIZE;
  return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(size)));
}

// POST /admin/site-config/logo/upload — upload a logo image file directly to the
// CDN and return its URL. Deliberately does NOT create a SiteMedia record (unlike
// /media/upload) because the logo URL is already tracked on SiteConfig.logoUrl —
// previously this reused /media/upload with section:'hero' as a workaround, which
// silently inserted a stray slide into the homepage Hero Slideshow (section='hero')
// every single time a logo was uploaded or replaced. This endpoint mirrors the
// interview-demo-video upload pattern below, which never had that problem.
router.post(
  '/site-config/logo/upload',
  (req: Request, res: Response, next: NextFunction) => {
    mediaUpload.single('logo')(req, res, (err: unknown) => {
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
        return next(createError('No logo file uploaded', 400));
      }

      const tempFilePath = path.join(mediaTempDir, file.filename);
      let logoUrl: string;
      try {
        logoUrl = await uploadToCDN(tempFilePath, file.filename, 'media/logo');
      } finally {
        try { fs.unlinkSync(tempFilePath); } catch { /* best-effort cleanup */ }
      }

      res.json({ url: logoUrl });
    } catch (err) {
      next(err);
    }
  },
);

// GET /admin/site-config/logo — get current logo settings
router.get('/site-config/logo', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({
      logoUrl: config.logoUrl || null,
      logoPages: (config.logoPages as string[]) || [],
      logoAltText: config.logoAltText || null,
      logoSize: clampLogoSize(config.logoSize),
      logoLinkUrl: config.logoLinkUrl || null,
      logoDisplayMode: config.logoDisplayMode || 'inline',
    });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/site-config/logo — update logo URL, pages, alt text, size, link URL, and display mode
router.put('/site-config/logo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { logoUrl, logoPages, logoAltText, logoSize, logoLinkUrl, logoDisplayMode } = req.body as {
      logoUrl?: string | null;
      logoPages?: string[];
      logoAltText?: string | null;
      logoSize?: number | null;
      logoLinkUrl?: string | null;
      logoDisplayMode?: string | null;
    };
    const clampedSize = logoSize !== undefined ? clampLogoSize(logoSize) : undefined;
    const validatedMode =
      logoDisplayMode === 'replace' || logoDisplayMode === 'inline' ? logoDisplayMode : undefined;
    const config = await prisma.siteConfig.upsert({
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
      logoPages: (config.logoPages as string[]) || [],
      logoAltText: config.logoAltText || null,
      logoSize: clampLogoSize(config.logoSize),
      logoLinkUrl: config.logoLinkUrl || null,
      logoDisplayMode: config.logoDisplayMode || 'inline',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/site-config/logo — remove the logo
router.delete('/site-config/logo', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID },
      update: { logoUrl: null, logoPages: [], logoAltText: null, logoSize: null, logoLinkUrl: null, logoDisplayMode: null },
    });
    res.json({ ok: true, logoUrl: config.logoUrl });
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

// ─── Homepage Advertisement Management ─────────────────────────────────────────
// Replaces the old "PIITRADE EXCHANGE · Money Transfer Rates" widget that used
// to occupy the exchange-rate slot inside the homepage SiteAnalytics card
// (stat cards beside it are untouched) with an admin-managed set of rotating
// ad images. Mirrors the logo upload pattern above — a dedicated upload
// endpoint (not /media/upload) so this never creates a stray SiteMedia record.

interface AdImage {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  altText: string | null;
}

// POST /admin/site-config/ad/upload — upload one ad image to the CDN and get
// back its URL. The frontend calls this once per new image, then adds the
// returned URL into the adImages array it saves via PUT below.
router.post(
  '/site-config/ad/upload',
  (req: Request, res: Response, next: NextFunction) => {
    mediaUpload.single('ad')(req, res, (err: unknown) => {
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
        return next(createError('No ad image uploaded', 400));
      }

      const tempFilePath = path.join(mediaTempDir, file.filename);
      let adImageUrl: string;
      try {
        adImageUrl = await uploadToCDN(tempFilePath, file.filename, 'media/ad');
      } finally {
        try { fs.unlinkSync(tempFilePath); } catch { /* best-effort cleanup */ }
      }

      res.json({ url: adImageUrl });
    } catch (err) {
      next(err);
    }
  },
);

// GET /admin/site-config/ad — get the current rotating ad images + interval
router.get('/site-config/ad', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSiteConfig();
    res.json({
      adImages: Array.isArray(config.adImages) ? config.adImages : [],
      adIntervalSeconds: config.adIntervalSeconds || 5,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/site-config/ad — replace the whole set of ad images and/or the
// rotation interval. The admin UI manages add/remove/reorder client-side and
// saves the entire array in one call, so this is a full replace, not a patch
// of individual images.
router.put('/site-config/ad', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { adImages, adIntervalSeconds } = req.body as {
      adImages?: AdImage[];
      adIntervalSeconds?: number | null;
    };

    if (adImages !== undefined) {
      if (!Array.isArray(adImages) || adImages.some((a) => !a || typeof a.imageUrl !== 'string' || !a.imageUrl)) {
        return next(createError('adImages must be an array of objects with a non-empty imageUrl', 400));
      }
    }
    if (adIntervalSeconds !== undefined && adIntervalSeconds !== null) {
      if (typeof adIntervalSeconds !== 'number' || !Number.isFinite(adIntervalSeconds) || adIntervalSeconds < 1) {
        return next(createError('adIntervalSeconds must be a number of at least 1 second', 400));
      }
    }

    const normalizedImages = adImages?.map((a, i) => ({
      id: a.id || `ad_${Date.now()}_${i}`,
      imageUrl: a.imageUrl,
      linkUrl: a.linkUrl || null,
      altText: a.altText || null,
    }));

    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: {
        id: SITE_CONFIG_ID,
        adImages: normalizedImages ?? [],
        adIntervalSeconds: adIntervalSeconds ?? 5,
      },
      update: {
        ...(normalizedImages !== undefined && { adImages: normalizedImages }),
        ...(adIntervalSeconds !== undefined && { adIntervalSeconds: adIntervalSeconds ?? 5 }),
      },
    });
    res.json({
      adImages: Array.isArray(config.adImages) ? config.adImages : [],
      adIntervalSeconds: config.adIntervalSeconds || 5,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/site-config/ad — clear the ad rotation entirely
router.delete('/site-config/ad', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      create: { id: SITE_CONFIG_ID, adImages: [] },
      update: { adImages: [] },
    });
    res.json({ ok: true, adImages: config.adImages });
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
