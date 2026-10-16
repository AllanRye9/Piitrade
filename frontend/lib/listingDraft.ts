'use client';

import type { Country } from '@/lib/types';

/**
 * listingDraft.ts
 *
 * Autosaves the "Post a listing" form to localStorage as the seller fills
 * it out. This is the actual safety net for "don't lose a half-finished
 * listing" — it covers every way that could happen (a forced sign-out, an
 * accidental tab close, a browser crash, a flaky connection mid-submit),
 * not just the auth-related causes that the session-expiry work
 * (lib/sessionExpiry.ts, lib/sessionRefreshScheduler.ts) specifically
 * targets. Those two layers are complementary: the auth changes make a
 * session interruption far less likely to happen at all mid-form, and this
 * autosave means that even if one still slips through — or the tab just
 * gets closed by accident — the seller doesn't have to start over.
 *
 * Deliberately create-mode only. Editing an existing listing is never
 * autosaved into this bucket: nothing is written to that listing until Save
 * is explicitly clicked, so an interrupted edit session has nothing at risk
 * to begin with, and mixing edit-in-progress state into a generic "draft"
 * could cause confusing cross-listing overwrites.
 */

export interface ListingDraftData {
  savedAt: number;
  form: {
    title: string;
    description: string;
    price: string;
    condition: string;
    country: Country;
    location: string;
    categoryId: string;
    quantity: string;
  };
  motorDetails: Record<string, string>;
  propertyDetails: Record<string, string>;
  jobDetails: Record<string, string>;
  productOptions: { id: string; name: string; values: string }[];
  customFieldValues: Record<string, string>;
  // Already-uploaded-to-server image references — these are real CDN URLs
  // and pending-image IDs, not local blob: previews, so they're still valid
  // after a reload (unlike a blob: URL, which dies with the page that
  // created it).
  pendingImageIds: string[];
  imagePreviews: string[];
}

// Drafts older than this are treated as stale and silently discarded rather
// than offered for restore — categories, pricing, etc. may well have moved
// on by then, and an autosave isn't meant to be a long-term draft system.
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function draftKey(userId: string): string {
  // Namespaced per account so a shared/public device never offers to
  // restore one person's draft into another person's session.
  return `listingDraft:${userId}`;
}

export function saveListingDraft(userId: string, data: Omit<ListingDraftData, 'savedAt'>): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked by privacy settings — losing the autosave
    // silently is fine, it's a best-effort convenience layered on top of
    // the form's normal in-memory state, not a requirement for it to work.
  }
}

export function loadListingDraft(userId: string): ListingDraftData | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ListingDraftData;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(draftKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearListingDraft(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(draftKey(userId));
  } catch {
    // ignore
  }
}

/** True if a saved draft actually has meaningful content worth offering to restore, rather than just default/empty field values. */
export function isDraftMeaningful(data: Pick<ListingDraftData, 'form'>): boolean {
  return Boolean(data.form.title.trim() || data.form.description.trim() || data.form.price.trim());
}
