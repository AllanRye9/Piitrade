import type { SavedSearchParams } from './savedSearches';

/** The slice of a Listing the alert rules need. */
export interface AlertListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  priceUnit: string;
  location: string;
  condition: string | null;
  images: string[];
  userId: string;
  status: string;
  expiresAt: Date | null;
  category: { slug: string; parent: { slug: string } | null };
  user: { isKycVerified: boolean };
}

/** Everything except a keyword (which needs the database). */
export function matchesCheapCriteria(listing: AlertListing, p: SavedSearchParams): boolean {
  if (p.category && p.category !== listing.category.slug && p.category !== listing.category.parent?.slug) return false;
  if (p.location && !listing.location.toLowerCase().includes(p.location.toLowerCase())) return false;
  if (p.condition && listing.condition !== p.condition) return false;
  if (p.verifiedOnly && !listing.user.isKycVerified) return false;
  if (p.withPhotos && listing.images.length === 0) return false;
  if (p.priceMin || p.priceMax) {
    if (listing.currency !== 'UGX') return false;
    if (p.priceMin && listing.price < parseFloat(p.priceMin)) return false;
    if (p.priceMax && listing.price > parseFloat(p.priceMax)) return false;
  }
  return true;
}

export function isLive(listing: Pick<AlertListing, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return listing.status === 'ACTIVE' && (!listing.expiresAt || listing.expiresAt > now);
}

export function formatAlertPrice(price: number, currency: string, priceUnit: string): string {
  const unit = priceUnit === 'KG' ? ' per kg' : priceUnit === 'TONNE' ? ' per tonne' : '';
  return `${currency} ${Math.round(price).toLocaleString('en-UG')}${unit}`;
}