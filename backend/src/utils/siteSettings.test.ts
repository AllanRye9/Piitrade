import { describe, it, expect } from 'vitest';
import { GENERAL_DEFAULTS, normalizeGeneralSettings, normalizeSlugList } from './siteSettings';

describe('normalizeSlugList', () => {
  it('keeps valid kebab-case slugs in order, lowercased and de-duplicated', () => {
    expect(normalizeSlugList(['Motors', 'boda-boda-bikes', 'motors', ' property '])).toEqual(['motors', 'boda-boda-bikes', 'property']);
  });
  it('drops invalid entries and non-strings', () => {
    expect(normalizeSlugList(['ok', 'has space', 'UPPER_case', '', 42, null, '-bad', 'bad-', 'a--b', '<script>'])).toEqual(['ok']);
  });
  it('returns [] for non-arrays', () => {
    expect(normalizeSlugList(undefined)).toEqual([]);
    expect(normalizeSlugList('motors')).toEqual([]);
    expect(normalizeSlugList({})).toEqual([]);
  });
  it('caps the list length', () => {
    const many = Array.from({ length: 200 }, (_, i) => `cat-${i}`);
    expect(normalizeSlugList(many)).toHaveLength(60);
  });
});

describe('normalizeGeneralSettings — category layout', () => {
  it('defaults to empty lists (current behaviour unchanged)', () => {
    const s = normalizeGeneralSettings(null);
    expect(s.categoryRank).toEqual([]);
    expect(s.hiddenCategories).toEqual([]);
    expect(GENERAL_DEFAULTS.categoryRank).toEqual([]);
  });
  it('normalises stored values and leaves other settings intact', () => {
    const s = normalizeGeneralSettings({ siteName: 'X', itemsPerPage: 30, categoryRank: ['services', 'Motors', 'bad slug'], hiddenCategories: ['garden', 'garden'] });
    expect(s.categoryRank).toEqual(['services', 'motors']);
    expect(s.hiddenCategories).toEqual(['garden']);
    expect(s.siteName).toBe('X');
    expect(s.itemsPerPage).toBe(30);
  });
  it('is idempotent (admin PUT re-normalises what it reads)', () => {
    const once = normalizeGeneralSettings({ categoryRank: ['a', 'b'], hiddenCategories: ['c'] });
    expect(normalizeGeneralSettings(once as unknown as Record<string, unknown>)).toEqual(once);
  });
});
