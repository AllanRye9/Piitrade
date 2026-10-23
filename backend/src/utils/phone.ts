import { createError } from '../middleware/errorHandler';

/**
 * Account phone numbers are stored in one form so "0772123456", "256772123456" and "+256 772 123 456"
 * are the same number. Ugandan numbers become "+256XXXXXXXXX"; other international numbers keep their
 * digits with a leading "+". Anything that is not a plausible phone number is rejected (400).
 * Returns null for an empty value.
 */
export function normalizeUserPhone(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw createError('Phone number must be text', 400);
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return null;
  const digits = cleaned.replace(/^\+/, '');
  if (!/^\d{7,15}$/.test(digits)) throw createError('Please enter a valid phone number', 400);
  if (/^256\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^[1-9]\d{8}$/.test(digits) && !cleaned.startsWith('+')) return `+256${digits}`;
  return cleaned.startsWith('+') ? `+${digits}` : digits;
}

/** Every stored spelling that could mean the same number, so older un-normalised rows still match. */
export function phoneLookupCandidates(normalized: string): string[] {
  const out = new Set<string>([normalized]);
  const m = /^\+256(\d{9})$/.exec(normalized);
  if (m) {
    out.add(`256${m[1]}`);
    out.add(`0${m[1]}`);
    out.add(m[1]);
  }
  return Array.from(out);
}
