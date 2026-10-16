/**
 * emailNormalize.ts
 *
 * Registration used express-validator's `normalizeEmail()` (which, by default,
 * strips dots and "+tags" from Gmail addresses, "-tags" from Yahoo, etc.),
 * while login / forgot-password / resend-verification only did
 * `trim().toLowerCase()`. A user who registered as `john.doe@gmail.com` was
 * therefore stored as `johndoe@gmail.com` and could never log in with the
 * address they typed.
 *
 * New rule: an address is stored exactly as typed, trimmed and lower-cased.
 * {@link legacyEmailVariants} returns the old aggressively-normalized forms so
 * existing accounts created under the old behaviour are still found.
 */

export function normalizeEmailInput(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Additional stored forms an existing account might have under the legacy normalizer. */
export function legacyEmailVariants(email: string): string[] {
  const at = email.lastIndexOf('@');
  if (at <= 0) return [];
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';

  if (domain === 'gmail.com') {
    local = local.split('+')[0].replace(/\./g, '');
  } else if (['outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'mac.com'].includes(domain)) {
    local = local.split('+')[0];
  } else if (['yahoo.com', 'ymail.com', 'rocketmail.com'].includes(domain)) {
    local = local.split('-')[0];
  }

  const variant = `${local}@${domain}`;
  return variant === email || !local ? [] : [variant];
}

/** Every address under which an account for `email` may be stored (exact form first). */
export function emailLookupCandidates(email: string): string[] {
  return [email, ...legacyEmailVariants(email)];
}
