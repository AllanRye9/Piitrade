/** Validation for per-user UI preferences stored on the User row. */

export const LISTING_COLUMNS_MIN = 1;
export const LISTING_COLUMNS_MAX = 6;

export type ColumnsResult = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * `null` (or an empty string) clears the preference so the site default applies. Otherwise it must be
 * a whole number from 1 to 6 — a JSON number or a numeric string, nothing fractional or exotic.
 */
export function parseListingColumns(raw: unknown): ColumnsResult {
  if (raw === null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < LISTING_COLUMNS_MIN || n > LISTING_COLUMNS_MAX) {
    return { ok: false, message: `listingColumns must be a whole number from ${LISTING_COLUMNS_MIN} to ${LISTING_COLUMNS_MAX}, or null for the default` };
  }
  return { ok: true, value: n };
}
