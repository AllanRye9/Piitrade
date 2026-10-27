/**
 * homeLayout.ts — which sections the homepage shows, in what order, and the admin-made collection rows.
 *
 * Stored as one JSON value (SiteConfig.homeLayout). Everything here is pure and unit-tested:
 * `normalizeHomeLayout` turns whatever is stored (nothing, an old shape, hand-edited junk) into a complete,
 * valid layout, so the public page and the admin editor never have to defend against bad data, and a section
 * added in a later release simply appears in its default place for sites that saved a layout earlier.
 */

export interface BuiltInSection { key: string; label: string; description: string; icon: string; canRename: boolean }

/** In default on-page order. */
export const BUILT_IN_SECTIONS: BuiltInSection[] = [
  { key: 'flash-deals', label: 'Flash Deals', description: 'Admin-placed flash listings, with a countdown.', icon: '⚡', canRename: false },
  { key: 'todays-deals', label: "Today's Deals", description: 'Deals configured in Settings → Today\'s Deals.', icon: '🔥', canRename: false },
  { key: 'agriculture', label: 'Agriculture', description: 'Fresh farm produce and inputs.', icon: '🌾', canRename: false },
  { key: 'back-to-school', label: 'Back to School', description: 'Shows only inside its scheduled window.', icon: '🎒', canRename: false },
  { key: 'featured-stores', label: 'Trusted Stores', description: 'Featured web stores row.', icon: '🏪', canRename: false },
  { key: 'recent-by-category', label: 'Recent across categories', description: 'Latest ads in Motors, Electronics, Property and Fashion.', icon: '🕒', canRename: true },
  { key: 'latest-collections', label: 'Latest Collections', description: 'Placed listings plus every active Gold / Platinum ad.', icon: '⭐', canRename: true },
  { key: 'featured-deal', label: 'Featured Deal', description: 'Listings placed as Featured Deal.', icon: '✦', canRename: true },
  { key: 'other-collections', label: 'Other Collections', description: 'More listings from the marketplace.', icon: '🛍️', canRename: true },
  { key: 'quick-actions', label: 'Quick actions', description: 'Shortcut buttons.', icon: '⚡', canRename: false },
  { key: 'trust-strip', label: 'Safety & trust strip', description: 'Safety tips and why-Piitrade highlights.', icon: '🛡️', canRename: false },
  { key: 'conversion-strip', label: 'Get verified / Post an ad', description: 'Two call-to-action cards.', icon: '🚀', canRename: false },
];
export const BUILT_IN_KEYS = BUILT_IN_SECTIONS.map((s) => s.key);

export type PlacementValue = 'LATEST_COLLECTIONS' | 'FEATURED_DEAL' | 'FLASH_SALE' | 'BACK_TO_SCHOOL';
export const PLACEMENT_VALUES: PlacementValue[] = ['LATEST_COLLECTIONS', 'FEATURED_DEAL', 'FLASH_SALE', 'BACK_TO_SCHOOL'];

export type CollectionSource =
  | { type: 'category'; slug: string }
  | { type: 'placement'; placement: PlacementValue }
  | { type: 'listings'; ids: string[] };

export interface CustomCollection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  enabled: boolean;
  limit: number;
  source: CollectionSource;
}

export interface SectionSetting { enabled: boolean; title?: string; subtitle?: string }

export interface HomeLayout {
  /** Section keys in on-page order: built-in keys and `custom:<id>` for admin-made collections. */
  order: string[];
  settings: Record<string, SectionSetting>;
  collections: CustomCollection[];
}

export const MAX_COLLECTIONS = 12;
export const MAX_COLLECTION_ITEMS = 24;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const ID_RE = /^[a-z0-9]{4,24}$/;
const cleanText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const customKey = (id: string) => `custom:${id}`;

function normalizeSource(raw: unknown): CollectionSource | null {
  if (!isObj(raw)) return null;
  if (raw.type === 'category' && typeof raw.slug === 'string' && SLUG_RE.test(raw.slug)) return { type: 'category', slug: raw.slug };
  if (raw.type === 'placement' && PLACEMENT_VALUES.includes(raw.placement as PlacementValue)) return { type: 'placement', placement: raw.placement as PlacementValue };
  if (raw.type === 'listings' && Array.isArray(raw.ids)) {
    const ids = [...new Set(raw.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40))].slice(0, MAX_COLLECTION_ITEMS);
    return { type: 'listings', ids };
  }
  return null;
}

function normalizeCollection(raw: unknown): CustomCollection | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : '';
  const source = normalizeSource(raw.source);
  const title = cleanText(raw.title, 60);
  if (!id || !source || !title) return null;
  const limit = Math.min(MAX_COLLECTION_ITEMS, Math.max(2, Math.round(Number(raw.limit)) || 12));
  return { id, title, subtitle: cleanText(raw.subtitle, 120), icon: cleanText(raw.icon, 4) || '✨', enabled: raw.enabled !== false, limit, source };
}

/** Always returns a complete, valid layout, whatever was stored. */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const src = isObj(raw) ? raw : {};

  const collections: CustomCollection[] = [];
  const seenIds = new Set<string>();
  for (const c of Array.isArray(src.collections) ? src.collections : []) {
    const n = normalizeCollection(c);
    if (n && !seenIds.has(n.id) && collections.length < MAX_COLLECTIONS) { seenIds.add(n.id); collections.push(n); }
  }

  const valid = new Set<string>([...BUILT_IN_KEYS, ...collections.map((c) => customKey(c.id))]);
  const order: string[] = [];
  for (const k of Array.isArray(src.order) ? src.order : []) {
    if (typeof k === 'string' && valid.has(k) && !order.includes(k)) order.push(k);
  }
  // Built-in sections the saved order doesn't know yet go after their default predecessor.
  BUILT_IN_KEYS.forEach((key, i) => {
    if (order.includes(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const p = order.indexOf(BUILT_IN_KEYS[j]); if (p >= 0) { at = p + 1; break; } }
    order.splice(at, 0, key);
  });
  // New collections without a saved position go to the end.
  for (const c of collections) if (!order.includes(customKey(c.id))) order.push(customKey(c.id));

  const settings: Record<string, SectionSetting> = {};
  const rawSettings = isObj(src.settings) ? src.settings : {};
  for (const section of BUILT_IN_SECTIONS) {
    const s = isObj(rawSettings[section.key]) ? (rawSettings[section.key] as Record<string, unknown>) : {};
    const title = section.canRename ? cleanText(s.title, 60) : '';
    const subtitle = section.canRename ? cleanText(s.subtitle, 120) : '';
    settings[section.key] = { enabled: s.enabled !== false, ...(title && { title }), ...(subtitle && { subtitle }) };
  }
  return { order, settings, collections };
}

/** Generates an id for a new collection. */
export function newCollectionId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}
