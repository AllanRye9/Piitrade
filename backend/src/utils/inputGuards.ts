import { createError } from '../middleware/errorHandler';

/**
 * Request-body strings that end up in Prisma `where`/`data` must be real strings. A JSON body like
 * {"registrationNumber": {"startsWith": "A"}} would otherwise be passed straight into a query as an
 * operator object (an oracle over other users' data). `rejectObjectQuery` only covers req.query.
 */
export function optionalString(value: unknown, field: string, maxLength = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw createError(`${field} must be a string`, 400);
  const v = value.trim();
  if (v.length > maxLength) throw createError(`${field} must be at most ${maxLength} characters`, 400);
  return v;
}

/** A website must be an absolute http(s) URL so it can never render as a javascript:/data: link. */
export function optionalWebsite(value: unknown, field = 'website'): string | undefined {
  const v = optionalString(value, field, 300);
  if (!v) return v;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`); } catch { throw createError(`${field} is not a valid URL`, 400); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw createError(`${field} must start with http:// or https://`, 400);
  return u.toString();
}
