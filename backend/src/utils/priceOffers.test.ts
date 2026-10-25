import { describe, it, expect } from 'vitest';
import {
  OFFER_TTL_HOURS, REOFFER_COOLDOWN_HOURS, MIN_OFFER_RATIO, MAX_NOTE_LENGTH,
  offerExpiry, cooldownEnd, effectiveStatus, parseAmount, formatMoney,
  validateInitialOffer, validateCounter, cleanNote, offerChatText, serializeOffer,
} from './priceOffers';

const T0 = new Date('2026-10-23T10:00:00Z');

describe('offer deadlines', () => {
  it('expires after the TTL', () => {
    expect(offerExpiry(T0).getTime() - T0.getTime()).toBe(OFFER_TTL_HOURS * 3600_000);
  });
  it('treats an overdue PENDING offer as EXPIRED but leaves other states alone', () => {
    const past = new Date(T0.getTime() - 1000);
    const future = new Date(T0.getTime() + 1000);
    expect(effectiveStatus({ status: 'PENDING', expiresAt: past }, T0)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PENDING', expiresAt: T0 }, T0)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PENDING', expiresAt: future }, T0)).toBe('PENDING');
    expect(effectiveStatus({ status: 'ACCEPTED', expiresAt: past }, T0)).toBe('ACCEPTED');
    expect(effectiveStatus({ status: 'DECLINED', expiresAt: past }, T0)).toBe('DECLINED');
  });
  it('cooldown ends REOFFER_COOLDOWN_HOURS after a decline', () => {
    expect(cooldownEnd(T0).getTime() - T0.getTime()).toBe(REOFFER_COOLDOWN_HOURS * 3600_000);
  });
});

describe('parseAmount', () => {
  it('accepts numbers and plain numeric strings, rounding to 2 decimals', () => {
    expect(parseAmount(450000)).toEqual({ ok: true, value: 450000 });
    expect(parseAmount('450000')).toEqual({ ok: true, value: 450000 });
    expect(parseAmount('450,000')).toEqual({ ok: true, value: 450000 });
    expect(parseAmount('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseAmount(10.005)).toEqual({ ok: true, value: 10.01 });
  });
  it('rejects junk, zero, negatives, non-finite and absurd values', () => {
    for (const bad of ['', 'abc', '1e5', '12,34', '-5', 0, -1, NaN, Infinity, null, undefined, {}, [], 2e12]) {
      expect(parseAmount(bad).ok).toBe(false);
    }
  });
});

describe('validateInitialOffer', () => {
  it('requires a price below asking and not trivially low', () => {
    expect(validateInitialOffer(90, 100, 'UGX')).toBeNull();
    expect(validateInitialOffer(100, 100, 'UGX')).toMatch(/at or above the asking price/);
    expect(validateInitialOffer(150, 100, 'UGX')).toMatch(/at or above the asking price/);
    expect(validateInitialOffer(100 * MIN_OFFER_RATIO, 100, 'UGX')).toBeNull();
    expect(validateInitialOffer(100 * MIN_OFFER_RATIO - 0.01, 100, 'UGX')).toMatch(/at least 10%/);
  });
});

describe('validateCounter', () => {
  it('seller counter must sit strictly between the buyer offer and the asking price', () => {
    expect(validateCounter(95, 80, 100, 'UGX')).toBeNull();
    expect(validateCounter(80, 80, 100, 'UGX')).not.toBeNull();   // equals the offer: just accept
    expect(validateCounter(100, 80, 100, 'UGX')).not.toBeNull();  // equals own position: that is declining
    expect(validateCounter(70, 80, 100, 'UGX')).not.toBeNull();   // moves the wrong way
    expect(validateCounter(120, 80, 100, 'UGX')).not.toBeNull();
  });
  it('buyer counter must sit strictly between their previous offer and the seller counter', () => {
    expect(validateCounter(88, 95, 80, 'UGX')).toBeNull();
    expect(validateCounter(80, 95, 80, 'UGX')).not.toBeNull();
    expect(validateCounter(95, 95, 80, 'UGX')).not.toBeNull();
    expect(validateCounter(99, 95, 80, 'UGX')).not.toBeNull();
  });
  it('names the allowed range in the error', () => {
    expect(validateCounter(10, 80, 100, 'UGX')).toContain('between UGX 80 and UGX 100');
  });
});

describe('cleanNote', () => {
  it('normalises whitespace, nulls empties, and flags bad input', () => {
    expect(cleanNote('  hello   world \n ok ')).toEqual({ note: 'hello world ok', tooLong: false, invalid: false });
    expect(cleanNote('')).toEqual({ note: null, tooLong: false, invalid: false });
    expect(cleanNote(undefined).note).toBeNull();
    expect(cleanNote('   ').note).toBeNull();
    expect(cleanNote(42).invalid).toBe(true);
    expect(cleanNote({}).invalid).toBe(true);
    expect(cleanNote('x'.repeat(MAX_NOTE_LENGTH + 1)).tooLong).toBe(true);
    expect(cleanNote('x'.repeat(MAX_NOTE_LENGTH)).tooLong).toBe(false);
  });
});

describe('chat text', () => {
  it('formats money with grouping', () => {
    expect(formatMoney(1234567.5, 'UGX')).toBe('UGX 1,234,567.5');
  });
  it('writes a message for each step and appends the note', () => {
    expect(offerChatText('OFFER', 450000, 'UGX', null)).toBe('💰 Offer: UGX 450,000');
    expect(offerChatText('COUNTER', 480000, 'UGX', 'last price')).toBe('🔁 Counter-offer: UGX 480,000\nlast price');
    expect(offerChatText('ACCEPTED', 450000, 'UGX', null)).toContain('Accepted the offer of UGX 450,000');
    expect(offerChatText('DECLINED', 450000, 'UGX', null)).toContain('Declined the offer of UGX 450,000');
  });
});

describe('serializeOffer', () => {
  it('reports the effective status and exposes only API fields', () => {
    const row = {
      id: 'o1', listingId: 'l1', buyerId: 'b', sellerId: 's', madeById: 'b', amount: 90, currency: 'UGX', status: 'PENDING',
      note: null, parentId: null, expiresAt: new Date(T0.getTime() - 1), respondedAt: null, createdAt: T0, updatedAt: T0,
    } as unknown as Parameters<typeof serializeOffer>[0];
    const out = serializeOffer(row, T0);
    expect(out.status).toBe('EXPIRED');
    expect(out).not.toHaveProperty('updatedAt');
  });
});
