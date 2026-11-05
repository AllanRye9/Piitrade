/**
 * Instant-open cache for the listings grid (stale-while-revalidate).
 *
 * The last answer for a search is kept on the device, so a repeat visit paints real cards at once, even
 * before the network answers, which matters most on a slow connection. The page ALWAYS re-reads from the
 * server straight afterwards and swaps in the fresh data quietly (see ListingsPageClient), so deleted,
 * edited or unapproved items never linger beyond that one round trip. Entries older than TTL are ignored.
 */
const KEY = 'piitrade_grid_cache_v1';
const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 8;

export interface GridPayload {
  listings: unknown[];
  correctedQuery?: string | null;
  originalQuery?: string | null;
  pagination?: { total?: number; pages?: number };
}
interface Entry { k: string; t: number; d: GridPayload }

function readAll(): Entry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function readGridCache(key: string): GridPayload | null {
  const e = readAll().find((x) => x.k === key);
  return e && Date.now() - e.t < TTL_MS ? e.d : null;
}

export function writeGridCache(key: string, data: GridPayload): void {
  if (!Array.isArray(data.listings) || data.listings.length === 0) return; // never cache an empty answer
  try {
    const keep = readAll().filter((x) => x.k !== key && Date.now() - x.t < TTL_MS).slice(0, MAX_ENTRIES - 1);
    const slim: GridPayload = {
      listings: data.listings,
      correctedQuery: data.correctedQuery ?? null,
      originalQuery: data.originalQuery ?? null,
      pagination: { total: data.pagination?.total, pages: data.pagination?.pages },
    };
    window.localStorage.setItem(KEY, JSON.stringify([{ k: key, t: Date.now(), d: slim }, ...keep]));
  } catch { /* storage full or blocked: caching is optional */ }
}
