import { describe, it, expect, vi } from 'vitest';

// search.ts imports the shared Prisma client for its vocabulary helpers; the
// pure parsing/scoring functions under test don't touch it.
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@prisma/client', () => ({ Prisma: {} }));

import { parseSearchQuery, scoreListing, buildSearchWhere, hasSearchTerms, levenshtein, singularize } from './search';

describe('parseSearchQuery', () => {
  it('splits words, drops stop words, keeps model numbers', () => {
    const p = parseSearchQuery('iPhone 14 Pro for sale');
    expect(p.tokens).toEqual(['iphone', '14', 'pro']);
  });
  it('extracts phrases and exclusions', () => {
    const p = parseSearchQuery('"toyota harrier" -salvage 2015');
    expect(p.phrases).toEqual(['toyota harrier']);
    expect(p.exclude).toEqual(['salvage']);
    expect(p.tokens).toEqual(['2015']);
  });
  it('lifts price limits out of the text', () => {
    expect(parseSearchQuery('phone under 500k')).toMatchObject({ tokens: ['phone'], priceMax: 500000 });
    expect(parseSearchQuery('laptop over 1.5m')).toMatchObject({ tokens: ['laptop'], priceMin: 1500000 });
    expect(parseSearchQuery('tv between 1m and 2m')).toMatchObject({ tokens: ['tv'], priceMin: 1000000, priceMax: 2000000 });
    expect(parseSearchQuery('sofa below ugx 1,200,000')).toMatchObject({ tokens: ['sofa'], priceMax: 1200000 });
  });
  it('does not treat "500kg" or "14" as a price', () => {
    const p = parseSearchQuery('cement 500kg iphone 14');
    expect(p.priceMax).toBeUndefined();
    expect(p.tokens).toContain('500kg');
  });
  it('adds plural/singular and synonym variants', () => {
    const p = parseSearchQuery('phones');
    expect(p.variants.get('phones')).toEqual(expect.arrayContaining(['phones', 'phone', 'mobile']));
  });
  it('a price-only query still counts as a search', () => {
    expect(hasSearchTerms(parseSearchQuery('under 300k'))).toBe(true);
  });
});

describe('buildSearchWhere', () => {
  it('ANDs every word and applies the price range', () => {
    const w = buildSearchWhere(parseSearchQuery('samsung phone under 500k')) as { AND: unknown[] };
    expect(w.AND).toHaveLength(3); // samsung, phone, price
    expect(JSON.stringify(w.AND[2])).toContain('"lte":500000');
  });
});

describe('scoreListing', () => {
  const base = { createdAt: new Date(), views: 0 };
  const p = parseSearchQuery('iphone 14');
  it('ranks exact title above description-only mentions', () => {
    const exact = scoreListing({ ...base, title: 'iPhone 14', description: '' }, p);
    const partial = scoreListing({ ...base, title: 'Phone case', description: 'fits iphone 14' }, p);
    expect(exact).toBeGreaterThan(partial);
  });
  it('prefers listings whose title has every word', () => {
    const all = scoreListing({ ...base, title: 'Apple iPhone 14 Pro 256GB', description: '' }, p);
    const some = scoreListing({ ...base, title: 'iPhone 11', description: '' }, p);
    expect(all).toBeGreaterThan(some);
  });
});

describe('helpers', () => {
  it('levenshtein respects the cap', () => {
    expect(levenshtein('laptop', 'laptpo', 2)).toBe(2);
    expect(levenshtein('laptop', 'tractor', 2)).toBeGreaterThan(2);
  });
  it('singularize', () => {
    expect(singularize('phones')).toBe('phone');
    expect(singularize('batteries')).toBe('battery');
    expect(singularize('glass')).toBe('glass');
  });
});
