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

describe('detail fields and districts', () => {
  const flat = (w: unknown): string => JSON.stringify(w);
  it('matches brand / model / breed answers saved by the ad form, in any common letter case', () => {
    const where = flat(buildSearchWhere(parseSearchQuery('samsung')));
    for (const form of ['samsung', 'Samsung', 'SAMSUNG']) expect(where).toContain(`"path":["brand"],"string_contains":"${form}"`);
    expect(where).toContain('"path":["breed"]');
    expect(where).toContain('"path":["model"]');
  });
  it('a district also searches its towns and neighbourhoods', () => {
    const where = flat(buildSearchWhere(parseSearchQuery('wakiso')));
    expect(where).toContain('entebbe');
  });
  it('ordinary words do not trigger a district expansion', () => {
    expect(flat(buildSearchWhere(parseSearchQuery('laptop')))).not.toContain('entebbe');
  });
  it('ranks an ad whose brand answer matches above one that does not mention the word', () => {
    const base = { title: 'Phone for sale', createdAt: new Date(), tags: [], views: 0 };
    const p = parseSearchQuery('tecno');
    expect(scoreListing({ ...base, customFieldValues: { brand: 'Tecno' } }, p)).toBeGreaterThan(scoreListing({ ...base }, p));
  });
});

import { coreMatchesAll } from './search';
describe('coreMatchesAll (precision)', () => {
  const base = { createdAt: new Date() } as { createdAt: Date };
  const L = (o: object) => ({ ...base, title: '', ...o }) as Parameters<typeof coreMatchesAll>[0];
  it('needs whole words for short words and numbers', () => {
    const p = parseSearchQuery('tv');
    expect(coreMatchesAll(L({ title: 'Samsung 55 inch TV' }), p)).toBe(true);
    expect(coreMatchesAll(L({ title: 'Activity table', description: 'tv stand' }), p)).toBe(false);
    const p14 = parseSearchQuery('iphone 14');
    expect(coreMatchesAll(L({ title: 'iPhone 14 Pro Max' }), p14)).toBe(true);
    expect(coreMatchesAll(L({ title: 'iPhone 140 clone' }), p14)).toBe(false);
  });
  it('ignores description-only hits but accepts category, tags, brand and location', () => {
    const p = parseSearchQuery('laptop');
    expect(coreMatchesAll(L({ title: 'Dell XPS', description: 'great laptop' }), p)).toBe(false);
    expect(coreMatchesAll(L({ title: 'Dell XPS', category: { name: 'Laptops' } }), p)).toBe(true);
    expect(coreMatchesAll(L({ title: 'Dell XPS', tags: ['laptop'] }), p)).toBe(true);
    const pb = parseSearchQuery('samsung');
    expect(coreMatchesAll(L({ title: 'Galaxy S23', customFieldValues: { brand: 'Samsung' } }), pb)).toBe(true);
    const pl = parseSearchQuery('phone gulu');
    expect(coreMatchesAll(L({ title: 'Tecno phone', location: 'Gulu' }), pl)).toBe(true);
    expect(coreMatchesAll(L({ title: 'Tecno phone', location: 'Kampala' }), pl)).toBe(false);
  });
  it('matches synonyms and plurals in the title', () => {
    expect(coreMatchesAll(L({ title: 'Mobile phones in bulk' }), parseSearchQuery('smartphone'))).toBe(true);
    expect(coreMatchesAll(L({ title: 'Used couches' }), parseSearchQuery('sofa'))).toBe(true);
  });
});

import { damerau, nearestWords, idfWeight } from './search';
describe('advanced query understanding', () => {
  it('splits glued model numbers and keeps unit sizes as one token', () => {
    expect(parseSearchQuery('iphone14 pro').tokens).toEqual(['iphone', '14', 'pro']);
    expect(parseSearchQuery('rtx3060').tokens).toEqual(['rtx', '3060']);
    expect(parseSearchQuery('phone 128 gb').tokens).toEqual(['phone', '128gb']);
    expect(parseSearchQuery('cement 500kg').tokens).toEqual(['cement', '500kg']);
    expect(parseSearchQuery('s23').tokens).toEqual(['s23']);
  });
  it('a unit size also matches the spaced spelling', () => {
    expect(parseSearchQuery('128gb').variants.get('128gb')).toContain('128 gb');
  });
  it('knows more local and spelling synonyms', () => {
    expect(parseSearchQuery('plot').variants.get('plot')).toContain('land');
    expect(parseSearchQuery('tyre').variants.get('tyre')).toContain('tire');
  });
});

describe('typo tolerance', () => {
  const words = new Map<string, number>([['laptop', 20], ['samsung', 30], ['sofa', 9], ['tractor', 4], ['laptops', 1]]);
  it('damerau counts a swapped pair as one edit (levenshtein counts two)', () => {
    expect(damerau('laptpo', 'laptop', 2)).toBe(1);
    expect(levenshtein('laptpo', 'laptop', 2)).toBe(2);
    expect(damerau('laptop', 'tractor', 2)).toBeGreaterThan(2);
  });
  it('suggests the nearest real words, most common first, and leaves known words alone', () => {
    expect(nearestWords('laptpo', words)[0]).toBe('laptop');
    expect(nearestWords('samsng', words)).toEqual(['samsung']);
    expect(nearestWords('samsung', words)).toEqual([]);
    expect(nearestWords('xyzqw', words)).toEqual([]);
    expect(nearestWords('s23', words)).toEqual([]);
  });
});

describe('scoring refinements', () => {
  const base = { createdAt: new Date(), views: 0, tags: [] as string[] };
  it('a focused title outranks a long one that merely contains the words', () => {
    const p = parseSearchQuery('iphone 14');
    const focused = scoreListing({ ...base, title: 'iPhone 14 Pro' }, p);
    const stuffed = scoreListing({ ...base, title: 'Brand new sealed boxed original iPhone 14 with free charger and case' }, p);
    expect(focused).toBeGreaterThan(stuffed);
  });
  it('typo-guess variants rank below the typed word', () => {
    const exactP = parseSearchQuery('laptop');
    const fuzzyP = { ...parseSearchQuery('laptpo'), variants: new Map([['laptpo', ['laptpo', 'laptop']]]), fuzzy: new Set(['laptop']) };
    const l = { ...base, title: 'Dell laptop' };
    expect(scoreListing(l, exactP)).toBeGreaterThan(scoreListing(l, fuzzyP));
  });
  it('idfWeight is neutral until the vocabulary has loaded', () => {
    expect(idfWeight('anything')).toBe(1);
  });
});

describe('numbers glued to letters in titles', () => {
  const L = (title: string) => ({ title, createdAt: new Date() }) as Parameters<typeof coreMatchesAll>[0];
  it('"iphone 14" matches a title written "iPhone14" but not "iPhone 140"', () => {
    const p = parseSearchQuery('iphone 14');
    expect(coreMatchesAll(L('iPhone14 Pro'), p)).toBe(true);
    expect(coreMatchesAll(L('iPhone 140 clone'), p)).toBe(false);
  });
});
