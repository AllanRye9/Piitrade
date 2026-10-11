import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isDenied,
  computeSettlement,
  resolveFeePercent,
  OrderActor,
} from './orderLifecycle';

const ok = (from: string, to: string, actor: OrderActor, opts = {}) => {
  const d = canTransition(from, to, actor, opts);
  return d.ok;
};
const code = (from: string, to: string, actor: OrderActor, opts = {}) => {
  const d = canTransition(from, to, actor, opts);
  return isDenied(d) ? d.code : 'OK';
};

describe('canTransition', () => {
  it('lets seller and admin move forward, including skipping steps', () => {
    for (const actor of ['SELLER', 'ADMIN'] as const) {
      expect(ok('PENDING', 'CONFIRMED', actor)).toBe(true);
      expect(ok('CONFIRMED', 'SHIPPED', actor)).toBe(true);
      expect(ok('CONFIRMED', 'DELIVERED', actor)).toBe(true);
    }
  });

  it('treats re-sending the current status as a no-op, not an error', () => {
    const d = canTransition('DELIVERED', 'DELIVERED', 'SELLER');
    expect(d).toEqual({ ok: true, noop: true });
  });

  it('REGRESSION B2: nothing can leave DELIVERED except an admin refund', () => {
    expect(code('DELIVERED', 'CANCELLED', 'BUYER')).toBe('ILLEGAL');
    expect(code('DELIVERED', 'CANCELLED', 'SELLER')).toBe('ILLEGAL');
    expect(code('DELIVERED', 'SHIPPED', 'ADMIN')).toBe('ILLEGAL');
    expect(code('DELIVERED', 'REFUNDED', 'SELLER')).toBe('FORBIDDEN');
    expect(code('DELIVERED', 'REFUNDED', 'ADMIN')).toBe('OK');
  });

  it('terminal states never change', () => {
    for (const to of ['PENDING', 'SHIPPED', 'DELIVERED']) {
      expect(code('CANCELLED', to, 'ADMIN')).toBe('ILLEGAL');
      expect(code('REFUNDED', to, 'ADMIN')).toBe('ILLEGAL');
    }
  });

  it('buyers may only cancel, and only before processing', () => {
    expect(ok('PENDING', 'CANCELLED', 'BUYER')).toBe(true);
    expect(ok('CONFIRMED', 'CANCELLED', 'BUYER')).toBe(true);
    expect(code('PROCESSING', 'CANCELLED', 'BUYER')).toBe('FORBIDDEN');
    expect(code('SHIPPED', 'CANCELLED', 'BUYER')).toBe('FORBIDDEN');
    expect(code('PENDING', 'DELIVERED', 'BUYER')).toBe('FORBIDDEN');
    expect(code('PENDING', 'CONFIRMED', 'BUYER')).toBe('FORBIDDEN');
  });

  it('a buyer may confirm receipt of a SHIPPED order, and nothing else forward', () => {
    expect(code('SHIPPED', 'DELIVERED', 'BUYER')).toBe('OK');
    expect(code('PROCESSING', 'DELIVERED', 'BUYER')).toBe('FORBIDDEN');
    expect(code('SHIPPED', 'PROCESSING', 'BUYER')).toBe('FORBIDDEN');
    expect(code('SHIPPED', 'REFUNDED', 'BUYER')).toBe('ILLEGAL');
  });

  it('only admin can cancel a shipped order', () => {
    expect(code('SHIPPED', 'CANCELLED', 'SELLER')).toBe('FORBIDDEN');
    expect(code('SHIPPED', 'CANCELLED', 'ADMIN')).toBe('OK');
  });

  it('sellers cannot move backwards; admins can correct before delivery', () => {
    expect(code('SHIPPED', 'PROCESSING', 'SELLER')).toBe('ILLEGAL');
    expect(code('SHIPPED', 'PROCESSING', 'ADMIN')).toBe('OK');
  });

  it('only a delivered order can be refunded', () => {
    expect(code('SHIPPED', 'REFUNDED', 'ADMIN')).toBe('ILLEGAL');
  });

  it('can restrict DELIVERED to admins via sellerCanMarkDelivered=false', () => {
    expect(code('SHIPPED', 'DELIVERED', 'SELLER', { sellerCanMarkDelivered: false })).toBe('FORBIDDEN');
    expect(code('SHIPPED', 'DELIVERED', 'ADMIN', { sellerCanMarkDelivered: false })).toBe('OK');
    // default preserves current behaviour
    expect(code('SHIPPED', 'DELIVERED', 'SELLER')).toBe('OK');
  });

  it('rejects unknown statuses', () => {
    expect(code('PENDING', 'TELEPORTED', 'ADMIN')).toBe('UNKNOWN_STATUS');
    expect(code('LOST', 'SHIPPED', 'ADMIN')).toBe('UNKNOWN_STATUS');
    expect(code('PENDING', undefined as unknown as string, 'ADMIN')).toBe('UNKNOWN_STATUS');
  });
});

describe('resolveFeePercent', () => {
  it('accepts numbers and numeric strings in range', () => {
    expect(resolveFeePercent(10)).toBe(10);
    expect(resolveFeePercent('12.5')).toBe(12.5);
    expect(resolveFeePercent(0)).toBe(0);
    expect(resolveFeePercent(100)).toBe(100);
  });
  it('falls back to 0 (no fee) for anything invalid', () => {
    for (const bad of [-1, 101, 'abc', '', NaN, Infinity, null, undefined, {}, [], true]) {
      expect(resolveFeePercent(bad)).toBe(0);
    }
  });
});

describe('computeSettlement', () => {
  it('splits total minus shipping into fee and payout', () => {
    expect(computeSettlement({ total: 100000, shippingCost: 0 }, 10)).toEqual({
      base: 100000, platformFee: 10000, sellerPayout: 90000,
    });
    expect(computeSettlement({ total: 100000, shippingCost: 5000 }, 10)).toEqual({
      base: 95000, platformFee: 9500, sellerPayout: 85500,
    });
  });
  it('with no fee the seller gets the same amount the old code credited', () => {
    const s = computeSettlement({ total: 80000, shippingCost: 2000 }, 0);
    expect(s.sellerPayout).toBe(78000);
    expect(s.platformFee).toBe(0);
  });
  it('rounds to 2 decimals and fee + payout always equals base', () => {
    const s = computeSettlement({ total: 100.01, shippingCost: 0 }, 33.333);
    expect(s.platformFee + s.sellerPayout).toBeCloseTo(s.base, 2);
    expect(Math.round(s.platformFee * 100) / 100).toBe(s.platformFee);
    expect(Math.round(s.sellerPayout * 100) / 100).toBe(s.sellerPayout);
  });
  it('never goes negative', () => {
    expect(computeSettlement({ total: 10, shippingCost: 50 }, 10)).toEqual({
      base: 0, platformFee: 0, sellerPayout: 0,
    });
    expect(computeSettlement({ total: 100, shippingCost: 0 }, 100).sellerPayout).toBe(0);
  });
  it('ignores an invalid fee percent', () => {
    expect(computeSettlement({ total: 100, shippingCost: 0 }, 500).platformFee).toBe(0);
  });
});
