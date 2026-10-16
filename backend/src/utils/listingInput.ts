/** Input validation shared by listing create/update — turns would-be 500s and abuse into clean 400s. */

export const LISTING_LIMITS = {
  title: 200,
  description: 20_000,
  location: 200,
  imageUrl: 600,
  jsonBytes: 20_000,
  maxPrice: 1_000_000_000_000, // 1 trillion UGX — far above any real listing
} as const;

export type Check = { ok: true } | { ok: false; message: string };

export function checkText(label: string, value: unknown, max: number, required = false): Check {
  if (value === undefined || value === null || value === '') {
    return required ? { ok: false, message: `${label} is required` } : { ok: true };
  }
  if (typeof value !== 'string') return { ok: false, message: `${label} must be text` };
  if (required && !value.trim()) return { ok: false, message: `${label} is required` };
  if (value.length > max) return { ok: false, message: `${label} must be at most ${max} characters` };
  return { ok: true };
}

/** A finite, non-negative price within sane bounds. Rejects NaN/Infinity ("1e999"). */
export function parsePrice(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'Price must be a valid non-negative number' };
  if (n > LISTING_LIMITS.maxPrice) return { ok: false, message: 'Price is too large' };
  return { ok: true, value: n };
}

export function parseCoordinate(value: unknown, kind: 'lat' | 'lng'): { ok: true; value: number } | { ok: false; message: string } {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  const max = kind === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > max) return { ok: false, message: `${kind === 'lat' ? 'Latitude' : 'Longitude'} is invalid` };
  return { ok: true, value: n };
}

export function parseFutureDate(value: unknown): { ok: true; value: Date } | { ok: false; message: string } {
  const d = new Date(value as string);
  if (value === undefined || value === null || Number.isNaN(d.getTime())) return { ok: false, message: 'Invalid date' };
  return { ok: true, value: d };
}

/** Free-form JSON blobs (motorDetails, customFieldValues, ...) must be plain objects and small. */
export function checkJsonBlob(label: string, value: unknown): Check {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'object') return { ok: false, message: `${label} is invalid` };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(value)); } catch { return { ok: false, message: `${label} is invalid` }; }
  return size > LISTING_LIMITS.jsonBytes ? { ok: false, message: `${label} is too large` } : { ok: true };
}

/** Image URLs a client may supply directly: bounded http(s) or site-relative strings only. */
export function sanitizeImageUrls(value: unknown, maxCount: number): { ok: true; value: string[] } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'images must be a list' };
  if (value.length > maxCount) return { ok: false, message: `A listing can have at most ${maxCount} images (you sent ${value.length}).` };
  const out: string[] = [];
  for (const u of value) {
    if (typeof u !== 'string' || u.length === 0 || u.length > LISTING_LIMITS.imageUrl) return { ok: false, message: 'Invalid image URL' };
    if (!/^(https?:\/\/|\/)/i.test(u) || /^\/\//.test(u)) return { ok: false, message: 'Invalid image URL' };
    out.push(u);
  }
  return { ok: true, value: out };
}
