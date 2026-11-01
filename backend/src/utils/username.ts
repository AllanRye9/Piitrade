/**
 * username.ts — optional sign-in names. Stored lower-case so lookups and the unique index are case-insensitive.
 * 3–30 characters: letters, digits, "." "_" "-"; must start and end with a letter or digit; no doubled separators.
 * Anything containing "@" is treated as an email at sign-in, so "@" is never allowed in a username.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'staff', 'moderator', 'mod', 'system', 'piitrade',
  'official', 'security', 'billing', 'payments', 'api', 'null', 'undefined', 'me', 'you', 'user', 'users',
  'login', 'logout', 'register', 'signup', 'signin', 'dashboard', 'profile', 'settings',
]);

export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Returns an error message, or null when the (already normalised) username is acceptable. */
export function validateUsername(u: string): string | null {
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters`;
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(u)) return 'Username can use letters, numbers, ".", "_" and "-", and must start and end with a letter or number';
  if (/[._-]{2}/.test(u)) return 'Username cannot have two separators in a row';
  if (RESERVED.has(u)) return 'That username is reserved — please choose another';
  return null;
}

/** True when the sign-in identifier should be looked up as an email address. */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}
