import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest, optionalAuthenticate } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import { sendListingLikedEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { recordSearchLog, recordListingClick } from '../utils/analyticsLogger';

const router = Router();

const RECOMMENDATION_LOOKBACK_DAYS = 60;

// Shape of one entry in Category.fieldSchema (admin-defined custom fields for
// that category — see /admin/categories "Custom Fields"). Mirrors
// CategoryFieldDef on the frontend.
interface CategoryFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  required?: boolean;
}

/**
 * Checks the submitted custom field answers against a category's fieldSchema
 * and returns the labels of any required fields that are missing/blank.
 * Returns an empty array when everything required is present (or the
 * category has no custom fields defined).
 */
function missingRequiredCustomFields(
  fieldSchema: unknown,
  values: Record<string, unknown> | null | undefined,
): string[] {
  if (!Array.isArray(fieldSchema)) return [];
  const answers = values ?? {};
  return (fieldSchema as CategoryFieldDef[])
    .filter((field) => field?.required)
    .filter((field) => {
      const value = (answers as Record<string, unknown>)[field.name];
      return value == null || String(value).trim() === '';
    })
    .map((field) => field.label || field.name);
}

function hashToUnitInterval(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function createActiveListingsWhere(req: AuthRequest, now: Date, viewingOwnListings: boolean, userId?: string): Prisma.ListingWhereInput {
  return {
    ...(viewingOwnListings ? { userId: req.user!.userId } : {
      AND: [
        { status: 'ACTIVE' },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    }),
    ...(!viewingOwnListings && userId && { userId }),
  };
}

async function getRecommendedListings(options: {
  where: Prisma.ListingWhereInput;
  pageNum: number;
  limitNum: number;
  userId: string | null;
  country?: string;
}) {
  const { where, pageNum, limitNum, userId } = options;
  const candidateLimit = Math.min(500, Math.max(limitNum * pageNum + 200, 200));
  const candidateIds: string[] = [];

  const [candidates, total] = await Promise.all([
    prisma.listing.findMany({
      where,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
          productImages: {
            where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
            select: { id: true, cdnUrl: true, uploadedAt: true },
            orderBy: { uploadedAt: 'asc' },
          },
          _count: { select: { favorites: true } },
        },
      orderBy: { createdAt: 'desc' },
      take: candidateLimit,
    }),
    prisma.listing.count({ where }),
  ]);

  candidateIds.push(...candidates.map((listing) => listing.id));

  if (candidateIds.length === 0) {
    return {
      listings: [],
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    };
  }

  const [favorites, engagements, dwellTotals] = await Promise.all([
    userId
      ? prisma.favorite.findMany({
          where: { userId },
          select: { listing: { select: { categoryId: true } } },
        })
      : Promise.resolve([] as Array<{ listing: { categoryId: string } }>),
    userId
      ? prisma.listingEngagement.findMany({
          where: {
            userId,
            createdAt: { gte: new Date(Date.now() - RECOMMENDATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) },
          },
          select: {
            durationSeconds: true,
            listingId: true,
            listing: { select: { categoryId: true } },
          },
        })
      : Promise.resolve([] as Array<{ durationSeconds: number; listingId: string; listing: { categoryId: string } }>),
    prisma.listingEngagement.groupBy({
      by: ['listingId'],
      where: { listingId: { in: candidateIds } },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
  ]);

  const categoryAffinity = new Map<string, number>();
  const seenListings = new Set<string>();

  for (const favorite of favorites) {
    const key = favorite.listing.categoryId;
    categoryAffinity.set(key, (categoryAffinity.get(key) || 0) + 4);
  }

  for (const engagement of engagements) {
    const key = engagement.listing.categoryId;
    const dwellBoost = Math.min(5, Math.max(1, engagement.durationSeconds / 30));
    categoryAffinity.set(key, (categoryAffinity.get(key) || 0) + dwellBoost);
    seenListings.add(engagement.listingId);
  }

  const dwellByListing = new Map<string, number>();
  for (const row of dwellTotals) {
    dwellByListing.set(row.listingId, row._sum.durationSeconds || 0);
  }

  const maxViews = Math.max(1, ...candidates.map((listing) => listing.views || 0));
  const maxFavorites = Math.max(1, ...candidates.map((listing) => listing._count.favorites || 0));
  const maxDwell = Math.max(1, ...candidateIds.map((listingId) => dwellByListing.get(listingId) || 0));

  const ranked = candidates
    .map((listing) => {
      const categoryScore = categoryAffinity.get(listing.categoryId) || 0;
      const viewScore = (listing.views || 0) / maxViews;
      const favoriteScore = (listing._count.favorites || 0) / maxFavorites;
      const dwellScore = (dwellByListing.get(listing.id) || 0) / maxDwell;
      const ageHours = Math.max(1, (Date.now() - new Date(listing.createdAt).getTime()) / (60 * 60 * 1000));
      const freshnessScore = Math.max(0, 1 - ageHours / (24 * 30));
      const randomBoost = hashToUnitInterval(listing.id) * 0.75;
      const repeatPenalty = seenListings.has(listing.id) ? 0.35 : 0;

      return {
        listing,
        score:
          (categoryScore * 1.3) +
          (viewScore * 2.1) +
          (favoriteScore * 2.7) +
          (dwellScore * 2.4) +
          (freshnessScore * 1.2) +
          randomBoost -
          repeatPenalty,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.listing);

  const skip = (pageNum - 1) * limitNum;
  const paged = ranked.slice(skip, skip + limitNum);

  return {
    listings: paged,
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  };
}

// ─── Relevance ranking for text search ─────────────────────────────────────
// Used whenever a search term (`q`) is present. Unlike the "recommended" feed
// (which deliberately mixes in engagement/freshness/randomness for browsing),
// search results need to be accurate and stable: exact/starts-with/contains
// matches on the title rank above description-only matches, with recency as
// the tiebreaker. No random component — the same search should return the
// same order every time.
async function getRelevanceRankedListings(options: {
  where: Prisma.ListingWhereInput;
  q: string;
  pageNum: number;
  limitNum: number;
}) {
  const { where, q, pageNum, limitNum } = options;
  const qLower = q.trim().toLowerCase();

  const [candidates, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        category: {
          select: {
            id: true, name: true, slug: true, parentId: true,
            parent: { select: { id: true, name: true, slug: true } },
          },
        },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: {
          where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
          select: { id: true, cdnUrl: true, uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.listing.count({ where }),
  ]);

  const scored = candidates.map((listing) => {
    const title = (listing.title || '').toLowerCase();
    const description = (listing.description || '').toLowerCase();

    let score = 0;
    if (title === qLower) score += 100;
    else if (title.startsWith(qLower)) score += 70;
    else if (title.includes(qLower)) score += 45;

    // Whole-word title match gets a small bump over a mid-word substring match
    if (new RegExp(`\\b${qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(title)) score += 10;

    if (description.includes(qLower)) score += 15;

    // Light popularity/freshness tiebreaker so equally-relevant results favour
    // newer / more-viewed listings rather than being arbitrary.
    score += Math.min(5, (listing.views || 0) / 200);

    return { listing, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.listing.createdAt).getTime() - new Date(a.listing.createdAt).getTime();
  });

  const skip = (pageNum - 1) * limitNum;
  const paged = scored.slice(skip, skip + limitNum).map((s) => s.listing);

  return {
    listings: paged,
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  };
}

// ─── Cart availability check ────────────────────────────────────────────────
// GET /listings/status?ids=id1,id2,...
//
// Lets the cart reconcile items that were added a while ago against each
// listing's *current* status/stock — a listing can be sold, deleted,
// deactivated/expired, or run out of stock after it's already sitting in
// someone's cart, and the cart has no other way to find that out. Public
// (no auth) and read-only: returns only the fields needed to decide whether
// a cart line is still purchasable, not full listing detail.
// Deleted listings simply aren't in the DB anymore (hard delete — see
// DELETE /listings/:id), so any id in the request that's missing from the
// response means "no longer exists" as far as the caller is concerned.
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idsParam = req.query.ids as string | undefined;
    if (!idsParam) {
      return res.json({ listings: [] });
    }
    const ids = [...new Set(idsParam.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 200);
    if (ids.length === 0) {
      return res.json({ listings: [] });
    }

    const listings = await prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, stock: true },
    });

    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

// ─── Featured Deal ──────────────────────────────────────────────────────────

router.get('/featured-deal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const country = req.query.country as string | undefined;
    const countryFilter = country && ['UAE', 'UGANDA', 'KENYA', 'CHINA'].includes(country)
      ? { country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA' }
      : {};

    // `limit` is optional and defaults to 1 to preserve the original single-object
    // response shape for callers that don't pass it (e.g. the homepage SSR fetch).
    // When a caller explicitly asks for more than 1 (e.g. the homepage's 6-per-row
    // Featured Deal grid), we return { listings: [...] } instead so the row can
    // actually be filled with multiple items — previously this endpoint always
    // used findFirst and could never return more than a single listing no matter
    // what the frontend requested.
    const requestedLimit = parseInt(req.query.limit as string || '1', 10);
    const limit = Math.min(24, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 1));

    const where = {
      status: 'ACTIVE' as const,
      placement: 'FEATURED_DEAL' as const,
      placementExpiresAt: { gt: now },
      ...countryFilter,
    };
    const include = {
      category: { select: { id: true, name: true, slug: true } },
      user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
      productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' as const }, take: 1 },
    };

    if (limit === 1) {
      // Backward-compatible single-object response (unchanged behaviour).
      const listing = await prisma.listing.findFirst({ where, include, orderBy: { updatedAt: 'desc' } });
      res.json(listing);
      return;
    }

    const listings = await prisma.listing.findMany({
      where,
      include,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

// ─── Latest Collections ─────────────────────────────────────────────────────

router.get('/latest-collections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '8')));
    const country = req.query.country as string | undefined;
    const countryFilter = country && ['UAE', 'UGANDA', 'KENYA', 'CHINA'].includes(country)
      ? { country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA' }
      : {};

    const listings = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        placement: 'LATEST_COLLECTIONS',
        placementExpiresAt: { gt: now },
        ...countryFilter,
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

// ─── Flash Sales ────────────────────────────────────────────────────────────

router.get('/flash-sales', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const country = req.query.country as string | undefined;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '8')));

    const listings = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        placement: 'FLASH_SALE',
        placementExpiresAt: { gt: now },
        ...(country && ['UAE','UGANDA','KENYA','CHINA'].includes(country)
          ? { country: country as 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA' }
          : {}),
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

router.get('/', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      category, location, country, priceMin, priceMax,
      condition, sort = 'createdAt', page = '1', limit = '20', q, brand, mine, userId, placement,
      verifiedOnly,
    } = req.query as Record<string, string>;

    if (mine === 'true' && !req.user) {
      return next(createError('Authentication required', 401));
    }

    const viewingOwnListings = mine === 'true' && !!req.user;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const VALID_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'] as const;
    type ValidCountry = typeof VALID_COUNTRIES[number];
    const isValidCountry = (c: string): c is ValidCountry => (VALID_COUNTRIES as readonly string[]).includes(c);

    // Category filter: matches listings whose category slug matches directly OR
    // whose category's parent slug matches (handles subcategory → parent routing).
    // Also matches listings categorised directly under the parent when browsing
    // a subcategory slug (e.g. category='used-cars' also returns listings filed
    // under the parent 'motors' category in the DB when no exact slug match exists).
    const buildCategoryFilter = (slug: string): Prisma.ListingWhereInput => ({
      OR: [
        { category: { slug } },
        { category: { parent: { slug } } },
        // When browsing a parent slug, include all its children
        { category: { parentId: { not: null }, parent: { slug } } },
      ],
    });

    const activeWhere = createActiveListingsWhere(req, now, viewingOwnListings, userId);

    // Build optional AND conditions (for q and category which both use OR internally)
    const andConditions: Prisma.ListingWhereInput[] = [];
    if (q) {
      andConditions.push({ OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ]});
    }
    if (category) {
      andConditions.push(buildCategoryFilter(category));
    }
    // Brand filter: matches the admin-defined "brand" custom field saved on
    // Listing.customFieldValues (see Category.fieldSchema), not free text —
    // an exact match against the JSON value so "Apple" doesn't also pull in
    // listings that merely mention Apple accessories in the description.
    if (brand) {
      andConditions.push({
        customFieldValues: { path: ['brand'], equals: brand } as Prisma.JsonFilter,
      });
    }
    // Merge any AND from activeWhere with our own
    const existingAnd = Array.isArray((activeWhere as Record<string, unknown>).AND)
      ? ((activeWhere as Record<string, unknown>).AND as Prisma.ListingWhereInput[])
      : (activeWhere as Record<string, unknown>).AND
        ? [(activeWhere as Record<string, unknown>).AND as Prisma.ListingWhereInput]
        : [];

    const where: Prisma.ListingWhereInput = {
      ...activeWhere,
      ...(placement === 'NONE'
        ? { placement: 'NONE' }
        : placement
          ? { placement: placement as 'FLASH_SALE' | 'FEATURED_DEAL' | 'LATEST_COLLECTIONS' | 'NONE' }
          : { NOT: { placement: 'FLASH_SALE' } }),
      ...(country && isValidCountry(country) && { country }),
      ...(location && { location: { contains: location, mode: 'insensitive' } }),
      ...(condition && { condition: condition as 'NEW' | 'USED' }),
      ...(verifiedOnly === 'true' && { user: { isKycVerified: true } }),
      ...((priceMin || priceMax) && {
        price: {
          ...(priceMin && { gte: parseFloat(priceMin) }),
          ...(priceMax && { lte: parseFloat(priceMax) }),
        },
      }),
      ...([...existingAnd, ...andConditions].length > 0
        ? { AND: [...existingAnd, ...andConditions] }
        : {}),
    };

    // ─── Search logging ───────────────────────────────────────────────────
    // A "search" is a typed term and/or an applied filter — bare unfiltered
    // browsing (e.g. the homepage feed, or paging through it) isn't logged.
    // "Viewing my own listings" (mine=true) is a dashboard view, not a
    // marketplace search, so it's excluded too. See utils/analyticsLogger.ts
    // for what gets recorded (search context is mandatory; user/location
    // details are attached only when available).
    const isSearchEvent = !viewingOwnListings && Boolean(
      (q && q.trim()) || category || location || brand || priceMin || priceMax ||
      condition || verifiedOnly === 'true',
    );
    const searchContext = {
      q: q?.trim() || undefined,
      category: category || undefined,
      location: location || undefined,
      country: country || undefined,
      priceMin: priceMin || undefined,
      priceMax: priceMax || undefined,
      condition: condition || undefined,
      brand: brand || undefined,
      verifiedOnly: verifiedOnly === 'true' ? true : undefined,
      sort,
      page: pageNum,
    };
    const logSearch = (resultCount: number) => {
      if (!isSearchEvent) return;
      void recordSearchLog(req, { query: q?.trim() || null, context: searchContext, resultCount })
        .catch((err) => logger.error('Failed to record search log', err));
    };

    if (sort === 'recommended') {
      const ranked = await getRecommendedListings({
        where,
        pageNum,
        limitNum,
        userId: req.user?.userId ?? null,
        country,
      });
      logSearch(ranked.pagination.total);
      res.json(ranked);
      return;
    }

    if (sort === 'relevance' && q && q.trim()) {
      const ranked = await getRelevanceRankedListings({ where, q, pageNum, limitNum });
      logSearch(ranked.pagination.total);
      res.json(ranked);
      return;
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput | Prisma.ListingOrderByWithRelationInput[] =
      sort === 'price_asc' ? { price: 'asc' }
      : sort === 'price_desc' ? { price: 'desc' }
      : sort === 'views' ? { views: 'desc' }
      // Default ("createdAt") and any unrecognized sort value: KYC-verified
      // sellers' listings surface first (their reward for completing identity
      // verification — see feature: buyers can "easily find" verified
      // sellers), then most recent within each tier.
      : [{ user: { isKycVerified: 'desc' } }, { createdAt: 'desc' }];

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: {
          // Include parent category so the frontend can match child categories to their parent tab
          category: {
            select: {
              id:       true,
              name:     true,
              slug:     true,
              parentId: true,
              parent:   { select: { id: true, name: true, slug: true } },
            },
          },
          user: {
            select: {
              id: true, name: true, avatar: true, isKycVerified: true,
              // phone/socialLinks needed by the Call Seller / Chat Seller
              // (WhatsApp) buttons — those can be reached from a listing
              // added to cart straight from a grid card, not just the
              // detail page, so this list endpoint needs the same seller
              // contact fields as GET /listings/:id above.
              phone: true, socialLinks: true,
              store: { select: { name: true, logo: true, slug: true } },
            },
          },
          productImages: {
            where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
            select: { id: true, cdnUrl: true, uploadedAt: true },
            orderBy: { uploadedAt: 'asc' },
          },
        },
        orderBy,
        skip,
        take: limitNum,
      }),
      prisma.listing.count({ where }),
    ]);

    logSearch(total);
    res.json({
      listings,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/engagement', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { durationSeconds } = req.body ?? {};
    const parsedDuration = Math.max(0, Math.min(3600, Number(durationSeconds) || 0));

    if (parsedDuration < 1) {
      res.status(204).end();
      return;
    }

    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!listing) return next(createError('Listing not found', 404));

    await prisma.listingEngagement.create({
      data: {
        listingId: listing.id,
        userId: req.user?.userId ?? null,
        durationSeconds: parsedDuration,
      },
    });

    res.status(201).json({ recorded: true });
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, price, currency, condition, images, imageIds, location, country, categoryId, stock, expiresAt, motorDetails, propertyDetails, jobDetails, productOptions, customFieldValues, latitude, longitude } = req.body;

    if (!title || !description || price == null || !location || !country || !categoryId || stock == null || stock === '') {
      return next(createError('Missing required fields', 400));
    }

    // ── Uganda-only listing creation ──
    // New listings may only be created for Uganda, regardless of what the
    // frontend sends (frontend-only restrictions can be bypassed via direct
    // API requests). Existing listings for other countries are untouched —
    // this only gates the creation of *new* listings.
    if (String(country).toUpperCase() !== 'UGANDA') {
      return next(createError('Country mismatch: Listings created through this endpoint must have Uganda as the country.', 400));
    }

    // Validate that the price is a positive number
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return next(createError('Price must be a valid non-negative number', 400));
    }

    // Validate stock — required, non-negative whole number
    const parsedStock = parseInt(stock, 10);
    if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== String(stock).trim()) {
      return next(createError('Stock must be a valid non-negative whole number', 400));
    }

    // Validate category exists
    const categoryExists = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { parent: { select: { slug: true } } },
    });
    if (!categoryExists) {
      return next(createError('Category not found', 400));
    }

    // Enforce any admin-defined required custom fields for this category
    // (Category.fieldSchema — see /admin/categories "Custom Fields").
    const missingCustomFields = missingRequiredCustomFields(categoryExists.fieldSchema, customFieldValues);
    if (missingCustomFields.length > 0) {
      return next(createError(`Please fill in the following required field(s): ${missingCustomFields.join(', ')}`, 400));
    }

    // ── Agriculture is open to every user role, unlike the rest of the
    //    marketplace — a smallholder farmer posting a sack of maize doesn't
    //    have (and shouldn't need) an "Agent/Company/Organization" account
    //    or a paid seller subscription just to reach buyers. Everything
    //    else about the pipeline is unchanged: it's still a normal Listing
    //    row, it still lands as PENDING for a non-admin poster (see
    //    `status: isAdmin ? 'ACTIVE' : 'PENDING'` below), and it still goes
    //    through the same /admin/listings approval queue as every other
    //    category — this only lifts the role/subscription gate in front of
    //    that queue, not the queue itself.
    const isAgricultureCategory = categoryExists.slug === 'agriculture' || categoryExists.parent?.slug === 'agriculture';

    // ── Role check: only Agents, Companies, Organizations and Admins can post
    //    (Agriculture is exempt — see note above) ──
    const allowedRoles = ['ADMIN', 'AGENT', 'COMPANY', 'ORGANIZATION'];
    if (!isAgricultureCategory && !allowedRoles.includes(req.user!.role)) {
      return next(createError('Only Agents, Companies, Organizations and Admins can post listings.', 403));
    }

    // ── Subscription / package check (skip for admins, active store owners,
    //    and Agriculture postings — see note above) ─
    if (req.user!.role !== 'ADMIN' && !isAgricultureCategory) {
      const userId = req.user!.userId;

      // Store owners with an active rental are exempt from subscription requirements
      const activeRental = await prisma.storeRental.findFirst({
        where: { userId, status: 'ACTIVE', endDate: { gt: new Date() } },
      });

      if (activeRental) {
        // Store rentals still carry their own listing cap (default 100) —
        // being exempt from the seller-package subscription doesn't mean
        // unlimited listings.
        if (activeRental.maxListings != null) {
          const storeListingCount = await prisma.listing.count({
            where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
          });
          if (storeListingCount >= activeRental.maxListings) {
            return next(createError(
              `Your store allows a maximum of ${activeRental.maxListings} active listings. Please contact admin to increase your limit.`,
              403,
            ));
          }
        }
      } else {
        // Expire overdue subscriptions
        await prisma.sellerSubscription.updateMany({
          where: { userId, status: 'ACTIVE', endDate: { lt: new Date() } },
          data: { status: 'EXPIRED' },
        });

        let activeSub = await prisma.sellerSubscription.findFirst({
          where: { userId, status: 'ACTIVE', package: { scope: 'LISTING' } },
          include: { package: true },
          orderBy: { endDate: 'desc' },
        });

        // Auto-enroll in free package if no subscription exists
        if (!activeSub) {
          const freePkg = await prisma.sellerPackage.findFirst({
            where: { isFree: true, isActive: true, scope: 'LISTING' },
            orderBy: { createdAt: 'asc' },
          });

          if (freePkg) {
            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + freePkg.durationDays);

            activeSub = await prisma.sellerSubscription.create({
              data: { userId, packageId: freePkg.id, status: 'ACTIVE', startDate, endDate },
              include: { package: true },
            });

            // Notify seller about free trial
            await prisma.notification.create({
              data: {
                userId,
                type: 'SUBSCRIPTION_ACTIVATED',
                title: 'Free Trial Activated',
                message: `You have been enrolled in the "${freePkg.name}" free package (valid for ${freePkg.durationDays} days).`,
                data: { subscriptionId: activeSub.id, packageName: freePkg.name },
              },
            });
          }
        }

        if (!activeSub) {
          return next(createError('An active subscription is required to post listings. Please subscribe to a package.', 403));
        }

        // Check maxListings quota
        if (activeSub.package.maxListings != null) {
          const listingCount = await prisma.listing.count({
            where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
          });
          if (listingCount >= activeSub.package.maxListings) {
            return next(createError(
              `Your current package allows a maximum of ${activeSub.package.maxListings} active listings. Please upgrade your plan.`,
              403,
            ));
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Build the initial images array: prefer CDN URLs from ProductImage records.
    let initialImages: string[] = images || [];

    // If imageIds supplied, resolve CDN URLs (fall back to temp preview for legacy records).
    if (Array.isArray(imageIds) && imageIds.length > 0) {
      const productImages = await prisma.productImage.findMany({
        where: { id: { in: imageIds as string[] }, sellerId: req.user!.userId },
      });
      const resolvedUrls = productImages.map((pi) =>
        pi.cdnUrl || (pi.tempPath ? `/uploads/temp/${pi.tempPath}` : null),
      ).filter((u): u is string => Boolean(u));
      initialImages = [...initialImages, ...resolvedUrls];
    }

    // Remove empty/null entries but keep all URL forms (including localhost proxy URLs
    // used in development) — the frontend resolveImageUrl helper rewrites them.
    initialImages = initialImages.filter(Boolean);

    // Admins bypass the approval workflow — their listings go live immediately.
    const isAdmin = req.user!.role === 'ADMIN';

    const listing = await prisma.listing.create({
      data: {
        title, description,
        price: parsedPrice,
        currency: currency || 'UGX',
        condition: condition || 'USED',
        status: isAdmin ? 'ACTIVE' : 'PENDING',
        images: initialImages,
        stock: parsedStock,
        location, country,
        userId: req.user!.userId,
        categoryId,
        ...(expiresAt && { expiresAt: new Date(expiresAt) }),
        ...(motorDetails && { motorDetails }),
        ...(propertyDetails && { propertyDetails }),
        ...(jobDetails && { jobDetails }),
        ...(productOptions && { productOptions }),
        ...(customFieldValues && { customFieldValues }),
        ...(latitude != null && { latitude: parseFloat(latitude) }),
        ...(longitude != null && { longitude: parseFloat(longitude) }),
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
      },
    });

    // Link ProductImage records to this listing.
    if (Array.isArray(imageIds) && imageIds.length > 0) {
      await prisma.productImage.updateMany({
        where: { id: { in: imageIds as string[] }, sellerId: req.user!.userId },
        data: { listingId: listing.id },
      });
    }

    res.status(201).json(listing);
  } catch (err) {
    next(err);
  }
});

// ─── Bulk produce posting — Agriculture only, open to every user role ──────
// POST /listings/bulk-produce
//
// The general-purpose bulk endpoint (POST /admin/listings/bulk) is an
// admin-only power tool for seeding/managing the catalogue: it's gated by
// `router.use(authenticate, authorize('ADMIN'))` in admin.ts, creates
// listings under the admin's own userId, and sets every item straight to
// ACTIVE (admins don't need to approve their own bulk work). None of that
// fits a farmer posting their own harvest, so this is a separate, narrower
// endpoint rather than a role-based branch bolted onto the admin one:
//   - open to any authenticated user (same role exemption as the single
//     POST / above, restricted the same way to the Agriculture category)
//   - each listing is owned by the actual poster (req.user.userId), not an
//     admin
//   - every item lands as PENDING for a non-admin poster — same approval
//     queue as everything else, see /admin/listings — and only an admin
//     caller gets ACTIVE, matching POST / exactly
interface BulkProduceItem {
  title: string;
  description: string;
  price: number | string;
  currency?: string;
  condition?: 'NEW' | 'USED';
  stock: number | string;
  location: string;
  country: string;
  categoryId: string;
  images?: string[];
  imageIds?: string[];
}

const BULK_PRODUCE_MAX_ITEMS = 20;

router.post('/bulk-produce', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listings: items } = req.body as { listings: BulkProduceItem[] };

    if (!Array.isArray(items) || items.length === 0) {
      return next(createError('listings array is required and must not be empty', 400));
    }
    if (items.length > BULK_PRODUCE_MAX_ITEMS) {
      return next(createError(`Cannot post more than ${BULK_PRODUCE_MAX_ITEMS} products in a single bulk request`, 400));
    }

    const isAdmin = req.user!.role === 'ADMIN';
    const userId = req.user!.userId;

    // Validate every item up front — required fields, Uganda-only (mirrors
    // the single-post restriction above), and every categoryId must resolve
    // to the Agriculture category or one of its subcategories. One bad item
    // fails the whole batch rather than silently skipping it.
    const categoryIds = [...new Set(items.map((it) => it.categoryId).filter(Boolean))];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      include: { parent: { select: { slug: true } } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = `Item ${i + 1}`;
      if (!item.title || !item.description || item.price == null || !item.location || !item.country || !item.categoryId || item.stock == null || item.stock === '') {
        return next(createError(`${label}: missing required fields`, 400));
      }
      if (String(item.country).toUpperCase() !== 'UGANDA') {
        return next(createError(`${label}: country must be Uganda`, 400));
      }
      const parsedPrice = parseFloat(String(item.price));
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return next(createError(`${label}: price must be a valid non-negative number`, 400));
      }
      const parsedStock = parseInt(String(item.stock), 10);
      if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== String(item.stock).trim()) {
        return next(createError(`${label}: stock must be a valid non-negative whole number`, 400));
      }
      const cat = categoryById.get(item.categoryId);
      if (!cat) {
        return next(createError(`${label}: category not found`, 400));
      }
      if (cat.slug !== 'agriculture' && cat.parent?.slug !== 'agriculture') {
        return next(createError(`${label}: bulk produce posting is only available for the Agriculture category`, 400));
      }
    }

    const created = await prisma.$transaction(
      items.map((item) => {
        const parsedPrice = parseFloat(String(item.price));
        const parsedStock = parseInt(String(item.stock), 10);
        return prisma.listing.create({
          data: {
            title: item.title,
            description: item.description,
            price: parsedPrice,
            currency: (item.currency || 'UGX') as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD',
            condition: item.condition || 'NEW',
            status: isAdmin ? 'ACTIVE' : 'PENDING',
            images: (item.images || []).filter(Boolean),
            stock: parsedStock,
            location: item.location,
            country: 'UGANDA',
            userId,
            categoryId: item.categoryId,
          },
        });
      })
    );

    // Link any ProductImage records supplied via imageIds, same as the
    // single-post path — best-effort per item so one missing/foreign image
    // doesn't fail the whole already-created batch.
    await Promise.all(
      items.map(async (item, i) => {
        if (Array.isArray(item.imageIds) && item.imageIds.length > 0) {
          const productImages = await prisma.productImage.findMany({
            where: { id: { in: item.imageIds }, sellerId: userId },
          });
          const resolvedUrls = productImages
            .map((pi) => pi.cdnUrl || (pi.tempPath ? `/uploads/temp/${pi.tempPath}` : null))
            .filter((u): u is string => Boolean(u));
          if (resolvedUrls.length > 0) {
            await prisma.listing.update({
              where: { id: created[i].id },
              data: { images: { push: resolvedUrls } },
            });
          }
          await prisma.productImage.updateMany({
            where: { id: { in: item.imageIds }, sellerId: userId },
            data: { listingId: created[i].id },
          });
        }
      })
    );

    res.status(201).json({ created: created.length, listings: created });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      include: {
        category: {
          include: { parent: { select: { id: true, name: true, slug: true } } },
        },
        user: {
          select: {
            id: true, name: true, avatar: true, phone: true,
            country: true, createdAt: true, role: true, isVerified: true, isKycVerified: true,
            // socialLinks.whatsapp is a distinct WhatsApp contact a seller can
            // set (may differ from their `phone`) — surfaced on the listing
            // page's Call/Chat Seller buttons so each channel uses whichever
            // number the seller actually wants for that channel.
            socialLinks: true,
            // Include the user's store so the UI can link to it
            store: { select: { id: true, name: true, slug: true, logo: true, isActive: true } },
          },
        },
        productImages: {
          where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } },
          select: { id: true, cdnUrl: true, uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
      },
    });

    if (!listing) return next(createError('Listing not found', 404));

    // Dormant/expired listings are not viewable by the public
    if (listing.status === 'EXPIRED') {
      return next(createError('This listing has expired and is no longer available', 410));
    }

    await prisma.listing.update({ where: { id: req.params.id }, data: { views: { increment: 1 } } });

    // Record the "item clicked" event — fire-and-forget so a logging
    // failure or slow write never delays or breaks the listing page.
    void recordListingClick(req, listing).catch((err) => logger.error('Failed to record listing click log', err));

    res.json(listing);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Forbidden', 403));
    }

    const {
      title, description, price, condition, images, imageIds, location,
      status, expiresAt, motorDetails, currency, country, categoryId, stock, sku,
      propertyDetails, jobDetails, productOptions, customFieldValues, latitude, longitude,
    } = req.body;

    // Stock is a mandatory field on every listing — if it's included in the
    // update payload (e.g. the edit form always sends it), it must be a
    // valid non-negative whole number. Omitting the key entirely leaves the
    // existing stock value untouched (e.g. for partial/status-only updates).
    let parsedStock: number | undefined;
    if (stock !== undefined) {
      parsedStock = parseInt(stock, 10);
      if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== String(stock).trim()) {
        return next(createError('Stock must be a valid non-negative whole number', 400));
      }
    }

    // Enforce any admin-defined required custom fields for the listing's
    // (possibly newly selected) category — same rule as on create.
    if (customFieldValues !== undefined) {
      const effectiveCategoryId = categoryId !== undefined ? categoryId : listing.categoryId;
      const effectiveCategory = await prisma.category.findUnique({ where: { id: effectiveCategoryId } });
      if (!effectiveCategory) return next(createError('Category not found', 400));

      const missingCustomFields = missingRequiredCustomFields(effectiveCategory.fieldSchema, customFieldValues);
      if (missingCustomFields.length > 0) {
        return next(createError(`Please fill in the following required field(s): ${missingCustomFields.join(', ')}`, 400));
      }
    }

    // Resolve imageIds to CDN/temp URLs, then merge with any directly supplied images
    let finalImages: string[] = Array.isArray(images) ? [...images] : [];
    if (Array.isArray(imageIds) && imageIds.length > 0) {
      const productImgs = await prisma.productImage.findMany({
        where: { id: { in: imageIds as string[] }, sellerId: req.user!.userId },
      });
      const resolvedUrls = productImgs.map((pi) =>
        pi.cdnUrl || (pi.tempPath ? `/uploads/temp/${pi.tempPath}` : null),
      ).filter((u): u is string => Boolean(u));
      finalImages = [...finalImages, ...resolvedUrls];
    }
    finalImages = finalImages.filter(Boolean);

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...(title       !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(price       != null       && { price: parseFloat(price) }),
        ...(condition   !== undefined && { condition }),
        ...(parsedStock !== undefined && { stock: parsedStock }),
        ...(sku         !== undefined && { sku: (sku ?? '').toString().trim() || null }),
        ...(location    !== undefined && { location }),
        ...(status      !== undefined && { status }),
        ...(expiresAt   !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(currency    !== undefined && { currency }),
        ...(country     !== undefined && { country }),
        ...(categoryId  !== undefined && { categoryId }),
        ...(latitude    !== undefined && { latitude: latitude !== null ? parseFloat(latitude) : null }),
        ...(longitude   !== undefined && { longitude: longitude !== null ? parseFloat(longitude) : null }),
        ...(motorDetails    !== undefined && { motorDetails }),
        ...(propertyDetails !== undefined && { propertyDetails }),
        ...(jobDetails      !== undefined && { jobDetails }),
        ...(productOptions  !== undefined && { productOptions }),
        ...(customFieldValues !== undefined && { customFieldValues }),
        ...(finalImages.length > 0 && { images: finalImages }),
      },
      include: {
        category: {
          select: {
            id: true, name: true, slug: true, parentId: true, fieldSchema: true,
            parent: { select: { id: true, name: true, slug: true } },
          },
        },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: {
          where: { cdnUrl: { not: null } },
          select: { id: true, cdnUrl: true, uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Forbidden', 403));
    }

    await prisma.listing.delete({ where: { id: req.params.id } });
    res.json({ message: 'Listing deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/favorite', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.favorite.findUnique({
      where: { userId_listingId: { userId: req.user!.userId, listingId: req.params.id } },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      res.json({ favorited: false });
    } else {
      // Verify listing exists and get owner details for the email notification
      const listing = await prisma.listing.findUnique({
        where: { id: req.params.id },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      if (!listing) return next(createError('Listing not found', 404));

      await prisma.favorite.create({ data: { userId: req.user!.userId, listingId: req.params.id } });

      // Send email notification to the listing owner (skip if the owner is liking their own listing)
      if (listing.user && listing.user.id !== req.user!.userId) {
        const liker = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { name: true },
        });
        const likerName = liker?.name || 'A user';
        void sendListingLikedEmail(
          listing.user.email,
          listing.user.name,
          listing.title,
          listing.id,
          likerName,
          req.user!.userId,
        ).catch((err) => logger.warn(`Failed to send listing liked email: ${String(err)}`));
      }

      res.json({ favorited: true });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/:id/favorites', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const favorite = await prisma.favorite.findUnique({
      where: { userId_listingId: { userId: req.user!.userId, listingId: req.params.id } },
    });
    res.json({ favorited: !!favorite });
  } catch (err) {
    next(err);
  }
});

// PATCH /listings/:id/status — owner updates listing status
router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Forbidden', 403));
    }

    const { status } = req.body;
    const allowedStatuses = ['ACTIVE', 'SOLD', 'HIDDEN'];
    if (!status || !allowedStatuses.includes(status)) {
      return next(createError(`status must be one of: ${allowedStatuses.join(', ')}`, 400));
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: { status },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.json({ listing: updated });
  } catch (err) {
    next(err);
  }
});

// PATCH /listings/:id/placement — owner with active rental updates placement
router.patch('/:id/placement', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Forbidden', 403));
    }

    const { placement, placementExpiresAt } = req.body;
    const allowedPlacements = ['NONE', 'LATEST_COLLECTIONS', 'FLASH_SALE', 'FEATURED_DEAL'];
    if (!placement || !allowedPlacements.includes(placement)) {
      return next(createError(`placement must be one of: ${allowedPlacements.join(', ')}`, 400));
    }

    // Non-admin users must have an active rental to use non-NONE placements
    if (req.user!.role !== 'ADMIN' && placement !== 'NONE') {
      const now = new Date();
      const activeRental = await prisma.storeRental.findFirst({
        where: { userId: req.user!.userId, status: 'ACTIVE', endDate: { gt: now } },
      });
      if (!activeRental) {
        return next(createError('An active store rental is required to set listing placement', 403));
      }
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        placement,
        // IMPORTANT: the homepage queries for Flash Sales / Latest Collections /
        // Featured Deal all require `placementExpiresAt: { gt: now }` to show a
        // listing. Previously, when no explicit placementExpiresAt was supplied
        // (true for every caller of this endpoint — the individual and bulk
        // placement controls in /profile/listings never send one), this fell
        // through to `null`, which never satisfies `{ gt: now }` — so the
        // listing's placement was saved successfully but the listing could
        // never actually appear anywhere on the homepage. Defaulting to 90
        // days out here makes placements set through this endpoint actually
        // take effect, matching the working convention already used by the
        // admin "approve with placement" endpoint elsewhere in this codebase.
        placementExpiresAt: placement === 'NONE'
          ? null
          : (placementExpiresAt ? new Date(placementExpiresAt) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)),
      },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.json({ listing: updated });
  } catch (err) {
    next(err);
  }
});

// GET /listings/:id/analytics — owner views listing analytics
router.get('/:id/analytics', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Forbidden', 403));
    }

    res.json({ views: listing.views });
  } catch (err) {
    next(err);
  }
});

export default router;
