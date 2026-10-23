import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth';
import { maskUserContactKeepSocial } from '../utils/contactPrivacy';
import { Prisma } from '@prisma/client';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE ORDER IS CRITICAL.
// All static paths (/partners, /me, etc.) MUST be registered before the
// wildcard /:slug route, otherwise Express matches them as slugs and
// the real handlers are never reached.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Public: list all active stores ────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page  as string || '1'));
    const limit   = Math.min(500, Math.max(1, parseInt(req.query.limit as string || '500')));
    const skip    = (page - 1) * limit;
    const country = req.query.country as string | undefined;

    const countryFilter = country && ['UGANDA'].includes(country.toUpperCase())
      ? country.toUpperCase()
      : undefined;

    const whereClause = {
      isActive: true,
      ...(countryFilter ? {
        user: { country: countryFilter as 'UGANDA' },
      } : {}),
    };

    // Two phases so memory stays small: rank using only the light sort keys of every active store, then
    // load the full rows (description, owner details …) for just the requested page.
    const keys = await prisma.store.findMany({
      where: whereClause,
      select: { id: true, createdAt: true, pinOrder: true, userId: true },
      orderBy: { createdAt: 'desc' },
      take: 20000,
    });

    // Display order: admin-pinned stores first (lowest pinOrder), then by the
    // store's active subscription tier (Platinum > Gold > Free), then newest.
    // The tier lives on the owner's active StoreRental, so it is joined here
    // rather than sorted in SQL.
    const now = new Date();
    const rentals = await prisma.storeRental.findMany({
      where: { userId: { in: keys.map((k) => k.userId) }, status: 'ACTIVE', endDate: { gt: now } },
      select: { userId: true, tier: true },
    });
    const TIER_RANK: Record<string, number> = { FREE: 0, GOLD: 1, PLATINUM: 2 };
    const tierByUser = new Map<string, string>();
    for (const r of rentals) {
      if ((TIER_RANK[r.tier] ?? 0) >= (TIER_RANK[tierByUser.get(r.userId) ?? 'FREE'] ?? 0)) tierByUser.set(r.userId, r.tier);
    }
    const rankedKeys = keys
      .map((k) => ({ ...k, tier: tierByUser.get(k.userId) ?? 'FREE' }))
      .sort((x, y) => {
        const px = x.pinOrder ?? Number.MAX_SAFE_INTEGER;
        const py = y.pinOrder ?? Number.MAX_SAFE_INTEGER;
        if (px !== py) return px - py;
        const tx = TIER_RANK[x.tier] ?? 0;
        const ty = TIER_RANK[y.tier] ?? 0;
        if (tx !== ty) return ty - tx;
        return y.createdAt.getTime() - x.createdAt.getTime();
      });
    const total = rankedKeys.length;
    const pageKeys = rankedKeys.slice(skip, skip + limit);

    const rows = await prisma.store.findMany({
      where: { id: { in: pageKeys.map((k) => k.id) } },
      select: {
        id:               true,
        name:             true,
        slug:             true,
        logo:             true,
        banner:           true,
        description:      true,
        rating:           true,
        ratingCount:      true,
        isActive:         true,
        createdAt:        true,
        // Partner fields — added in migration 20260720000001
        partnerApproved:   true,
        partnerLogoUrl:    true,
        partnerName:       true,
        partnerWebsite:    true,
        partnerApprovedAt: true,
        pinOrder:          true,
        user: {
          select: {
            id:                  true,
            name:                true,
            avatar:              true,
            country:             true,
            role:                true,
            companyName:         true,
            businessDescription: true,
            website:             true,
          },
        },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const stores = pageKeys
      .map((k) => { const row = byId.get(k.id); return row ? { ...row, tier: k.tier } : null; })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    res.json({ stores, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error(`GET /api/stores failed: ${String(err)}`);
    next(err);
  }
});

// ── 2. Public: approved partners wall ────────────────────────────────────────
// MUST be before /:slug so GET /partners is not matched as a store slug.
router.get('/partners', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const partners = await prisma.store.findMany({
      where: { partnerApproved: true, isActive: true },
      select: {
        id:                true,
        slug:              true,
        name:              true,
        partnerLogoUrl:    true,
        partnerName:       true,
        partnerWebsite:    true,
        partnerApprovedAt: true,
        logo:              true,
        user: {
          select: {
            id:          true,
            name:        true,
            companyName: true,
            country:     true,
            website:     true,
            socialLinks: true,
          },
        },
      },
      orderBy: { partnerApprovedAt: 'asc' },
    });
    // Public page: keep social profiles but never expose WhatsApp / phone entries.
    res.json({ partners: partners.map((pt) => ({ ...pt, user: maskUserContactKeepSocial(pt.user) })) });
  } catch (err) {
    next(err);
  }
});

// ── 3. Authenticated routes (all /me/* paths) ─────────────────────────────────
// Apply auth middleware only to routes below this point.
// These must also come BEFORE /:slug.
router.use('/me', authenticate);

// GET /api/stores/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const store = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// PUT /api/stores/me
router.put('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    if (!existing) return next(createError('Store not found — your store has not been provisioned yet', 404));

    // All Store Dashboard actions (profile, branding, theme) require a
    // live store subscription. Once it lapses the store is frozen — the
    // owner is an ordinary user until they renew — and, critically, cannot
    // un-freeze it themselves by sending isActive: true; only an admin
    // approving a renewal (PATCH /store-rentals/admin/:id) reactivates it.
    const liveRental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId, status: 'ACTIVE', endDate: { gt: new Date() } },
      select: { id: true },
    });
    if (!liveRental) {
      return next(createError('Your store subscription is not active. Renew it to edit your store — your existing listings are unaffected.', 403));
    }

    const { name, description, logo, banner, isActive, backgroundTheme } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return next(createError('Store name cannot be empty', 400));
    }

    // Background theme: { presetId?: string, primaryColor?: '#rrggbb',
    // backgroundImage?: string | null }, or null to reset to the site default.
    let themeUpdate: { backgroundTheme: Prisma.InputJsonValue | typeof Prisma.DbNull } | Record<string, never> = {};
    if (backgroundTheme !== undefined) {
      if (backgroundTheme === null) {
        // DbNull (not JsonNull): backgroundTheme is a nullable column
        // and this clears it to actual SQL NULL — "no theme set, use the
        // site default" — rather than storing the JSON literal `null` as
        // the column's value.
        themeUpdate = { backgroundTheme: Prisma.DbNull };
      } else {
        const t = backgroundTheme as { presetId?: unknown; primaryColor?: unknown; backgroundImage?: unknown };
        if (typeof t !== 'object' || Array.isArray(t)) return next(createError('backgroundTheme must be an object or null', 400));
        if (t.presetId !== undefined && typeof t.presetId !== 'string') return next(createError('backgroundTheme.presetId must be a string', 400));
        if (t.primaryColor !== undefined && !(typeof t.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.primaryColor))) {
          return next(createError('backgroundTheme.primaryColor must be a #rrggbb hex color', 400));
        }
        if (t.backgroundImage !== undefined && t.backgroundImage !== null && typeof t.backgroundImage !== 'string') {
          return next(createError('backgroundTheme.backgroundImage must be a string or null', 400));
        }
        themeUpdate = { backgroundTheme: { presetId: t.presetId, primaryColor: t.primaryColor, backgroundImage: t.backgroundImage ?? null } as Prisma.InputJsonValue };
      }
    }

    const store = await prisma.store.update({
      where: { id: existing.id },
      data: {
        ...(name        !== undefined && { name:        String(name).trim() }),
        ...(description !== undefined && { description: description || null }),
        ...(logo        !== undefined && { logo:        logo || null }),
        ...(banner      !== undefined && { banner:      banner || null }),
        ...(isActive    !== undefined && { isActive:    Boolean(isActive) }),
        ...themeUpdate,
      },
    });

    res.json({ store });
  } catch (err) {
    next(err);
  }
});

// PUT /api/stores/me/partner-logo
// Only stores with partnerApproved=true may call this.
router.put('/me/partner-logo', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const store = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    if (!store) return next(createError('Store not found', 404));
    if (!store.partnerApproved) {
      return next(createError('Your store has not been approved as a partner. Contact admin.', 403));
    }

    const { partnerLogoUrl, partnerName, partnerWebsite } = req.body as {
      partnerLogoUrl?: string;
      partnerName?:    string;
      partnerWebsite?: string;
    };

    if (!partnerLogoUrl) return next(createError('partnerLogoUrl is required', 400));

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: {
        partnerLogoUrl: partnerLogoUrl.trim(),
        ...(partnerName    !== undefined && { partnerName:    partnerName?.trim()    || null }),
        ...(partnerWebsite !== undefined && { partnerWebsite: partnerWebsite?.trim() || null }),
      },
    });

    res.json({ store: updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/stores/me/analytics — aggregate dashboard numbers for the Web
// Store "Analytics" tool: listing views, active/sold listing counts, enquiry
// threads, and a top-listings-by-views leaderboard.
router.get('/me/analytics', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const [listingAgg, activeListings, soldListings, topListings, received] = await Promise.all([
      prisma.listing.aggregate({ where: { userId }, _sum: { views: true } }),
      prisma.listing.count({ where: { userId, status: 'ACTIVE' } }),
      prisma.listing.count({ where: { userId, status: 'SOLD' } }),
      prisma.listing.findMany({
        where: { userId },
        select: { id: true, title: true, views: true, price: true, currency: true, images: true },
        orderBy: { views: 'desc' },
        take: 5,
      }),
      // Enquiry threads = one per (buyer, listing) about this store's own listings — the same
      // definition the Enquiries tab uses, so the two numbers always agree.
      prisma.message.findMany({
        where: { receiverId: userId, listing: { is: { userId } } },
        distinct: ['senderId', 'listingId'],
        select: { senderId: true },
      }),
    ]);

    res.json({
      totalViews:         listingAgg._sum.views ?? 0,
      activeListings,
      soldListings,
      totalConversations: received.length,
      topListings,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stores/me/partner-logo
router.delete('/me/partner-logo', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const store = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    if (!store) return next(createError('Store not found', 404));
    if (!store.partnerApproved) return next(createError('Not an approved partner', 403));

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { partnerLogoUrl: null },
    });
    res.json({ store: updated });
  } catch (err) {
    next(err);
  }
});

// ── 4. Public: view a store by slug ──────────────────────────────────────────
// MUST be last — wildcard /:slug catches anything not matched above.
router.get('/:slug', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const store = await prisma.store.findUnique({
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
                category:      { select: { id: true, name: true, slug: true } },
                productImages: { select: { cdnUrl: true }, take: 1 },
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            },
          },
        },
      },
    });

    if (!store || !store.isActive) return next(createError('Store not found', 404));
    // Contact gate (same rule as GET /listings/:id): anonymous visitors get no WhatsApp/phone.
    res.json({ store: req.user ? store : { ...store, user: maskUserContactKeepSocial(store.user) } });
  } catch (err) {
    next(err);
  }
});

// ── 5. POST /api/stores — create a store (authenticated) ─────────────────────
router.use(authenticate);

router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, slug } = req.body;
    if (!name || !slug) return next(createError('name and slug are required', 400));

    // A store is a paid, KYC-approved, admin-activated product. It can only be named here once an
    // admin has activated the owner's rental; this route never creates a store out of thin air.
    const liveRental = await prisma.storeRental.findFirst({
      where: { userId: req.user!.userId, status: 'ACTIVE', endDate: { gt: new Date() } },
      select: { id: true },
    });
    if (!liveRental) return next(createError('You need an active Web Store subscription to create a store.', 403));

    const existing = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    if (existing) return next(createError('You already have a store', 400));

    const slugExists = await prisma.store.findUnique({ where: { slug: slug.toLowerCase() } });
    if (slugExists) return next(createError('Slug is already taken', 400));

    const store = await prisma.store.create({
      data: {
        userId:      req.user!.userId,
        name:        String(name).trim().slice(0, 120),
        description: typeof description === 'string' ? description.slice(0, 2000) : undefined,
        slug:        String(slug).toLowerCase(),
      },
    });

    res.status(201).json({ store });
  } catch (err) {
    next(err);
  }
});

export default router;
