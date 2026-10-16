/**
 * contactPrivacy.ts — the "log in to see contact details" rule, in one place.
 *
 * GET /listings/:id already blanked a seller's phone and WhatsApp for anonymous
 * visitors, but GET /listings (the list/search endpoint) and the public store
 * pages returned them to everyone, so the gate could be bypassed with a single
 * list request and every seller's number scraped. All public handlers now run
 * their output through these helpers.
 */

const CONTACT_KEYS = /^(whats?app|phone|tel|telephone|mobile|contact)/i;

/** socialLinks without any phone-like / WhatsApp entries (keeps facebook, instagram, ...). */
export function publicSocialLinks(links: unknown): unknown {
  if (!links || typeof links !== 'object' || Array.isArray(links)) return links ?? null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(links as Record<string, unknown>)) {
    if (!CONTACT_KEYS.test(k)) out[k] = v;
  }
  return out;
}

/** Blank direct-contact fields on a user object (for anonymous viewers). */
export function maskUserContact<T extends { phone?: unknown; socialLinks?: unknown } | null | undefined>(user: T): T {
  if (!user) return user;
  return { ...user, phone: null, socialLinks: null };
}

/** Keep social links but drop WhatsApp/phone entries (for pages that must stay public). */
export function maskUserContactKeepSocial<T extends { socialLinks?: unknown } | null | undefined>(user: T): T {
  if (!user) return user;
  return { ...user, socialLinks: publicSocialLinks(user.socialLinks) };
}
