import { describe, it, expect } from 'vitest';
import { isValidLocale, validateEntries, MAX_ENTRIES_PER_REQUEST, MAX_KEY_CHARS, MAX_VALUE_CHARS } from './translations';

describe('isValidLocale', () => {
  it('accepts language codes, never English', () => {
    for (const ok of ['lg', 'sw', 'ach', 'pt-BR']) expect(isValidLocale(ok)).toBe(true);
    for (const bad of ['en', '', 'x', 'LG', 'lg;drop', 'toolonglocale', 5, null, undefined]) expect(isValidLocale(bad)).toBe(false);
  });
});

describe('validateEntries', () => {
  it('trims, keeps blanks (they mean "remove"), and the last duplicate wins', () => {
    const { entries, errors } = validateEntries([
      { key: ' Login ', locale: 'sw', value: ' Ingia ' },
      { key: 'Login', locale: 'sw', value: 'Ingia sasa' },
      { key: 'Sell', locale: 'lg', value: '' },
    ]);
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { key: 'Login', locale: 'sw', value: 'Ingia sasa' },
      { key: 'Sell', locale: 'lg', value: '' },
    ]);
  });
  it('rejects bad rows individually and says why', () => {
    const { entries, errors } = validateEntries([
      { key: '', locale: 'sw', value: 'x' },
      { key: 'A', locale: 'en', value: 'x' },
      { key: 'B'.repeat(MAX_KEY_CHARS + 1), locale: 'sw', value: 'x' },
      { key: 'C', locale: 'sw', value: 'v'.repeat(MAX_VALUE_CHARS + 1) },
      { key: 'D', locale: 'sw', value: 'ok' },
      null,
    ]);
    expect(entries).toEqual([{ key: 'D', locale: 'sw', value: 'ok' }]);
    expect(errors).toHaveLength(5);
  });
  it('refuses non-lists and oversized batches', () => {
    expect(validateEntries('nope').errors).toHaveLength(1);
    expect(validateEntries(new Array(MAX_ENTRIES_PER_REQUEST + 1).fill({ key: 'a', locale: 'sw', value: 'b' })).entries).toEqual([]);
  });
});
