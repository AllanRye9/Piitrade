import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { maskUserContact } from '../utils/contactPrivacy';
import { loadListingEntitlement } from '../utils/subscriptionService';
import { ownerMayChangeStatus } from '../utils/listingStatus';
import { LISTING_LIMITS, checkText, checkJsonBlob, parsePrice, parseCoordinate, parseFutureDate, sanitizeImageUrls } from '../utils/listingInput';
import { authenticate, AuthRequest, optionalAuthenticate } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import { sendListingLikedEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { recordSearchLog, recordListingClick } from '../utils/analyticsLogger';
import { callLLMJson } from '../lib/llm';
import { parseSearchQuery, hasSearchTerms, buildSearchWhere, scoreListing, correctQuery, completeWord, singularize } from '../utils/search';
import { getGeneralSettings } from '../utils/siteSettings';
import { resolveSpecialOffers, resolveBackToSchool, parseOriginalPrice, discountPercent } from '../utils/offers';

/** Optional "units available" — undefined/blank → null; otherwise a non-negative whole number. */
function parseQuantity(raw: unknown): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const n = parseInt(String(raw), 10);
  if (isNaN(n) || n < 0 || String(n) !== String(raw).trim()) return { error: 'Quantity must be a valid non-negative whole number' };
  return { value: n };
}


import { DEFAULT_PLACEMENT_MS } from '../utils/placement';

const router = Router();

// Admin-pinned listings (Admin → Homepage Layout) sort first, lowest pinOrder
// wins; unpinned listings (NULL) fall through to the normal ordering.
const PIN_FIRST = { pinOrder: { sort: 'asc', nulls: 'last' } } as const;

// ─── AI Ad Moderation (Module 1) ────────────────────────────────────────────
// Runs on every non-admin listing creation (POST / below) and edit
// (PUT /:id) — admin-authored listings skip this entirely, since they
// already bypass the human PENDING-review step too (see `isAdmin` below).
// The prompt and JSON schema are used verbatim from the moderation spec
// this was built from; only the auto-reject threshold is a project-side
// decision, not part of that spec.

const MODERATION_SYSTEM_PROMPT = `You are an automated classifieds marketplace moderation engine. Your task is to analyze the provided product listing (title and description) and determine if it violates marketplace safety guidelines (scams, illegal items, extreme price gouging, external personal links, or suspicious contact requests).

You must respond ONLY with a valid JSON object. Do not include any markdown styling, backticks, introductory text, or concluding text.

The JSON structure must match this template exactly:
{
  "approved": boolean,
  "flagged_category": "spam" | "scam" | "prohibited_goods" | "none",
  "confidence_score": float (0.0 to 1.0),
  "developer_reason": "Brief technical explanation of why it was flagged or approved"
}`;

interface ModerationResult {
  approved: boolean;
  flagged_category: 'spam' | 'scam' | 'prohibited_goods' | 'none';
  confidence_score: number;
  developer_reason: string;
}

const MODERATION_FLAGGED_CATEGORIES = new Set(['spam', 'scam', 'prohibited_goods', 'none']);

// Above this confidence, a flagged listing is auto-rejected outright rather
// than just landing as PENDING with the flag visible to the reviewing
// admin. Configurable since "confident enough to auto-reject without a
// human in the loop" is a business risk-tolerance call, not a fixed
// property of the model. 0.9 is a deliberately high bar — false positives
// here mean an honest seller's listing gets rejected with no review at all,
// so this errs toward "only the clearest cases," leaving everything else
// for a human admin to decide (still informed by the same AI reasoning,
// surfaced in the review UI).
const MODERATION_AUTO_REJECT_THRESHOLD = Number(process.env.MODERATION_AUTO_REJECT_THRESHOLD) || 0.9;

/**
 * Returns null if the LLM isn't configured, the call fails, or the reply
 * doesn't match the expected shape (treated the same as "unavailable" —
 * moderation is a safety net, not a gate that should ever hard-block
 * listing creation just because the LLM had a bad day). Every call site
 * must handle a null result by proceeding as if moderation had never run
 * (the listing still goes through the normal PENDING human-review flow).
 */
async function moderateListing(title: string, description: string, price: number): Promise<ModerationResult | null> {
  const userPrompt = `Analyze the following marketplace listing:\n---\nTitle: ${title}\nDescription: ${description}\nPrice: ${price}\n---`;
  const result = await callLLMJson<ModerationResult>(MODERATION_SYSTEM_PROMPT, userPrompt);
  if (!result) return null;

  if (
    typeof result.approved !== 'boolean' ||
    typeof result.confidence_score !== 'number' ||
    !MODERATION_FLAGGED_CATEGORIES.has(result.flagged_category) ||
    typeof result.developer_reason !== 'string'
  ) {
    logger.error('LLM moderation response failed shape validation', result);
    return null;
  }

  return result;
}

// ─── AI Cataloging & SEO Tagging (Module 3) ─────────────────────────────────
// Unlike moderation, this is never run automatically as part of listing
// creation — it's an opt-in suggestion the seller (or an admin, in
// bulk-post) explicitly asks for via POST /listings/suggest-tags below,
// reviews, and applies themselves. Two reasons: stacking a second
// synchronous LLM call onto every listing creation would compound latency
// on top of moderation above, and silently overwriting a category or tags a
// seller already chose is exactly the kind of unasked-for modification this
// project avoids — the spec's "automatically parse" is satisfied by the
// parsing being one click away and pre-filling empty fields, not by
// bypassing what the seller already entered.

const CATALOGING_SYSTEM_PROMPT = `You are a backend data-enrichment pipeline asset. Your job is to extract clean, standardized structured data from messy, user-generated e-commerce product listings.

You must output a raw JSON object. Do not include markdown code blocks, metadata, or conversation.

JSON Template:
{
  "primary_category": string,
  "standardized_tags": array of strings (lowercase, max 5 tags),
  "detected_brand": string or null,
  "condition_estimate": "new" | "used" | "unknown"
}`;

interface CatalogingResult {
  primary_category: string;
  standardized_tags: string[];
  detected_brand: string | null;
  condition_estimate: 'new' | 'used' | 'unknown';
}

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
            where: { cdnUrl: { not: null }, status: { not: 'REJECTED' as const } },
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
  const parsed = parseSearchQuery(q);

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
          where: { cdnUrl: { not: null }, status: { not: 'REJECTED' as const } },
          select: { id: true, cdnUrl: true, uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.listing.count({ where }),
  ]);

  const scored = candidates.map((listing) => ({ listing, score: scoreListing(listing, parsed) }));
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

// ─── Search type-ahead ──────────────────────────────────────────────────────
// GET /listings/suggest?q=lap  →  { listings, categories, terms, correctedQuery }
// Cheap, public, capped: powers the header search dropdown.
router.get('/suggest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) {
      res.json({ listings: [], categories: [], terms: [], correctedQuery: null });
      return;
    }
    const categorySlug = String(req.query.category || '').trim();
    let parsed = parseSearchQuery(q);
    let correctedQuery: string | null = null;

    const now = new Date();
    const baseWhere = (pq: ReturnType<typeof parseSearchQuery>): Prisma.ListingWhereInput => ({
      AND: [
        { status: 'ACTIVE' },
        { country: 'UGANDA' },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ...(categorySlug ? [{ OR: [{ category: { slug: categorySlug } }, { category: { parent: { slug: categorySlug } } }] }] : []),
        ...(hasSearchTerms(pq) ? [buildSearchWhere(pq)] : []),
      ],
    });
    const select = {
      id: true, title: true, description: true, price: true, originalPrice: true, currency: true, location: true,
      tags: true, views: true, tier: true, createdAt: true, images: true,
      category: { select: { name: true, slug: true, parent: { select: { name: true } } } },
      user: { select: { isKycVerified: true } },
      productImages: {
        where: { cdnUrl: { not: null }, status: { not: 'REJECTED' as const } },
        select: { cdnUrl: true }, orderBy: { uploadedAt: 'asc' as const }, take: 1,
      },
    };

    let candidates = await prisma.listing.findMany({ where: baseWhere(parsed), select, orderBy: { createdAt: 'desc' }, take: 60 });
    if (candidates.length === 0) {
      const fixed = await correctQuery(parsed);
      if (fixed) {
        correctedQuery = fixed;
        parsed = parseSearchQuery(fixed);
        candidates = await prisma.listing.findMany({ where: baseWhere(parsed), select, orderBy: { createdAt: 'desc' }, take: 60 });
      }
    }
    const top = candidates
      .map((l) => ({ l, score: scoreListing(l, parsed) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ l }) => ({
        id: l.id,
        title: l.title,
        price: l.price,
        originalPrice: l.originalPrice,
        location: l.location,
        category: l.category?.name || null,
        image: l.productImages?.[0]?.cdnUrl || l.images?.[0] || null,
      }));

    const last = singularize(parsed.tokens[parsed.tokens.length - 1] || '');
    const lastRaw = (q.toLowerCase().split(/\s+/).pop() || '').replace(/[^a-z0-9]/g, '');
    const [categories, completions] = await Promise.all([
      prisma.category.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, ...(last.length >= 3 ? [{ name: { contains: last, mode: 'insensitive' as const } }] : [])] },
        select: { name: true, slug: true, parent: { select: { name: true, slug: true } } },
        take: 4,
      }),
      completeWord(lastRaw, 4),
    ]);
    const prefix = q.toLowerCase().replace(/\S+$/, '').trim();
    const terms = completions.map((w) => (prefix ? `${prefix} ${w}` : w));

    res.json({ listings: top, categories, terms, correctedQuery });
  } catch (err) {
    next(err);
  }
});

// ─── Popular searches ───────────────────────────────────────────────────────
// GET /listings/popular-searches?limit=8
// Real demand: the most-searched terms of the last 30 days, taken from
// SearchLog. A term counts once per distinct searcher (user or IP) so one
// person repeating a query can't push it up, searches that returned nothing
// are ignored (nobody benefits from suggesting a dead end), and recent
// searches weigh more than old ones. Cached for 10 minutes.
let popularCache: { at: number; terms: { term: string; searches: number }[] } | null = null;

function normalizePopularTerm(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[^\p{L}\p{N}\s\-+.]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40) return null;
  if (/^[\d\s\-+.]+$/.test(t)) return null;          // pure numbers / phone-like
  if (/(https?|www\.|@)/i.test(raw)) return null;      // links / emails
  if (t.split(' ').length > 5) return null;             // sentences, not searches
  return t;
}

async function computePopularSearches(): Promise<{ term: string; searches: number }[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.searchLog.findMany({
    where: { createdAt: { gte: since }, query: { not: null }, resultCount: { gt: 0 } },
    select: { query: true, ip: true, userId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20000,
  });
  const byTerm = new Map<string, { searchers: Set<string>; weight: number; display: Map<string, number> }>();
  const now = Date.now();
  for (const r of rows) {
    const term = normalizePopularTerm(r.query || '');
    if (!term) continue;
    const who = r.userId || r.ip || 'anon';
    const entry = byTerm.get(term) ?? { searchers: new Set<string>(), weight: 0, display: new Map<string, number>() };
    if (!entry.searchers.has(who)) {
      entry.searchers.add(who);
      const ageDays = (now - new Date(r.createdAt).getTime()) / 86400000;
      entry.weight += Math.pow(0.5, ageDays / 10); // half-life of 10 days
    }
    const shown = (r.query || '').trim();
    entry.display.set(shown, (entry.display.get(shown) ?? 0) + 1);
    byTerm.set(term, entry);
  }
  return [...byTerm.entries()]
    .filter(([, e]) => e.searchers.size >= 2) // at least two different people
    .sort((a, b) => b[1].weight - a[1].weight || b[1].searchers.size - a[1].searchers.size)
    .slice(0, 30)
    .map(([term, e]) => {
      // Show the most common original spelling/casing, e.g. "iPhone" not "iphone".
      const best = [...e.display.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || term;
      return { term: best.length <= 40 ? best : term, searches: e.searchers.size };
    });
}

router.get('/popular-searches', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '8'), 10) || 8, 1), 20);
  try {
    if (!popularCache || Date.now() - popularCache.at > 10 * 60 * 1000) {
      popularCache = { at: Date.now(), terms: await computePopularSearches() };
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ terms: popularCache.terms.slice(0, limit), source: 'searches' });
  } catch (err) {
    logger.warn(`popular-searches failed: ${String(err)}`);
    res.json({ terms: [], source: 'unavailable' }); // client falls back to its defaults
  }
});

// ─── Photo search: resolve AI terms into a query that really has results ─────
// POST /listings/image-match { queries: string[], labels?: string[] }
// The vision models give a description and classifier labels. This turns them
// into a search that is guaranteed to be useful: it tries the full phrase, then
// progressively broader variants (dropping adjectives, then brand/model), and
// returns the first one that matches live listings, plus matching categories
// as a last resort. So a photo search never lands on an empty page.
router.post('/image-match', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clean = (v: unknown): string[] =>
      (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 8);
    const queries = clean(req.body?.queries);
    const labels = clean(req.body?.labels);

    const variants: string[] = [];
    const add = (v: string) => { const k = v.trim(); if (k.length >= 2 && !variants.some((x) => x.toLowerCase() === k.toLowerCase())) variants.push(k); };
    for (const q of queries) {
      const words = q.split(/\s+/);
      add(q);
      if (words.length > 3) add(words.slice(-3).join(' '));
      if (words.length > 2) add(words.slice(-2).join(' '));
      if (words.length > 1) add(words[words.length - 1]);
    }
    labels.forEach(add);

    const now = new Date();
    const active: Prisma.ListingWhereInput[] = [{ status: 'ACTIVE' }, { country: 'UGANDA' }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }];
    let chosen: { query: string; count: number } | null = null;
    for (const v of variants.slice(0, 14)) {
      const parsed = parseSearchQuery(v);
      if (!hasSearchTerms(parsed)) continue;
      const count = await prisma.listing.count({ where: { AND: [...active, buildSearchWhere(parsed)] } });
      if (count > 0) { chosen = { query: v, count }; break; }
    }

    // Categories whose name appears in the terms (e.g. "laptop" -> Laptops).
    const tokens = [...new Set([...queries, ...labels].join(' ').toLowerCase().split(/[^a-z0-9]+/).map(singularize).filter((t) => t.length >= 4))].slice(0, 10);
    const categories = tokens.length
      ? await prisma.category.findMany({
          where: { OR: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })) },
          select: { name: true, slug: true, parent: { select: { slug: true } } },
          take: 4,
        })
      : [];

    res.json({
      query: chosen?.query ?? null,
      count: chosen?.count ?? 0,
      categories: categories.map((c) => ({ name: c.name, slug: c.parent?.slug || c.slug })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Featured Deal ──────────────────────────────────────────────────────────

router.get('/featured-deal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const country = req.query.country as string | undefined;
    const countryFilter = country && ['UGANDA'].includes(country)
      ? { country: country as 'UGANDA' }
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
      const listing = await prisma.listing.findFirst({ where, include, orderBy: [PIN_FIRST, { updatedAt: 'desc' }] });
      res.json(listing);
      return;
    }

    const listings = await prisma.listing.findMany({
      where,
      include,
      orderBy: [PIN_FIRST, { updatedAt: 'desc' }],
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
    const countryFilter = country && ['UGANDA'].includes(country)
      ? { country: country as 'UGANDA' }
      : {};

    // Gold and Platinum listings are wired into this — the most visible
    // premium row on the site — automatically the moment they're active
    // (no separate placement step for an admin or seller to remember),
    // alongside listings deliberately placed here. `tierExpiresAt` is
    // re-checked at query time so a lapsed tier drops out immediately,
    // without waiting for the hourly expireOverdueListingTiers sweep.
    const listings = await prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        ...countryFilter,
        OR: [
          { placement: 'LATEST_COLLECTIONS', placementExpiresAt: { gt: now } },
          {
            tier: { in: ['GOLD', 'PLATINUM'] },
            OR: [{ tierExpiresAt: null }, { tierExpiresAt: { gt: now } }],
          },
        ],
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
      },
      orderBy: [PIN_FIRST, { tier: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });

    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

// ─── AI Cataloging & SEO Tagging (Module 3) ─────────────────────────────────
// Seller-facing "auto-generate tags & category" suggestion — called from an
// explicit button in the listing form (both the single-listing create page
// and bulk-post), never automatically. Returns the LLM's suggestion as-is;
// the caller decides what to do with it (pre-fill blank fields, show for
// review, etc.) — this endpoint makes no changes to any listing itself.
router.post('/suggest-tags', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description } = req.body as { title?: string; description?: string };
    if (!title || !description) {
      throw createError('title and description are required', 400);
    }

    const userPrompt = `Extract attributes from this listing raw input:\n"${title}\n${description}"`;
    const result = await callLLMJson<CatalogingResult>(CATALOGING_SYSTEM_PROMPT, userPrompt);

    if (!result) {
      // Fails open with a 200 + null suggestion rather than a 5xx — this is
      // an optional enrichment button, not a required step, so "the LLM is
      // unavailable right now" shouldn't read as a broken feature to the
      // seller filling out their form.
      res.json({ suggestion: null });
      return;
    }

    res.json({ suggestion: result });
  } catch (err) {
    next(err);
  }
});

// ─── Back to School (admin-controlled: visibility/timing + curated listings) ──
// Which listings appear is placement-driven (Listing.placement =
// 'BACK_TO_SCHOOL', assigned by an admin — see PUT /admin/listings/:id and
// /admin/listings/:id/approve), same mechanism as Flash Sale/Featured
// Deal/Latest Collections above. Additionally gated by
// SiteConfig.backToSchool ({ enabled, startAt, endAt }) — the section-level
// on/off switch and optional scheduled window (see GET/PUT
// /admin/site-config/back-to-school) — so admin can turn the whole section
// off, or schedule it, independent of any individual listing's own
// placementExpiresAt.

const OFFER_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
  productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' as const }, take: 1 },
};

router.get('/back-to-school', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
    const cfg = resolveBackToSchool(config);

    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit as string || '8')));
    const page = Math.max(1, parseInt(req.query.page as string || '1'));

    if (!cfg.active) {
      res.json({ listings: [], total: 0, page, pages: 0, active: false, endAt: cfg.endAt });
      return;
    }

    const now = new Date();
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      placement: 'BACK_TO_SCHOOL',
      placementExpiresAt: { gt: now },
      country: 'UGANDA',
    };
    const q = (req.query.q as string | undefined)?.trim();
    if (q) where.title = { contains: q, mode: 'insensitive' };
    const categorySlug = (req.query.category as string | undefined)?.trim();
    if (categorySlug) where.category = { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] };

    const sort = req.query.sort as string | undefined;
    const orderBy: Prisma.ListingOrderByWithRelationInput[] =
      sort === 'price_asc' ? [{ price: 'asc' }]
      : sort === 'price_desc' ? [{ price: 'desc' }]
      : [PIN_FIRST, { updatedAt: 'desc' }];

    const [total, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({ where, include: OFFER_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
    ]);

    res.json({ listings, total, page, pages: Math.ceil(total / limit), active: true, endAt: cfg.endAt });
  } catch (err) {
    next(err);
  }
});

// ─── Special Offers ─────────────────────────────────────────────────────────
// Every ACTIVE listing whose seller-declared "was" price (originalPrice)
// gives a discount >= SiteConfig.specialOffers.minDiscountPercent. Admin
// controls the section-level switch, threshold and schedule window (see
// /admin/site-config/special-offers); sellers/admins control which listings
// qualify by setting originalPrice. Discount math runs in SQL so pagination,
// totals and "biggest discount first" ordering are exact.
router.get('/special-offers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
    const cfg = resolveSpecialOffers(config);

    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit as string || '8')));
    const page = Math.max(1, parseInt(req.query.page as string || '1'));

    if (!cfg.active) {
      res.json({ listings: [], total: 0, page, pages: 0, active: false, minDiscountPercent: cfg.minDiscountPercent, endAt: cfg.endAt });
      return;
    }

    const sort = req.query.sort as string | undefined;
    const orderSql =
      sort === 'price_asc' ? Prisma.sql`l."price" ASC`
      : sort === 'price_desc' ? Prisma.sql`l."price" DESC`
      : sort === 'newest' ? Prisma.sql`l."createdAt" DESC`
      : Prisma.sql`(l."originalPrice" - l."price") / l."originalPrice" DESC, l."updatedAt" DESC`;

    const q = (req.query.q as string | undefined)?.trim();
    const categorySlug = (req.query.category as string | undefined)?.trim();

    const filters: Prisma.Sql[] = [
      Prisma.sql`l."status" = 'ACTIVE'::"ListingStatus"`,
      Prisma.sql`l."country" = 'UGANDA'::"Country"`,
      Prisma.sql`l."originalPrice" IS NOT NULL AND l."originalPrice" > l."price"`,
      Prisma.sql`((l."originalPrice" - l."price") / l."originalPrice") * 100 >= ${cfg.minDiscountPercent}`,
      Prisma.sql`(l."expiresAt" IS NULL OR l."expiresAt" > NOW())`,
    ];
    if (q) filters.push(Prisma.sql`l."title" ILIKE ${'%' + q + '%'}`);
    if (categorySlug) {
      filters.push(Prisma.sql`l."categoryId" IN (
        SELECT c."id" FROM "Category" c
        LEFT JOIN "Category" p ON p."id" = c."parentId"
        WHERE c."slug" = ${categorySlug} OR p."slug" = ${categorySlug})`);
    }
    const whereSql = Prisma.join(filters, ' AND ');

    const [countRows, idRows] = await Promise.all([
      prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "Listing" l WHERE ${whereSql}`),
      prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT l."id" FROM "Listing" l WHERE ${whereSql}
        ORDER BY ${orderSql} LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    ]);
    const total = Number(countRows[0]?.n ?? 0);
    const ids = idRows.map((r) => r.id);

    const rows = ids.length
      ? await prisma.listing.findMany({ where: { id: { in: ids } }, include: OFFER_INCLUDE })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const listings = ids
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => ({ ...l, discountPercent: discountPercent(l.price, l.originalPrice) }));

    res.json({ listings, total, page, pages: Math.ceil(total / limit), active: true, minDiscountPercent: cfg.minDiscountPercent, endAt: cfg.endAt });
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
        ...(country && ['UGANDA'].includes(country)
          ? { country: country as 'UGANDA' }
          : {}),
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
        productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
      },
      orderBy: [PIN_FIRST, { updatedAt: 'desc' }],
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
      condition, sort = 'createdAt', page = '1', limit: limitParam, q, brand, mine, userId, placement,
      verifiedOnly, withPhotos,
    } = req.query as Record<string, string>;

    if (mine === 'true' && !req.user) {
      return next(createError('Authentication required', 401));
    }

    const viewingOwnListings = mine === 'true' && !!req.user;

    const pageNum = Math.max(1, parseInt(page));
    const defaultPageSize = (await getGeneralSettings()).itemsPerPage;
    const limitNum = Math.min(100, Math.max(1, parseInt(limitParam || String(defaultPageSize), 10) || defaultPageSize));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const VALID_COUNTRIES = ['UGANDA'] as const;
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
    const parsedSearch = q ? parseSearchQuery(q) : null;
    const searchCondition: Prisma.ListingWhereInput | null =
      parsedSearch && hasSearchTerms(parsedSearch) ? buildSearchWhere(parsedSearch) : null;
    if (searchCondition) andConditions.push(searchCondition);
    if (category) {
      andConditions.push(buildCategoryFilter(category));
    }
    // Brand filter: matches the admin-defined "brand" custom field saved on
    // Listing.customFieldValues (see Category.fieldSchema), not free text —
    // an exact match against the JSON value so "Apple" doesn't also pull in
    // listings that merely mention Apple accessories in the description.
    if (brand) {
      andConditions.push({
        customFieldValues: { path: ['brand'], equals: brand } as Prisma.JsonNullableFilter<'Listing'>,
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
          ? { placement: placement as 'FLASH_SALE' | 'FEATURED_DEAL' | 'LATEST_COLLECTIONS' | 'BACK_TO_SCHOOL' | 'NONE' }
          : { NOT: { placement: 'FLASH_SALE' } }),
      ...(country && isValidCountry(country) && { country }),
      ...(location && { location: { contains: location, mode: 'insensitive' } }),
      ...(condition && { condition: condition as 'NEW' | 'USED' }),
      ...(verifiedOnly === 'true' && { user: { isKycVerified: true } }),
      // Listings that have at least one photo.
      ...(withPhotos === 'true' && { images: { isEmpty: false } }),
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
      condition || verifiedOnly === 'true' || withPhotos === 'true',
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
      let ranked = await getRelevanceRankedListings({ where, q, pageNum, limitNum });
      let correctedQuery: string | null = null;
      // Nothing matched: if a word looks misspelt (checked against real
      // listing vocabulary), transparently search the corrected spelling and
      // tell the client so it can show "Showing results for …".
      if (ranked.pagination.total === 0 && parsedSearch) {
        const fixed = await correctQuery(parsedSearch);
        if (fixed) {
          const fixedWhere: Prisma.ListingWhereInput = {
            ...where,
            AND: [...existingAnd, ...andConditions.filter((c) => c !== searchCondition), buildSearchWhere(parseSearchQuery(fixed))],
          };
          const retry = await getRelevanceRankedListings({ where: fixedWhere, q: fixed, pageNum, limitNum });
          if (retry.pagination.total > 0) { ranked = retry; correctedQuery = fixed; }
        }
      }
      logSearch(ranked.pagination.total);
      res.json({ ...ranked, correctedQuery, originalQuery: correctedQuery ? q.trim() : null });
      return;
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput | Prisma.ListingOrderByWithRelationInput[] =
      sort === 'price_asc' ? { price: 'asc' }
      : sort === 'price_desc' ? { price: 'desc' }
      : sort === 'views' ? { views: 'desc' }
      // Default ("createdAt") and any unrecognized sort value — the site's
      // strict render priority. Flash Deals (admin-only) already sit above
      // this feed as their own section; within the feed itself, PLATINUM
      // comes first, then GOLD, then FREE (Postgres orders enums by
      // declaration order — FREE, GOLD, PLATINUM — so `desc` is exactly
      // that ranking). Only after tier do KYC-verified sellers surface
      // first (their reward for completing identity verification), then
      // most recent. An ordinary user's un-upgraded listing is FREE, the
      // bottom rung, so it lands last without needing a fifth tier.
      : [PIN_FIRST, { tier: 'desc' }, { user: { isKycVerified: 'desc' } }, { createdAt: 'desc' }];

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
              // (WhatsApp) buttons shown on listing cards.
              phone: true, socialLinks: true,
              store: { select: { name: true, logo: true, slug: true } },
            },
          },
          productImages: {
            where: { cdnUrl: { not: null }, status: { not: 'REJECTED' as const } },
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
    // Contact gate: seller phone / WhatsApp are for signed-in users only. This list
    // endpoint used to return them to everyone, bypassing GET /listings/:id's gate.
    const visibleListings = req.user
      ? listings
      : listings.map((l) => ({ ...l, user: maskUserContact(l.user) }));
    res.json({
      listings: visibleListings,
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
    const { title, description, price, originalPrice, priceUnit, currency, condition, images, imageIds, location, country, categoryId, quantity, expiresAt, motorDetails, propertyDetails, jobDetails, productOptions, customFieldValues, latitude, longitude, requestedTier, tier: adminTier } = req.body;

    if (!title || !description || price == null || !location || !country || !categoryId) {
      return next(createError('Missing required fields', 400));
    }

    // Visibility tier inputs (see the ListingTier enum in schema.prisma).
    // `requestedTier` is what an ORDINARY user picked on the pricing
    // selector before "Post Listing"; `tier` (adminTier here) is only ever
    // honored from an admin. Both are validated up front so a bad value is
    // a clean 400 rather than a Prisma enum error later.
    const TIER_VALUES = ['FREE', 'GOLD', 'PLATINUM'];
    if (requestedTier != null && !TIER_VALUES.includes(requestedTier)) {
      return next(createError('requestedTier must be one of FREE, GOLD, PLATINUM', 400));
    }
    if (adminTier != null && !TIER_VALUES.includes(adminTier)) {
      return next(createError('tier must be one of FREE, GOLD, PLATINUM', 400));
    }

    // Optional — defaults to ITEM (price for the whole listing). Agriculture
    // produce may instead quote by weight; see the Agriculture create-produce
    // form's "Price unit" selector.
    if (priceUnit != null && !['ITEM', 'KG', 'TONNE'].includes(priceUnit)) {
      return next(createError('priceUnit must be one of ITEM, KG, TONNE', 400));
    }

    // ── Uganda-only listing creation ──
    // New listings may only be created for Uganda, regardless of what the
    // frontend sends (frontend-only restrictions can be bypassed via direct
    // API requests). Existing listings for other countries are untouched —
    // this only gates the creation of *new* listings.
    if (String(country).toUpperCase() !== 'UGANDA') {
      return next(createError('Country mismatch: Listings created through this endpoint must have Uganda as the country.', 400));
    }

    // Input validation (types / lengths / finite numbers) — clean 400s instead of 500s or DB bloat.
    for (const c of [
      checkText('Title', title, LISTING_LIMITS.title, true),
      checkText('Description', description, LISTING_LIMITS.description, true),
      checkText('Location', location, LISTING_LIMITS.location, true),
      checkJsonBlob('motorDetails', motorDetails), checkJsonBlob('propertyDetails', propertyDetails),
      checkJsonBlob('jobDetails', jobDetails), checkJsonBlob('productOptions', productOptions),
      checkJsonBlob('customFieldValues', customFieldValues),
    ]) {
      if (c.ok === false) return next(createError(c.message, 400));
    }
    if (typeof categoryId !== 'string') return next(createError('Category not found', 400));
    if (condition != null && !['NEW', 'USED'].includes(condition)) {
      return next(createError('condition must be NEW or USED', 400));
    }
    const priceResult = parsePrice(price);
    if (priceResult.ok === false) return next(createError(priceResult.message, 400));
    const parsedPrice = priceResult.value;
    let createExpiresAt: Date | undefined;
    if (expiresAt) {
      const d = parseFutureDate(expiresAt);
      if (d.ok === false) return next(createError('expiresAt is not a valid date', 400));
      createExpiresAt = d.value;
    }
    let createLat: number | undefined;
    let createLng: number | undefined;
    if (latitude != null) {
      const r = parseCoordinate(latitude, 'lat');
      if (r.ok === false) return next(createError(r.message, 400));
      createLat = r.value;
    }
    if (longitude != null) {
      const r = parseCoordinate(longitude, 'lng');
      if (r.ok === false) return next(createError(r.message, 400));
      createLng = r.value;
    }
    const originalPriceResult = parseOriginalPrice(originalPrice, parsedPrice);
    if ('error' in originalPriceResult) {
      return next(createError(originalPriceResult.error, 400));
    }

    const quantityResult = parseQuantity(quantity);
    if ('error' in quantityResult) {
      return next(createError(quantityResult.error, 400));
    }
    const parsedQuantity = quantityResult.value;

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

    // ── Posting is open to every account type. A regular (BUYER) account posts
    //    as an ORDINARY USER: no store privileges, no fixed placement, and its
    //    visibility package (Free/Gold/Platinum) is chosen at the end of the
    //    posting flow (requestedTier below) rather than via a seller package.
    //    Web-store privileges come only from an ACTIVE store rental. ──

    // ── Who may post, and how many (replaces the old per-seller package gate) ──
    //  • Admin: unrestricted.
    //  • Active web store: covered entirely by the store subscription (no other
    //    package) — capped only by the rental's own maxListings.
    //  • Everyone else — BUYER, or an Agent/Company/Organization whose store
    //    subscription is missing or expired — is an ORDINARY USER: no seller
    //    package, no placement privileges, listings are queued for approval,
    //    and visibility is the Free/Gold/Platinum choice made at the end of the
    //    flow. A per-account cap on live listings (ORDINARY_USER_MAX_LISTINGS,
    //    default 10) keeps unpaid accounts from flooding the feed; renewing the
    //    store (or an admin raising the env value) lifts it.
    if (req.user!.role !== 'ADMIN') {
      const userId = req.user!.userId;
      // One resolver decides the cap from the live dates: active store -> current subscription ->
      // ordinary baseline (utils/subscriptionService.ts). A lapsed store or subscription stops
      // counting the instant its end date passes, without waiting for any background job.
      const entitlement = await loadListingEntitlement(userId);
      if (entitlement.maxListings !== null) {
        const liveCount = await prisma.listing.count({
          where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
        });
        if (liveCount >= entitlement.maxListings) {
          const message =
            entitlement.source === 'STORE'
              ? `Your store allows a maximum of ${entitlement.maxListings} active listings. Please contact admin to increase your limit.`
              : entitlement.source === 'SUBSCRIPTION'
                ? `Your "${entitlement.label}" subscription allows up to ${entitlement.maxListings} live listings. Remove or mark an existing listing as sold, or upgrade your subscription to post more.`
                : `Accounts without an active web store can have up to ${entitlement.maxListings} live listings. Remove or mark an existing listing as sold, or register / renew a web store to post more.`;
          return next(createError(message, 403));
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Admin → Settings → Max Images Per Listing
    {
      const maxImages = (await getGeneralSettings()).maxImagesPerListing;
      const submitted = (Array.isArray(images) ? images.length : 0) + (Array.isArray(imageIds) ? imageIds.length : 0);
      if (submitted > maxImages) {
        return next(createError(`A listing can have at most ${maxImages} images (you sent ${submitted}).`, 400));
      }
    }

    // Build the initial images array: prefer CDN URLs from ProductImage records.
    const imageUrlCheck = sanitizeImageUrls(images, 50);
    if (imageUrlCheck.ok === false) return next(createError(imageUrlCheck.message, 400));
    let initialImages: string[] = imageUrlCheck.value;

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

    // AI ad moderation — skipped entirely for admin-authored listings (see
    // note on isAdmin above: admin content already bypasses human review
    // too, so there's no review step for a moderation flag to feed into).
    // A null result (LLM not configured, timed out, or errored) means the
    // listing proceeds exactly as it would have before this feature
    // existed — PENDING, awaiting the normal human admin review.
    const moderation = isAdmin ? null : await moderateListing(title, description, parsedPrice);
    const autoRejected = Boolean(
      moderation && !moderation.approved && moderation.confidence_score >= MODERATION_AUTO_REJECT_THRESHOLD
    );

    // ── Visibility tier resolution ──
    // Three distinct actors, three distinct rules (see ListingTier in
    // schema.prisma):
    //  • Admin: may set any tier directly; never subject to expiry.
    //  • Registered Store (active rental): tier is inherited from the store's
    //    own subscription tier — NOT chosen per listing, and any
    //    requestedTier sent by a store owner is ignored, since the package
    //    is managed once in the Store Dashboard, not per listing.
    //  • Ordinary user: always starts at FREE. A GOLD/PLATINUM selection is
    //    recorded as `requestedTier` only; an admin confirms payment and
    //    promotes it at approval time (PUT /admin/listings/:id/approve).
    const storeRentalForTier = isAdmin
      ? null
      : await prisma.storeRental.findFirst({
          where: { userId: req.user!.userId, status: 'ACTIVE', endDate: { gt: new Date() } },
          select: { tier: true },
        });
    const resolvedTier: 'FREE' | 'GOLD' | 'PLATINUM' = isAdmin
      ? (adminTier || 'FREE')
      : (storeRentalForTier?.tier ?? 'FREE');
    const resolvedRequestedTier =
      !isAdmin && !storeRentalForTier && (requestedTier === 'GOLD' || requestedTier === 'PLATINUM')
        ? (requestedTier as 'GOLD' | 'PLATINUM')
        : null;

    const listing = await prisma.listing.create({
      data: {
        title, description,
        price: parsedPrice,
        originalPrice: originalPriceResult.value,
        ...(priceUnit != null && { priceUnit }),
        currency: 'UGX', // UGX is the only supported currency
        condition: condition || 'USED',
        status: autoRejected ? 'REJECTED' : (isAdmin ? 'ACTIVE' : 'PENDING'),
        tier: resolvedTier,
        ...(resolvedRequestedTier && { requestedTier: resolvedRequestedTier }),
        images: initialImages,
        quantity: parsedQuantity,
        location, country,
        userId: req.user!.userId,
        categoryId,
        ...(createExpiresAt && { expiresAt: createExpiresAt }),
        ...(motorDetails && { motorDetails }),
        ...(propertyDetails && { propertyDetails }),
        ...(jobDetails && { jobDetails }),
        ...(productOptions && { productOptions }),
        ...(customFieldValues && { customFieldValues }),
        ...(createLat !== undefined && { latitude: createLat }),
        ...(createLng !== undefined && { longitude: createLng }),
        ...(moderation && {
          moderationFlaggedCategory: moderation.flagged_category,
          moderationConfidence: moderation.confidence_score,
          moderationReason: moderation.developer_reason,
          moderationCheckedAt: new Date(),
        }),
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

    if (autoRejected) {
      // Same notification type and general shape as an admin's manual
      // reject (see PUT /admin/listings/:id/reject) — but with a generic
      // seller-facing message rather than the LLM's own developer_reason,
      // which is written for a human reviewer/developer to read (see the
      // moderation prompt's schema), not as safe or clear copy for the
      // seller whose listing it's about.
      await prisma.notification.create({
        data: {
          userId: listing.userId,
          type: 'LISTING_REJECTED',
          title: 'Listing Rejected',
          message: `Your listing "${listing.title}" was automatically rejected because it appears to violate our marketplace guidelines. If you believe this is a mistake, please contact support.`,
          data: { listingId: listing.id },
        },
      }).catch((err) => logger.error('Failed to create LISTING_REJECTED notification', err));
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
  // Optional — defaults to ITEM. See the single-post priceUnit note above.
  priceUnit?: 'ITEM' | 'KG' | 'TONNE';
  currency?: string;
  condition?: 'NEW' | 'USED';
  quantity?: number | string | null;
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
      if (!item.title || !item.description || item.price == null || !item.location || !item.country || !item.categoryId) {
        return next(createError(`${label}: missing required fields`, 400));
      }
      if (String(item.country).toUpperCase() !== 'UGANDA') {
        return next(createError(`${label}: country must be Uganda`, 400));
      }
      const parsedPrice = parseFloat(String(item.price));
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return next(createError(`${label}: price must be a valid non-negative number`, 400));
      }
      const bulkOriginal = parseOriginalPrice((item as { originalPrice?: unknown }).originalPrice, parsedPrice);
      if ('error' in bulkOriginal) {
        return next(createError(`${label}: ${bulkOriginal.error}`, 400));
      }
      const bulkQty = parseQuantity(item.quantity);
      if ('error' in bulkQty) {
        return next(createError(`${label}: ${bulkQty.error}`, 400));
      }
      if (item.priceUnit != null && !['ITEM', 'KG', 'TONNE'].includes(item.priceUnit)) {
        return next(createError(`${label}: priceUnit must be one of ITEM, KG, TONNE`, 400));
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
        const parsedQuantity = parseQuantity(item.quantity);
        const bulkQuantityValue = 'value' in parsedQuantity ? parsedQuantity.value : null;
        const bulkOriginalResult = parseOriginalPrice((item as { originalPrice?: unknown }).originalPrice, parsedPrice);
        const bulkOriginalValue = 'value' in bulkOriginalResult ? bulkOriginalResult.value : null;
        return prisma.listing.create({
          data: {
            title: item.title,
            description: item.description,
            price: parsedPrice,
            originalPrice: bulkOriginalValue,
            ...(item.priceUnit != null && { priceUnit: item.priceUnit }),
            currency: (item.currency || 'UGX') as 'UGX',
            condition: item.condition || 'NEW',
            status: isAdmin ? 'ACTIVE' : 'PENDING',
            images: (item.images || []).filter(Boolean),
            quantity: bulkQuantityValue,
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
          where: { cdnUrl: { not: null }, status: { not: 'REJECTED' as const } },
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

    // Contact-info gate: phone and WhatsApp (socialLinks) are the seller's
    // direct contact channels, surfaced by the Call/Chat Seller buttons.
    // These must only reach a logged-in browser — stripping them here (not
    // just hiding the buttons on the frontend) is the actual access
    // control; an anonymous request never receives the values at all, so
    // there's nothing to recover from page source or dev tools. The
    // frontend shows a "Log in to view contact" prompt in their place.
    const responseListing = req.user
      ? listing
      : { ...listing, user: { ...listing.user, phone: null, socialLinks: null } };

    res.json(responseListing);
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
      title, description, price, originalPrice, priceUnit, condition, images, imageIds, location,
      status, expiresAt, motorDetails, currency, country, categoryId, quantity,
      propertyDetails, jobDetails, productOptions, customFieldValues, latitude, longitude,
    } = req.body;

    if (priceUnit !== undefined && priceUnit !== null && !['ITEM', 'KG', 'TONNE'].includes(priceUnit)) {
      return next(createError('priceUnit must be one of ITEM, KG, TONNE', 400));
    }

    const isAdminCaller = req.user!.role === 'ADMIN';

    // ── Input validation ──
    for (const c of [
      checkText('Title', title, LISTING_LIMITS.title), checkText('Description', description, LISTING_LIMITS.description),
      checkText('Location', location, LISTING_LIMITS.location),
      checkJsonBlob('motorDetails', motorDetails), checkJsonBlob('propertyDetails', propertyDetails),
      checkJsonBlob('jobDetails', jobDetails), checkJsonBlob('productOptions', productOptions),
      checkJsonBlob('customFieldValues', customFieldValues),
    ]) {
      if (c.ok === false) return next(createError(c.message, 400));
    }
    if ((title !== undefined && !String(title).trim()) || (description !== undefined && !String(description).trim())) {
      return next(createError('Title and description cannot be empty', 400));
    }
    if (condition !== undefined && !['NEW', 'USED'].includes(condition)) {
      return next(createError('condition must be NEW or USED', 400));
    }
    let parsedNewPrice: number | undefined;
    if (price != null) {
      const pr = parsePrice(price);
      if (pr.ok === false) return next(createError(pr.message, 400));
      parsedNewPrice = pr.value;
    }
    let newLat: number | null | undefined;
    let newLng: number | null | undefined;
    if (latitude !== undefined) {
      if (latitude === null) newLat = null;
      else { const r = parseCoordinate(latitude, 'lat'); if (r.ok === false) return next(createError(r.message, 400)); newLat = r.value; }
    }
    if (longitude !== undefined) {
      if (longitude === null) newLng = null;
      else { const r = parseCoordinate(longitude, 'lng'); if (r.ok === false) return next(createError(r.message, 400)); newLng = r.value; }
    }
    if (categoryId !== undefined && categoryId !== listing.categoryId) {
      if (typeof categoryId !== 'string' || !(await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
        return next(createError('Category not found', 400));
      }
    }

    // ── Status: owners cannot publish, un-reject or un-remove their own listing ──
    // (see utils/listingStatus.ts). Admins may set any valid status.
    let statusUpdate: string | undefined;
    if (status !== undefined) {
      if (typeof status !== 'string' || !['ACTIVE', 'PENDING', 'SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED'].includes(status)) {
        return next(createError('Invalid status', 400));
      }
      if (!isAdminCaller && !ownerMayChangeStatus(listing.status, status)) {
        return next(createError('You cannot change the listing to that status. Listings awaiting review, rejected or removed by a moderator can only be re-activated by an admin.', 403));
      }
      statusUpdate = status;
    }

    // ── Re-check edited text on a LIVE listing (prevents approve-then-swap) ──
    // If the AI moderator confidently flags the new wording, the listing goes back
    // to the human review queue. No LLM configured -> no change in behaviour.
    let requeueForReview = false;
    const textChanged = (title !== undefined && title !== listing.title) || (description !== undefined && description !== listing.description);
    if (!isAdminCaller && textChanged && listing.status === 'ACTIVE') {
      const mod = await moderateListing(title ?? listing.title, description ?? listing.description, parsedNewPrice ?? listing.price);
      requeueForReview = Boolean(mod && !mod.approved && mod.confidence_score >= MODERATION_AUTO_REJECT_THRESHOLD);
    }

    // "Was" price (Special Offers): validated against the effective new price.
    // If the price changes and no originalPrice is sent, a stale originalPrice
    // that no longer exceeds the price is cleared instead of left inconsistent.
    const effectivePrice = parsedNewPrice ?? listing.price;
    let originalPriceUpdate: { originalPrice: number | null } | undefined;
    if (originalPrice !== undefined) {
      const r = parseOriginalPrice(originalPrice, effectivePrice);
      if ('error' in r) return next(createError(r.error, 400));
      originalPriceUpdate = { originalPrice: r.value };
    } else if (price != null && listing.originalPrice != null && listing.originalPrice <= effectivePrice) {
      originalPriceUpdate = { originalPrice: null };
    }

    // Quantity is optional; omitting the key leaves the existing value untouched.
    let parsedQuantity: number | null | undefined;
    if (quantity !== undefined) {
      const q = parseQuantity(quantity);
      if ('error' in q) return next(createError(q.error, 400));
      parsedQuantity = q.value;
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
    const putImageCheck = sanitizeImageUrls(images, 50);
    if (putImageCheck.ok === false) return next(createError(putImageCheck.message, 400));
    let finalImages: string[] = [...putImageCheck.value];
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
    {
      const maxImages = (await getGeneralSettings()).maxImagesPerListing;
      if (finalImages.length > maxImages) {
        return next(createError(`A listing can have at most ${maxImages} images (you sent ${finalImages.length}).`, 400));
      }
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: {
        ...(title       !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(parsedNewPrice !== undefined && { price: parsedNewPrice }),
        ...(originalPriceUpdate),
        ...(priceUnit   !== undefined && priceUnit !== null && { priceUnit }),
        ...(condition   !== undefined && { condition }),
        ...(parsedQuantity !== undefined && { quantity: parsedQuantity }),
        ...(location    !== undefined && { location }),
        ...((requeueForReview ? 'PENDING' : statusUpdate) !== undefined && { status: (requeueForReview ? 'PENDING' : statusUpdate) as never }),
        // Expiry is an admin/package control — an owner must not be able to extend or remove it.
        ...(isAdminCaller && expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(currency    !== undefined && { currency: 'UGX' as const }),
        ...(country     !== undefined && { country: 'UGANDA' as const }),
        ...(categoryId  !== undefined && { categoryId }),
        ...(newLat      !== undefined && { latitude: newLat }),
        ...(newLng      !== undefined && { longitude: newLng }),
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
    // Owners may mark sold / hide / un-hide their own live listings, but may not
    // publish one that is pending, rejected, expired or removed by a moderator.
    if (req.user!.role !== 'ADMIN' && !ownerMayChangeStatus(listing.status, status)) {
      return next(createError('This listing cannot be changed to that status. Listings awaiting review, rejected or removed by a moderator can only be re-activated by an admin.', 403));
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
    // Web stores may direct their listings to the open zones only. Flash Deals,
    // Back to School and Special Offers are admin-curated — a store can never
    // place itself there (admins still can, via this route or the admin panel).
    const STORE_ASSIGNABLE_PLACEMENTS = ['NONE', 'LATEST_COLLECTIONS', 'FEATURED_DEAL'];
    if (!placement || !allowedPlacements.includes(placement)) {
      return next(createError(`placement must be one of: ${allowedPlacements.join(', ')}`, 400));
    }

    if (req.user!.role !== 'ADMIN' && !STORE_ASSIGNABLE_PLACEMENTS.includes(placement)) {
      return next(createError('Flash Deals, Back to School and Special Offers are managed by the admin only.', 403));
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
        // never actually appear anywhere on the homepage. Defaulting to 30
        // days out here makes placements set through this endpoint actually
        // take effect, matching the working convention already used by the
        // admin "approve with placement" endpoint elsewhere in this codebase.
        placementExpiresAt: placement === 'NONE'
          ? null
          : (req.user!.role === 'ADMIN' && placementExpiresAt && !Number.isNaN(new Date(placementExpiresAt).getTime())
              ? new Date(placementExpiresAt)
              : new Date(Date.now() + DEFAULT_PLACEMENT_MS)),
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
