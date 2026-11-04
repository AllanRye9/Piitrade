import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/** What an admin can wipe. `ALL` clears every log table below in one go. */
export const WIPE_SCOPES = ['VISITOR_LOGS', 'SEARCH_LOGS', 'CLICK_LOGS', 'ALL'] as const;
export type WipeScope = (typeof WIPE_SCOPES)[number];

export const WIPE_SCOPE_LABELS: Record<WipeScope, string> = {
  VISITOR_LOGS: 'Visitor Logs',
  SEARCH_LOGS: 'Search Logs',
  CLICK_LOGS: 'Item Clicks',
  ALL: 'All logs (Visitor, Search and Item Clicks)',
};

export const WIPE_CODE_TTL_MS = 10 * 60 * 1000;
export const WIPE_RESEND_COOLDOWN_MS = 30 * 1000;
export const WIPE_MAX_ATTEMPTS = 5;

export function isWipeScope(value: unknown): value is WipeScope {
  return typeof value === 'string' && (WIPE_SCOPES as readonly string[]).includes(value);
}

/** Cryptographically random 6-digit code (leading zeros kept). */
export function generateWipeCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashWipeCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export function verifyWipeCode(code: string, hash: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return Promise.resolve(false);
  return bcrypt.compare(code, hash);
}

/** "ab***@gmail.com": enough for the admin to recognise the inbox, not enough to leak it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}${'*'.repeat(Math.max(3, local.length - shown.length))}@${domain}`;
}
