import { describe, it, expect } from 'vitest';
import { normalizeUserPhone, phoneLookupCandidates } from './phone';

describe('normalizeUserPhone', () => {
  it('maps every Ugandan spelling to +256XXXXXXXXX', () => {
    for (const raw of ['0772123456', '256772123456', '+256772123456', '+256 772 123 456', '772123456']) {
      expect(normalizeUserPhone(raw)).toBe('+256772123456');
    }
  });
  it('returns null for empty input and rejects junk', () => {
    expect(normalizeUserPhone('')).toBeNull();
    expect(normalizeUserPhone(undefined)).toBeNull();
    expect(() => normalizeUserPhone('abc')).toThrow();
    expect(() => normalizeUserPhone({ startsWith: '0' })).toThrow();
  });
  it('lists older spellings for duplicate checks', () => {
    expect(phoneLookupCandidates('+256772123456').sort()).toEqual(['+256772123456', '0772123456', '256772123456', '772123456'].sort());
  });
});
