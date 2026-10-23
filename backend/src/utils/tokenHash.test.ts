import { describe, it, expect } from 'vitest';
import { hashToken, tokenMatchValues } from './tokenHash';

describe('tokenHash', () => {
  it('is deterministic and never equals the raw token', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
    expect(hashToken('abc')).toHaveLength(64);
  });
  it('matches both the hash and the legacy plaintext value', () => {
    expect(tokenMatchValues('abc')).toEqual([hashToken('abc'), 'abc']);
  });
});
