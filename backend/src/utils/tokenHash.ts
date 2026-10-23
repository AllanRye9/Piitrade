import crypto from 'crypto';

/**
 * One-way hash for tokens stored at rest (refresh, password-reset, email-verification). The raw token
 * only ever lives in the cookie or the email link, so a database leak does not hand out working
 * sessions or reset links. SHA-256 is enough here: the inputs are long random values, not passwords.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Values to match in a `where` clause: the hash, plus the raw token so that tokens written before
 * hashing was introduced keep working until they expire or rotate.
 */
export function tokenMatchValues(token: string): string[] {
  return [hashToken(token), token];
}
