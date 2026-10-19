'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

/**
 * Fetches ACTIVE listing counts per category/subcategory slug, scoped to a
 * country, from GET /categories/active-counts. Used by the public category
 * pages (CategoryPageTemplate's "Browse by Type" grid and
 * CategorySubcategoryTemplate's "Other Categories" list) as well as the
 * global navigation (CategoryBar's mega menus, the home page's "All
 * Categories" sidebar) to hide categories/subcategories that don't have any
 * listings yet.
 *
 * IMPORTANT: this hook is for public discovery surfaces only. It must never
 * be used to filter the "create listing" category picker or any admin
 * category screen — sellers need to be able to see and post into an empty
 * subcategory, otherwise it could never receive its first listing.
 *
 * On a failed fetch, `counts` stays `null` (not `{}`) so callers can tell
 * "we don't know yet / the request failed" apart from "we know these are
 * genuinely empty" — the former should fall back to showing everything
 * rather than hiding the whole page's subcategories.
 */

// Module-level cache shared across components/pages, keyed by country.
// Counts are real-time on the API (any listing write invalidates its cache), so a short TTL
// plus a light poll keeps the navigation badges honest without hammering it.
const CACHE_TTL = 20 * 1000;
const POLL_MS = 30 * 1000;

export interface CategoryCounts {
  /** Per-slug counts, rolled up through descendants. A missing key means 0. */
  counts: Record<string, number>;
  /** Per exact category (no descendants). */
  direct: Record<string, number>;
  /** Listings created in the last 24 h per slug — drives "new" highlights. */
  new24h: Record<string, number>;
  total: number;
}

const _cache = new Map<string, { data: CategoryCounts; expiry: number }>();

// De-dupes concurrent fetches for the same country (nav, home sidebar and the page template
// can all mount this hook in the same tick).
const _inflight = new Map<string, Promise<CategoryCounts>>();

function fetchCounts(country: string): Promise<CategoryCounts> {
  const cacheKey = country || '__global__';
  const existing = _inflight.get(cacheKey);
  if (existing) return existing;

  const params = country ? { country } : undefined;
  const request = api
    .get('/categories/counts', { params })
    // Older API without /categories/counts: fall back to the legacy endpoint (counts only).
    .catch((err) => {
      if (err?.response?.status === 404) return api.get('/categories/active-counts', { params });
      throw err;
    })
    .then(({ data }) => {
      const counts = (data?.counts || {}) as Record<string, number>;
      const result: CategoryCounts = {
        counts,
        direct: (data?.direct || {}) as Record<string, number>,
        new24h: (data?.new24h || {}) as Record<string, number>,
        total: typeof data?.total === 'number' ? data.total : 0,
      };
      _cache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL });
      return result;
    })
    .finally(() => {
      _inflight.delete(cacheKey);
    });

  _inflight.set(cacheKey, request);
  return request;
}

export function useNavCategoryCounts(country: string) {
  // Start empty, exactly like the server render, and fill from the cache in the effect below.
  // Seeding state from the module cache makes the first client render differ from the server HTML
  // (React error #418) whenever a sibling populated the cache before this component hydrated.
  const [data, setData] = useState<CategoryCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = country || '__global__';

    const load = (showSpinner: boolean) => {
      const cached = _cache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        setData(cached.data);
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      fetchCounts(country)
        .then((fetched) => { if (!cancelled) setData(fetched); })
        .catch((err) => {
          if (cancelled) return;
          // Keep the last good data; with none, leave null so callers show everything
          // rather than hiding every subcategory because we "couldn't check".
          console.error('[useCategoryCounts] failed to load counts:', err?.response?.status, err?.message);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    };

    load(true);
    const tick = () => { if (document.visibilityState === 'visible') load(false); };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [country]);

  return { data, loading };
}

/** Back-compat wrapper: `counts` stays null until known (see the note above). */
export function useActiveSubcategoryCounts(country: string) {
  const { data, loading } = useNavCategoryCounts(country);
  return { counts: data?.counts ?? null, loading };
}
