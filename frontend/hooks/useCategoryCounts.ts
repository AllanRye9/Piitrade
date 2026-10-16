'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Visitor-facing item counts for the home page category icons, from
 * GET /categories/rollup-counts.
 *
 * `counts[slug]` is the number of ACTIVE listings in that category INCLUDING
 * all of its subcategories (so "Motors" covers Used Cars, Motorcycles, ...).
 * A slug with no key has no listings: once loaded, treat missing as 0.
 * `total` is every active listing in the country.
 *
 * Not to be confused with useActiveSubcategoryCounts (direct counts only, used
 * to hide empty subcategories in navigation).
 *
 * On a failed fetch `counts`/`total` stay `null` so callers can show nothing
 * rather than a misleading "0 listings" for every category.
 */

export interface CategoryCountsData {
  counts: Record<string, number>;
  total: number;
}

const CACHE_TTL = 60 * 1000; // matches the sibling hook; the API also caches for 30s
const _cache = new Map<string, { data: CategoryCountsData; expiry: number }>();
// The icon grid, the tile row and the sidebar mount together; share one request.
const _inflight = new Map<string, Promise<CategoryCountsData>>();

function readCache(key: string): CategoryCountsData | null {
  const hit = _cache.get(key);
  return hit && hit.expiry > Date.now() ? hit.data : null;
}

function fetchRollup(country: string): Promise<CategoryCountsData> {
  const key = country || '__global__';
  const existing = _inflight.get(key);
  if (existing) return existing;

  const request = api
    .get('/categories/rollup-counts', { params: country ? { country } : undefined })
    .then(({ data }) => {
      const parsed: CategoryCountsData = {
        counts: (data?.counts && typeof data.counts === 'object' ? data.counts : {}) as Record<string, number>,
        total: typeof data?.total === 'number' ? data.total : 0,
      };
      _cache.set(key, { data: parsed, expiry: Date.now() + CACHE_TTL });
      return parsed;
    })
    .finally(() => {
      _inflight.delete(key);
    });

  _inflight.set(key, request);
  return request;
}

export function useCategoryCounts(country: string) {
  const key = country || '__global__';
  const [data, setData] = useState<CategoryCountsData | null>(() => readCache(key));
  const [loading, setLoading] = useState<boolean>(() => readCache(key) === null);

  useEffect(() => {
    const cached = readCache(key);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchRollup(country)
      .then((fetched) => { if (!cancelled) setData(fetched); })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useCategoryCounts] failed to load counts:', err?.response?.status, err?.message);
        setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [country, key]);

  return { counts: data?.counts ?? null, total: data?.total ?? null, loading };
}
