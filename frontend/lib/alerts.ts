/**
 * alerts.ts — types, presets and helpers for listing alerts (saved searches with notifications).
 * Server rules live in backend/src/utils/listingAlerts.ts.
 */
import type { SavedSearchParams } from '@/lib/savedSearch';

/** Window events: a listing alert just ARRIVED (detail = AlertEvent) / the notification list CHANGED (no detail). */
export const ALERT_ARRIVED_EVENT = 'piitrade:alert';
export const NOTIFICATIONS_CHANGED_EVENT = 'piitrade:notifications-changed';

/** A same-site path: one leading "/" ("//host" and "/\\host" are protocol-relative, i.e. external). */
export function isInternalPath(href: unknown): href is string {
  return typeof href === 'string' && /^\/(?![/\\])/.test(href);
}

/** Links in alert data come from the server; still, only ever follow same-site paths. */
export function safeAlertHref(href: unknown): string {
  return isInternalPath(href) ? href : '/profile/alerts';
}

/** What the server pushes over the stream / returns from GET /alerts/recent and /alerts/feed. */
export interface AlertEvent {
  /** Notification id (also the de-duplication key). */
  id: string;
  listingId: string;
  alertName: string;
  title: string;
  message: string;
  href: string;
  image: string | null;
  sound: boolean;
  createdAt: string;
}

export interface AlertFeedItem extends AlertEvent { isRead: boolean }

/** Quick-start alerts for Uganda's most common searches. Slugs must exist in the category tree. */
export interface AlertPreset { label: string; categorySlug: string; priceMax?: number; priceMin?: number; q?: string }
export const ALERT_PRESETS: AlertPreset[] = [
  { label: 'Land under UGX 5,000,000', categorySlug: 'land-plots', priceMax: 5_000_000 },
  { label: 'Smartphones under UGX 250,000', categorySlug: 'smartphones', priceMax: 250_000 },
  { label: 'Used cars under UGX 30,000,000', categorySlug: 'used-cars', priceMax: 30_000_000 },
  { label: 'Rooms for rent under UGX 300,000', categorySlug: 'rooms-rent', priceMax: 300_000 },
  { label: 'Laptops under UGX 1,500,000', categorySlug: 'laptops', priceMax: 1_500_000 },
];

/** "5000000" / "5,000,000" / "5 000 000" -> "5000000"; anything else -> "". */
export function cleanPrice(input: string): string {
  const digits = input.replace(/[\s,_]/g, '');
  return /^\d{1,12}$/.test(digits) && Number(digits) > 0 ? String(Number(digits)) : '';
}

export function formatUgxInput(digits: string): string {
  const d = cleanPrice(digits);
  return d ? Number(d).toLocaleString('en-US') : digits.replace(/[^\d,]/g, '');
}

export interface AlertForm {
  categorySlug: string;
  q: string;
  priceMin: string;
  priceMax: string;
  location: string;
  condition: '' | 'NEW' | 'USED';
  withPhotos: boolean;
  verifiedOnly: boolean;
}

export const EMPTY_FORM: AlertForm = { categorySlug: '', q: '', priceMin: '', priceMax: '', location: '', condition: '', withPhotos: false, verifiedOnly: false };

export function formToParams(f: AlertForm): SavedSearchParams {
  const p: SavedSearchParams = {};
  if (f.categorySlug) p.category = f.categorySlug;
  if (f.q.trim()) p.q = f.q.trim();
  const min = cleanPrice(f.priceMin);
  const max = cleanPrice(f.priceMax);
  if (min) p.priceMin = min;
  if (max) p.priceMax = max;
  if (f.location.trim()) p.location = f.location.trim();
  if (f.condition) p.condition = f.condition;
  if (f.withPhotos) p.withPhotos = 'true';
  if (f.verifiedOnly) p.verifiedOnly = 'true';
  return p;
}

export function paramsToForm(p: SavedSearchParams): AlertForm {
  return {
    categorySlug: p.category ?? '',
    q: p.q ?? '',
    priceMin: p.priceMin ? formatUgxInput(p.priceMin) : '',
    priceMax: p.priceMax ? formatUgxInput(p.priceMax) : '',
    location: p.location ?? '',
    condition: p.condition === 'NEW' || p.condition === 'USED' ? p.condition : '',
    withPhotos: p.withPhotos === 'true',
    verifiedOnly: p.verifiedOnly === 'true',
  };
}

export function presetToForm(preset: AlertPreset): AlertForm {
  return {
    ...EMPTY_FORM,
    categorySlug: preset.categorySlug,
    q: preset.q ?? '',
    priceMax: preset.priceMax ? formatUgxInput(String(preset.priceMax)) : '',
    priceMin: preset.priceMin ? formatUgxInput(String(preset.priceMin)) : '',
  };
}

export function hasCriteria(f: AlertForm): boolean {
  return Object.keys(formToParams(f)).length > 0;
}

/** "Smartphones · max UGX 250,000 · Kampala" */
export function describeAlert(p: SavedSearchParams, categoryName?: string): string {
  const bits: string[] = [];
  if (p.category) bits.push(categoryName || p.category);
  if (p.q) bits.push(`“${p.q}”`);
  if (p.priceMin && p.priceMax) bits.push(`UGX ${Number(p.priceMin).toLocaleString('en-US')}–${Number(p.priceMax).toLocaleString('en-US')}`);
  else if (p.priceMax) bits.push(`max UGX ${Number(p.priceMax).toLocaleString('en-US')}`);
  else if (p.priceMin) bits.push(`min UGX ${Number(p.priceMin).toLocaleString('en-US')}`);
  if (p.location) bits.push(p.location);
  if (p.condition) bits.push(p.condition === 'NEW' ? 'New' : 'Used');
  if (p.withPhotos === 'true') bits.push('with photos');
  if (p.verifiedOnly === 'true') bits.push('verified sellers');
  return bits.join(' · ') || 'Any listing';
}

/** Merge a fresh event into a newest-first feed without duplicates. */
export function mergeFeed(feed: AlertFeedItem[], incoming: AlertEvent[]): AlertFeedItem[] {
  const seen = new Set(feed.map((f) => f.id));
  const fresh = incoming.filter((e) => !seen.has(e.id)).map((e): AlertFeedItem => ({ ...e, isRead: false }));
  return [...fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), ...feed];
}

/** Remember an id as handled; keeps the set bounded. */
export function rememberId(seen: Set<string>, id: string, max = 200): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > max) seen.delete(seen.values().next().value as string);
  return true;
}
