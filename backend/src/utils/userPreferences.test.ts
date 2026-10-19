import { describe, it, expect } from 'vitest';
import { parseListingColumns } from './userPreferences';

describe('parseListingColumns', () => {
  it('accepts 1-6 as numbers or numeric strings', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(parseListingColumns(n)).toEqual({ ok: true, value: n });
      expect(parseListingColumns(String(n))).toEqual({ ok: true, value: n });
    }
  });
  it('null / empty clears the preference', () => {
    expect(parseListingColumns(null)).toEqual({ ok: true, value: null });
    expect(parseListingColumns('')).toEqual({ ok: true, value: null });
  });
  it('rejects everything else', () => {
    for (const bad of [0, 7, -1, 4.5, '4.5', 'abc', '04x', NaN, Infinity, undefined, {}, [], [4], true, '99999', 1e9]) {
      expect(parseListingColumns(bad).ok).toBe(false);
    }
  });
});
