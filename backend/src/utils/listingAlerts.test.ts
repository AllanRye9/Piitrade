import { describe, it, expect } from 'vitest';
import { matchesCheapCriteria, isLive, formatAlertPrice, type AlertListing } from './listingAlerts';
import { buildListingAlertEmail } from './email';
import { sanitizeParams } from './savedSearches';

const listing = (over: Partial<AlertListing> = {}): AlertListing => ({
  id: 'l1', title: 'Plot in Wakiso', price: 4_500_000, currency: 'UGX', priceUnit: 'ITEM', location: 'Wakiso, Uganda',
  condition: 'NEW', images: ['a.jpg'], userId: 'seller', status: 'ACTIVE', expiresAt: null,
  category: { slug: 'land-plots', parent: { slug: 'property' } }, user: { isKycVerified: false }, ...over,
});

describe('matchesCheapCriteria', () => {
  it('land under 5 million: matches at or below, not above', () => {
    const p = sanitizeParams({ category: 'land-plots', priceMax: 5_000_000 });
    expect(matchesCheapCriteria(listing({ price: 4_500_000 }), p)).toBe(true);
    expect(matchesCheapCriteria(listing({ price: 5_000_000 }), p)).toBe(true);
    expect(matchesCheapCriteria(listing({ price: 5_000_001 }), p)).toBe(false);
  });
  it('smartphone below 250000 on a parent-level alert matches a subcategory listing', () => {
    const p = sanitizeParams({ category: 'electronics', priceMax: 250_000 });
    const phone = listing({ price: 240_000, category: { slug: 'smartphones', parent: { slug: 'electronics' } } });
    expect(matchesCheapCriteria(phone, p)).toBe(true);
    expect(matchesCheapCriteria({ ...phone, price: 260_000 }, p)).toBe(false);
    expect(matchesCheapCriteria({ ...phone, category: { slug: 'land-plots', parent: { slug: 'property' } } }, p)).toBe(false);
  });
  it('price minimum, range, location (case-insensitive), condition, photos, verified sellers', () => {
    expect(matchesCheapCriteria(listing(), sanitizeParams({ priceMin: 5_000_000 }))).toBe(false);
    expect(matchesCheapCriteria(listing(), sanitizeParams({ priceMin: 4_000_000, priceMax: 5_000_000 }))).toBe(true);
    expect(matchesCheapCriteria(listing(), sanitizeParams({ location: 'WAKISO' }))).toBe(true);
    expect(matchesCheapCriteria(listing(), sanitizeParams({ location: 'Gulu' }))).toBe(false);
    expect(matchesCheapCriteria(listing(), sanitizeParams({ condition: 'USED' }))).toBe(false);
    expect(matchesCheapCriteria(listing({ images: [] }), sanitizeParams({ withPhotos: true }))).toBe(false);
    expect(matchesCheapCriteria(listing(), sanitizeParams({ verifiedOnly: true }))).toBe(false);
    expect(matchesCheapCriteria(listing({ user: { isKycVerified: true } }), sanitizeParams({ verifiedOnly: true }))).toBe(true);
  });
  it('a listing in another currency never matches a price bound, but matches alerts without one', () => {
    const usd = listing({ currency: 'USD', price: 100 });
    expect(matchesCheapCriteria(usd, sanitizeParams({ priceMax: 250_000 }))).toBe(false);
    expect(matchesCheapCriteria(usd, sanitizeParams({ priceMin: 1 }))).toBe(false);
    expect(matchesCheapCriteria(usd, sanitizeParams({ category: 'land-plots' }))).toBe(true);
  });
  it('a keyword-only alert passes the cheap checks (the keyword is checked in the database)', () => {
    expect(matchesCheapCriteria(listing(), sanitizeParams({ q: 'toyota' }))).toBe(true);
  });
});

describe('isLive / formatAlertPrice', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  it('live = ACTIVE and not expired', () => {
    expect(isLive({ status: 'ACTIVE', expiresAt: null }, now)).toBe(true);
    expect(isLive({ status: 'ACTIVE', expiresAt: new Date('2026-10-25T00:00:00Z') }, now)).toBe(true);
    expect(isLive({ status: 'ACTIVE', expiresAt: new Date('2026-10-24T09:00:00Z') }, now)).toBe(false);
    expect(isLive({ status: 'PENDING', expiresAt: null }, now)).toBe(false);
    expect(isLive({ status: 'SOLD', expiresAt: null }, now)).toBe(false);
  });
  it('formats price with currency and unit', () => {
    expect(formatAlertPrice(5_000_000, 'UGX', 'ITEM')).toBe('UGX 5,000,000');
    expect(formatAlertPrice(2500, 'UGX', 'KG')).toBe('UGX 2,500 per kg');
    expect(formatAlertPrice(1200.4, 'UGX', 'TONNE')).toBe('UGX 1,200 per tonne');
  });
});

describe('alert e-mail', () => {
  it('escapes listing title, alert name and recipient name; links to the listing and alert settings', () => {
    const { subject, html } = buildListingAlertEmail('<b>Ann</b>', {
      alertName: 'Land <script>alert(1)</script>', listingTitle: 'Plot "A" & <img src=x onerror=1>', priceText: 'UGX 4,500,000', location: 'Wakiso', listingId: 'abc 123',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Ann</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('/listings/abc%20123');
    expect(html).toContain('/profile/alerts');
    expect(subject).toBe('New match: Plot "A" & <img src=x onerror=1>'); // subject is plain text, never HTML
    expect(subject).not.toMatch(/[\r\n]/);
  });
  it('a title with line breaks cannot inject headers into the subject', () => {
    const { subject } = buildListingAlertEmail('Ann', { alertName: 'x', listingTitle: 'Hi\r\nBcc: evil@x.com', priceText: 'UGX 1', location: '', listingId: '1' });
    expect(subject).not.toMatch(/[\r\n]/);
  });
});
