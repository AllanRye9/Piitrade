/**
 * priceOffers.ts — the rules of buyer/seller price negotiation, kept free of database and HTTP code so
 * they can be unit-tested. routes/priceOffers.ts applies them.
 *
 * (Not related to utils/offers.ts, which resolves the admin-controlled "Special Offers" home sections.)
 */

import type { PriceOffer } from '@prisma/client';

export type OfferStatusValue = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED' | 'WITHDRAWN' | 'EXPIRED';

/** How long the other party has to answer an offer. */
export const OFFER_TTL_HOURS = 48;
/** After a seller declines, the same buyer must wait this long before offering on that listing again. */
export const REOFFER_COOLDOWN_HOURS = 24;
/** Offers below this share of the asking price are rejected as not serious. */
export const MIN_OFFER_RATIO = 0.1;
export const MAX_NOTE_LENGTH = 300;
/** Cap on negotiation steps for one buyer on one listing (offers + counters). */
export const MAX_STEPS_PER_LISTING = 12;
/** Cap on new offers one account may start in 24 hours, across all listings. */
export const MAX_NEW_OFFERS_PER_DAY = 30;
const MAX_AMOUNT = 1_000_000_000_000;

const HOUR_MS = 60 * 60 * 1000;

export function offerExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + OFFER_TTL_HOURS * HOUR_MS);
}

export function cooldownEnd(declinedAt: Date): Date {
  return new Date(declinedAt.getTime() + REOFFER_COOLDOWN_HOURS * HOUR_MS);
}

/** A PENDING offer past its deadline counts as EXPIRED even before anything has rewritten the row. */
export function effectiveStatus(
  offer: { status: OfferStatusValue; expiresAt: Date },
  now: Date = new Date(),
): OfferStatusValue {
  return offer.status === 'PENDING' && offer.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : offer.status;
}

/** The offer as the API returns it: status is the effective one (an overdue PENDING reads as EXPIRED). */
export function serializeOffer(o: PriceOffer, now: Date = new Date()) {
  return {
    id: o.id,
    listingId: o.listingId,
    buyerId: o.buyerId,
    sellerId: o.sellerId,
    madeById: o.madeById,
    amount: o.amount,
    currency: o.currency,
    status: effectiveStatus(o, now),
    note: o.note,
    parentId: o.parentId,
    expiresAt: o.expiresAt,
    respondedAt: o.respondedAt,
    createdAt: o.createdAt,
  };
}

export type AmountResult = { ok: true; value: number } | { ok: false; message: string };

/** Accepts a JSON number or a plain numeric string ("450000", "450,000"); rounds to 2 decimals. */
export function parseAmount(raw: unknown): AmountResult {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(raw.trim())) n = Number(raw.trim().replace(/,/g, ''));
  else return { ok: false, message: 'Enter the amount as a number' };
  if (!Number.isFinite(n) || n <= 0) return { ok: false, message: 'The offer must be greater than zero' };
  if (n > MAX_AMOUNT) return { ok: false, message: 'That amount is too large' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** First offer from a buyer: below the asking price, but not trivially low. Returns an error message or null. */
export function validateInitialOffer(amount: number, askingPrice: number, currency: string): string | null {
  if (amount >= askingPrice) {
    return `Your offer is at or above the asking price (${formatMoney(askingPrice, currency)}). Message the seller to buy at that price.`;
  }
  if (amount < askingPrice * MIN_OFFER_RATIO) {
    return `Offers must be at least ${Math.round(MIN_OFFER_RATIO * 100)}% of the asking price (${formatMoney(askingPrice * MIN_OFFER_RATIO, currency)}).`;
  }
  return null;
}

/**
 * A counter must land strictly between the offer being answered and the responder's own previous
 * position (the asking price for a seller's first counter), so every round moves the two sides
 * closer together. To agree, simply accept.
 */
export function validateCounter(
  amount: number,
  offerAmount: number,
  ownPreviousAmount: number,
  currency: string,
): string | null {
  const lo = Math.min(offerAmount, ownPreviousAmount);
  const hi = Math.max(offerAmount, ownPreviousAmount);
  if (!(amount > lo && amount < hi)) {
    return `A counter-offer must be between ${formatMoney(lo, currency)} and ${formatMoney(hi, currency)}. To agree on ${formatMoney(offerAmount, currency)}, accept it instead.`;
  }
  return null;
}

/** Trims an optional note; returns null when empty. Throws nothing — callers check `tooLong`. */
export function cleanNote(raw: unknown): { note: string | null; tooLong: boolean; invalid: boolean } {
  if (raw === undefined || raw === null || raw === '') return { note: null, tooLong: false, invalid: false };
  if (typeof raw !== 'string') return { note: null, tooLong: false, invalid: true };
  const note = raw.replace(/\s+/g, ' ').trim();
  if (note.length > MAX_NOTE_LENGTH) return { note: null, tooLong: true, invalid: false };
  return { note: note || null, tooLong: false, invalid: false };
}

export type OfferChatKind = 'OFFER' | 'COUNTER' | 'ACCEPTED' | 'DECLINED';

/** Text of the chat message that accompanies an offer step (also what the inbox preview shows). */
export function offerChatText(kind: OfferChatKind, amount: number, currency: string, note: string | null): string {
  const money = formatMoney(amount, currency);
  const head =
    kind === 'OFFER' ? `💰 Offer: ${money}`
    : kind === 'COUNTER' ? `🔁 Counter-offer: ${money}`
    : kind === 'ACCEPTED' ? `✅ Accepted the offer of ${money}. Agree on payment and pick-up or delivery here in the chat.`
    : `❌ Declined the offer of ${money}`;
  return note ? `${head}\n${note}` : head;
}
