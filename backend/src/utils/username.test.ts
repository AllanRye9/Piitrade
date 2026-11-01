import { describe, it, expect } from 'vitest';
import { normalizeUsername, validateUsername, looksLikeEmail } from './username';

describe('username', () => {
  it('normalises case and whitespace', () => { expect(normalizeUsername('  Ann.Mugisha ')).toBe('ann.mugisha'); expect(normalizeUsername(5)).toBe(''); });
  it('accepts good names', () => { for (const u of ['ann', 'ann.mugisha', 'kampala_traders-1', 'a1b']) expect(validateUsername(u), u).toBeNull(); });
  it('rejects bad names', () => {
    for (const u of ['ab', 'a'.repeat(31), '.ann', 'ann.', 'an..n', 'an n', 'ann@x', 'admin', 'piitrade', 'añn']) expect(validateUsername(u), u).not.toBeNull();
  });
  it('tells emails from usernames', () => { expect(looksLikeEmail('a@b.co')).toBe(true); expect(looksLikeEmail('ann.mugisha')).toBe(false); });
});
