/**
 * savedSearches.ts — buyer "saved search" / alert filters (instant delivery lives in listingAlerts.ts).
 *
 * A saved search stores the same query keys the /listings page uses. Only the keys below are kept
 * (anything else is dropped), values are trimmed/length-capped, and numbers are validated, so the
 * stored JSON can never smuggle arbitrary Prisma filters.
 */
import type { Prisma } from '@prisma/client';
import { parseSearchQuery, hasSearchTerms, buildSearchWhere } from './search';

export const MAX_SAVED_SEARCHES_PER_USER = 20;

export interface SavedSearchParams {
  q?: string;
  category?: string;
  location?: string;
  condition?: 'NEW' | 'USED';
  priceMin?: string;
  priceMax?: string;
  verifiedOnly?: 'true';
  withPhotos?: 'true';
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};
const money = (v: unknown): string | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? String(Math.round(n)) : undefined;
};

/** Whitelist + normalise whatever the client sent. */
export function sanitizeParams(input: unknown): SavedSearchParams {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: SavedSearchParams = {};
  const q = text(src.q, 100); if (q) out.q = q;
  const category = text(src.category, 80); if (category && /^[a-z0-9-]+$/i.test(category)) out.category = category;
  const location = text(src.location, 80); if (location) out.location = location;
  if (src.condition === 'NEW' || src.condition === 'USED') out.condition = src.condition;
  const min = money(src.priceMin); if (min) out.priceMin = min;
  const max = money(src.priceMax); if (max) out.priceMax = max;
  if (src.verifiedOnly === 'true' || src.verifiedOnly === true) out.verifiedOnly = 'true';
  if (src.withPhotos === 'true' || src.withPhotos === true) out.withPhotos = 'true';
  return out;
}

export function hasAnyFilter(p: SavedSearchParams): boolean {
  return Object.keys(p).length > 0;
}

/** Human label used as the default name and in alert text, e.g. "toyota · Kampala · ≤ 30,000,000". */
export function describeParams(p: SavedSearchParams): string {
  const parts: string[] = [];
  if (p.q) parts.push(p.q);
  if (p.category) parts.push(p.category.replace(/-/g, ' '));
  if (p.location) parts.push(p.location);
  if (p.condition) parts.push(p.condition === 'NEW' ? 'New' : 'Used');
  if (p.priceMin && p.priceMax) parts.push(`${Number(p.priceMin).toLocaleString('en-UG')}–${Number(p.priceMax).toLocaleString('en-UG')}`);
  else if (p.priceMin) parts.push(`≥ ${Number(p.priceMin).toLocaleString('en-UG')}`);
  else if (p.priceMax) parts.push(`≤ ${Number(p.priceMax).toLocaleString('en-UG')}`);
  if (p.verifiedOnly) parts.push('Verified sellers');
  if (p.withPhotos) parts.push('With photos');
  return (parts.join(' · ') || 'All listings').slice(0, 120);
}

/** Query string for the /listings page that reproduces this search. */
export function toQueryString(p: SavedSearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
  return qs.toString();
}

/** Live (ACTIVE, unexpired) listings matching the search, optionally only those created after `since`. */
export function buildSavedSearchWhere(p: SavedSearchParams, now: Date, since?: Date): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [
    { status: 'ACTIVE' },
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  ];
  if (p.q) {
    const parsed = parseSearchQuery(p.q);
    if (hasSearchTerms(parsed)) and.push(buildSearchWhere(parsed));
  }
  if (p.category) {
    and.push({
      OR: [
        { category: { slug: p.category } },
        { category: { parent: { slug: p.category } } },
      ],
    });
  }
  if (p.location) and.push({ location: { contains: p.location, mode: 'insensitive' } });
  if (p.condition) and.push({ condition: p.condition });
  if (p.verifiedOnly) and.push({ user: { isKycVerified: true } });
  if (p.withPhotos) and.push({ images: { isEmpty: false } });
  if (p.priceMin || p.priceMax) {
    // Price bounds are in UGX; a listing quoted in another currency is never compared numerically.
    and.push({ currency: 'UGX' });
    and.push({
      price: {
        ...(p.priceMin && { gte: parseFloat(p.priceMin) }),
        ...(p.priceMax && { lte: parseFloat(p.priceMax) }),
      },
    });
  }
  if (since) and.push({ createdAt: { gt: since } });
  return { AND: and };
}
