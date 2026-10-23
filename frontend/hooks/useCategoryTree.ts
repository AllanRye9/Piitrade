'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Category } from '@/lib/types';

/**
 * The category tree (top-level categories with their direct children) from GET /categories, shared
 * by the header nav, the header search and any other buyer surface that must stay data-driven
 * instead of hard-coding category lists.
 *
 * - One request is shared between every component that mounts the hook (module cache + in-flight
 *   de-dupe); the API itself caches the response for ~2 minutes.
 * - Starts as `null` exactly like the server render (avoids hydration mismatches, same approach as
 *   useCategoryCounts) and fills in from an effect. `null` also means "request failed": callers
 *   must fall back to their static list.
 * - The tree contains EVERY category, including empty ones. Buyer surfaces must filter it with
 *   lib/categoryVisibility.ts; seller surfaces use it as is.
 */
const CACHE_TTL = 60 * 1000;
let _cache: { data: Category[]; expiry: number } | null = null;
let _inflight: Promise<Category[]> | null = null;

function fetchTree(): Promise<Category[]> {
  if (_inflight) return _inflight;
  _inflight = api
    .get('/categories')
    .then(({ data }) => {
      const tree = Array.isArray(data) ? (data as Category[]) : [];
      _cache = { data: tree, expiry: Date.now() + CACHE_TTL };
      return tree;
    })
    .finally(() => { _inflight = null; });
  return _inflight;
}

export function useCategoryTree() {
  const [tree, setTree] = useState<Category[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (_cache && _cache.expiry > Date.now()) {
      setTree(_cache.data);
      return;
    }
    fetchTree()
      .then((t) => { if (!cancelled) setTree(t); })
      .catch(() => { /* leave null: callers fall back to their static lists */ });
    return () => { cancelled = true; };
  }, []);

  return { tree };
}
