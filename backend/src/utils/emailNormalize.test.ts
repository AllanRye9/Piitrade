import { describe, it, expect } from 'vitest';
import { normalizeEmailInput, legacyEmailVariants, emailLookupCandidates } from './emailNormalize';

describe('normalizeEmailInput', () => {
  it('trims and lower-cases but never rewrites the local part', () => {
    expect(normalizeEmailInput('  John.Doe+Shop@Gmail.com ')).toBe('john.doe+shop@gmail.com');
  });
  it('returns empty string for non-strings', () => {
    expect(normalizeEmailInput(undefined)).toBe('');
    expect(normalizeEmailInput({ $ne: '' })).toBe('');
  });
});

describe('legacyEmailVariants', () => {
  it('reproduces the old gmail dot/+tag stripping so legacy accounts can still log in', () => {
    expect(legacyEmailVariants('john.doe@gmail.com')).toEqual(['johndoe@gmail.com']);
    expect(legacyEmailVariants('johndoe+shop@gmail.com')).toEqual(['johndoe@gmail.com']);
    expect(legacyEmailVariants('j.d@googlemail.com')).toEqual(['jd@gmail.com']);
  });
  it('handles other providers the old normalizer touched', () => {
    expect(legacyEmailVariants('a+b@outlook.com')).toEqual(['a@outlook.com']);
    expect(legacyEmailVariants('a-b@yahoo.com')).toEqual(['a@yahoo.com']);
  });
  it('returns nothing when there is no distinct legacy form', () => {
    expect(legacyEmailVariants('johndoe@gmail.com')).toEqual([]);
    expect(legacyEmailVariants('someone@company.co.ug')).toEqual([]);
    expect(legacyEmailVariants('not-an-email')).toEqual([]);
  });
});

describe('emailLookupCandidates', () => {
  it('lists the exact address first', () => {
    expect(emailLookupCandidates('john.doe@gmail.com')).toEqual(['john.doe@gmail.com', 'johndoe@gmail.com']);
  });
});
