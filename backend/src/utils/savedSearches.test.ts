import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));
import { sanitizeParams, hasAnyFilter, describeParams, toQueryString, buildSavedSearchWhere } from './savedSearches';

describe('saved searches', () => {
  it('keeps only whitelisted, validated keys', () => {
    const p = sanitizeParams({ q: '  toyota  ', category: 'used-cars', evil: { $ne: 1 }, priceMax: '30000000', priceMin: 'abc', condition: 'BROKEN', verifiedOnly: true, location: 'Kampala' });
    expect(p).toEqual({ q: 'toyota', category: 'used-cars', priceMax: '30000000', verifiedOnly: 'true', location: 'Kampala' });
  });
  it('rejects category slugs with odd characters and non-objects', () => {
    expect(sanitizeParams({ category: 'a b; drop' })).toEqual({});
    expect(sanitizeParams(null)).toEqual({});
    expect(hasAnyFilter(sanitizeParams('x'))).toBe(false);
  });
  it('describes and serialises a search', () => {
    const p = sanitizeParams({ q: 'iphone', location: 'Kampala', priceMax: 1500000 });
    expect(describeParams(p)).toContain('iphone');
    expect(describeParams(p)).toContain('Kampala');
    expect(toQueryString(p)).toBe('q=iphone&location=Kampala&priceMax=1500000');
  });
  it('builds an ACTIVE-only filter, optionally limited to listings newer than the watermark', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    const since = new Date('2026-10-18T00:00:00Z');
    const where = JSON.stringify(buildSavedSearchWhere(sanitizeParams({ condition: 'NEW', withPhotos: 'true' }), now, since));
    expect(where).toContain('"status":"ACTIVE"');
    expect(where).toContain('"condition":"NEW"');
    expect(where).toContain('"isEmpty":false');
    expect(where).toContain('"createdAt":{"gt":"2026-10-18T00:00:00.000Z"}');
  });
});
