import { describe, it, expect } from 'vitest';
import {
  deriveDeliveryCode, normalizeSuppliedCode, verifyDeliveryCode, resolveDeliveryCodeSecret, DELIVERY_CODE_LENGTH,
} from './deliveryCode';

const S = 'test-secret-0123456789abcdef';

describe('deriveDeliveryCode', () => {
  it('is 6 digits and deterministic per order+secret', () => {
    const c = deriveDeliveryCode('order-1', S);
    expect(c).toMatch(/^\d{6}$/);
    expect(deriveDeliveryCode('order-1', S)).toBe(c);
  });
  it('differs between orders and between secrets', () => {
    expect(deriveDeliveryCode('order-1', S)).not.toBe(deriveDeliveryCode('order-2', S));
    expect(deriveDeliveryCode('order-1', S)).not.toBe(deriveDeliveryCode('order-1', S + 'x'));
  });
  it('keeps leading zeros (always full length)', () => {
    const lens = new Set<number>();
    for (let i = 0; i < 2000; i++) lens.add(deriveDeliveryCode('o' + i, S).length);
    expect([...lens]).toEqual([DELIVERY_CODE_LENGTH]);
  });
  it('spreads roughly evenly (no obvious bias in the first digit)', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) counts[Number(deriveDeliveryCode('o' + i, S)[0])]++;
    for (const n of counts) expect(n).toBeGreaterThan(1700); // expect ~2000 each
  });
  it('refuses a missing or short secret and an empty order id', () => {
    expect(() => deriveDeliveryCode('o', '')).toThrow();
    expect(() => deriveDeliveryCode('o', 'short')).toThrow();
    expect(() => deriveDeliveryCode('', S)).toThrow();
  });
});

describe('normalizeSuppliedCode', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeSuppliedCode(' 123 456 ')).toBe('123456');
    expect(normalizeSuppliedCode('123-456')).toBe('123456');
    expect(normalizeSuppliedCode(123456)).toBe('123456');
  });
  it('rejects anything that cannot be a code', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12a456', null, undefined, {}, [], 12.5]) {
      expect(normalizeSuppliedCode(bad)).toBeNull();
    }
  });
});

describe('verifyDeliveryCode', () => {
  it('accepts the right code only', () => {
    const c = deriveDeliveryCode('o1', S);
    expect(verifyDeliveryCode('o1', c, S)).toBe(true);
    const wrong = c === '000000' ? '000001' : '000000';
    expect(verifyDeliveryCode('o1', wrong, S)).toBe(false);
    expect(verifyDeliveryCode('o2', c, S)).toBe(false);
  });
  it('does not throw on a wrong-length input', () => {
    expect(verifyDeliveryCode('o1', '123', S)).toBe(false);
  });
});

describe('resolveDeliveryCodeSecret', () => {
  it('prefers DELIVERY_CODE_SECRET, falls back to JWT_SECRET', () => {
    expect(resolveDeliveryCodeSecret({ DELIVERY_CODE_SECRET: 'a'.repeat(20), JWT_SECRET: 'b'.repeat(20) } as any)).toBe('a'.repeat(20));
    expect(resolveDeliveryCodeSecret({ JWT_SECRET: 'b'.repeat(20) } as any)).toBe('b'.repeat(20));
  });
  it('has NO default: missing or too-short secrets resolve to null', () => {
    expect(resolveDeliveryCodeSecret({} as any)).toBeNull();
    expect(resolveDeliveryCodeSecret({ JWT_SECRET: 'tiny' } as any)).toBeNull();
  });
});
