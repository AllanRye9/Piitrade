import { api } from '@/lib/api';
import type { PriceOffer } from '@/lib/types';

/** Mirrors backend utils/priceOffers.ts; the server re-checks everything. */
export const MIN_OFFER_RATIO = 0.1;
export const MAX_NOTE_LENGTH = 300;

export interface ListingOfferInfo {
  isOwner: boolean;
  acceptsOffers: boolean;
  canOffer: boolean;
  reason?: string | null;
  pendingCount?: number;
  offer: PriceOffer | null;
}

export async function fetchOfferInfo(listingId: string): Promise<ListingOfferInfo> {
  const { data } = await api.get<ListingOfferInfo>(`/price-offers/listing/${encodeURIComponent(listingId)}/mine`);
  return data;
}

export function formatOfferAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** "47h left" / "12m left", or null when already past. */
export function timeLeft(expiresAt: string, now: number = Date.now()): string | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (!(ms > 0)) return null;
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours}h left` : `${Math.floor(hours / 24)}d left`;
}

/** Quick-pick offers at 5/10/15/20% below asking, rounded to a sensible step. */
export function suggestOffers(price: number): number[] {
  if (!(price > 0)) return [];
  const step = price >= 100000 ? 1000 : price >= 1000 ? 100 : 1;
  const out: number[] = [];
  for (const pct of [0.95, 0.9, 0.85, 0.8]) {
    const v = Math.round((price * pct) / step) * step;
    if (v < price && v >= price * MIN_OFFER_RATIO && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Accepts "450000" or "450,000"; returns NaN for anything else. */
export function parseAmountInput(raw: string): number {
  const t = raw.trim();
  if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t.replace(/,/g, ''));
}
