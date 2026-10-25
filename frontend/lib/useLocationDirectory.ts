'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type UgandaRegion = 'Central' | 'Eastern' | 'Northern' | 'Western';

export interface DistrictCount { name: string; count: number }
export interface RegionCount { region: UgandaRegion; label: string; total: number; districts: DistrictCount[] }
export interface LocationDirectory { total: number; regions: RegionCount[] }

/** The four regions, always shown in this order. */
export const REGION_ORDER: UgandaRegion[] = ['Central', 'Eastern', 'Northern', 'Western'];

const TTL_MS = 60_000;
let cache: { at: number; data: LocationDirectory } | null = null;
let inflight: Promise<LocationDirectory> | null = null;

function load(): Promise<LocationDirectory> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
  if (!inflight) {
    inflight = api.get<LocationDirectory>('/listings/locations')
      .then(({ data }) => {
        const clean: LocationDirectory = {
          total: Number(data?.total) || 0,
          regions: Array.isArray(data?.regions) ? data.regions : [],
        };
        cache = { at: Date.now(), data: clean };
        return clean;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Regions and districts that currently have live listings, with counts. One shared, briefly cached
 * request, so the search bar, the filter chip and the browse page never fetch it twice. `enabled`
 * lets a closed picker skip the request until it is first opened.
 */
export function useLocationDirectory(enabled = true) {
  const [data, setData] = useState<LocationDirectory | null>(cache?.data ?? null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    load()
      .then((d) => { if (alive) { setData(d); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [enabled]);

  return { data, error, loading: enabled && !data && !error };
}
