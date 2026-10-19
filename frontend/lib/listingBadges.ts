import type { Listing } from '@/lib/types';

export type BadgeKind = 'featured' | 'price-drop' | 'new';

export interface ListingBadge {
  kind: BadgeKind;
  label: string;
  icon: string;
  className: string;
}

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000;

/** True for a listing created within the last 48 h. */
export function isJustListed(l: Pick<Listing, 'createdAt'>, now = Date.now()): boolean {
  const t = new Date(l.createdAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t < NEW_WINDOW_MS;
}

/** Percent off when the seller lowered the price (originalPrice > price), else null. */
export function priceDropPercent(l: Pick<Listing, 'price' | 'originalPrice'>): number | null {
  if (l.originalPrice == null || l.originalPrice <= 0 || l.originalPrice <= l.price) return null;
  return Math.round(((l.originalPrice - l.price) / l.originalPrice) * 100);
}

/**
 * Image-overlay badges in priority order (Featured → Price dropped → New).
 * Cards show the first two so a thumbnail never turns into a sticker sheet.
 */
export function getListingBadges(l: Listing, now = Date.now()): ListingBadge[] {
  const out: ListingBadge[] = [];
  if (l.placement === 'FEATURED_DEAL' || l.tier === 'GOLD' || l.tier === 'PLATINUM') {
    out.push({ kind: 'featured', label: 'Featured', icon: '★', className: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white' });
  }
  const drop = priceDropPercent(l);
  if (drop && drop > 0) {
    out.push({ kind: 'price-drop', label: `Price dropped ${drop}%`, icon: '↓', className: 'bg-lime-400 text-emerald-950' });
  }
  if (isJustListed(l, now)) {
    out.push({ kind: 'new', label: 'New', icon: '✦', className: 'bg-emerald-500 text-white' });
  }
  return out;
}
