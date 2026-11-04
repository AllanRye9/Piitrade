import { describe, expect, it } from 'vitest';
import { generateWipeCode, hashWipeCode, isWipeScope, maskEmail, verifyWipeCode } from './adminWipe';

describe('adminWipe helpers', () => {
  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 200; i++) expect(generateWipeCode()).toMatch(/^\d{6}$/);
  });

  it('verifies only the matching code', async () => {
    const hash = await hashWipeCode('012345');
    expect(await verifyWipeCode('012345', hash)).toBe(true);
    expect(await verifyWipeCode('012346', hash)).toBe(false);
    expect(await verifyWipeCode('12345', hash)).toBe(false);
    expect(await verifyWipeCode('abcdef', hash)).toBe(false);
  });

  it('validates scopes', () => {
    expect(isWipeScope('ALL')).toBe(true);
    expect(isWipeScope('USERS')).toBe(false);
    expect(isWipeScope(undefined)).toBe(false);
  });

  it('masks emails', () => {
    expect(maskEmail('ditcoin999@gmail.com')).toBe('di********@gmail.com');
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
    expect(maskEmail('nope')).toBe('***');
  });
});
