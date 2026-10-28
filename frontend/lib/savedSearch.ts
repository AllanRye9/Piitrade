/** Filter keys a saved search may hold — must match backend/src/utils/savedSearches.ts. */
export const SAVED_SEARCH_KEYS = ['q', 'category', 'location', 'condition', 'priceMin', 'priceMax', 'verifiedOnly', 'withPhotos'] as const;

export type SavedSearchParams = Partial<Record<(typeof SAVED_SEARCH_KEYS)[number], string>>;

export interface SavedSearchRow {
  id: string;
  name: string;
  params: SavedSearchParams;
  /** Alerts on (the master switch). */
  notify: boolean;
  notifyEmail: boolean;
  notifySound: boolean;
  createdAt: string;
  lastCheckedAt: string;
  lastAlertAt: string | null;
  newCount: number;
}

/** Pull the savable filters out of the current /listings URL. */
export function paramsFromSearch(get: (k: string) => string | null | undefined): SavedSearchParams {
  const out: SavedSearchParams = {};
  for (const k of SAVED_SEARCH_KEYS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  return out;
}

export function toListingsHref(p: SavedSearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/listings?${s}` : '/listings';
}
