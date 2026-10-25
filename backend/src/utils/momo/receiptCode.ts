/** Pure helpers for receipt tracking codes and money text (no database access, so they are trivially testable). */
import crypto from 'crypto';

// 31 characters: digits and letters that cannot be mistaken for one another when read aloud or typed.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const RECEIPT_CODE_RE = /^(PTR|TST)-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

export function generateReceiptNumber(environment: string): string {
  const chars = Array.from({ length: 12 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
  const prefix = environment === 'production' ? 'PTR' : 'TST';
  return `${prefix}-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/** Accepts what a person might type (lower case, spaces, missing dashes) and returns the canonical code or null. */
export function normalizeReceiptCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (flat.length !== 15) return null;
  const code = `${flat.slice(0, 3)}-${flat.slice(3, 7)}-${flat.slice(7, 11)}-${flat.slice(11, 15)}`;
  return RECEIPT_CODE_RE.test(code) ? code : null;
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}
