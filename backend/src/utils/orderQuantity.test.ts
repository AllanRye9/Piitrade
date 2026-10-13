import { describe, it, expect } from 'vitest';
import { parsePriceTiers, quantityProblem, sanitizeQuantityRules, unitPriceForQuantity } from './orderQuantity';

const ctx = { basePrice: 3000, stock: 1000 };

describe('sanitizeQuantityRules', () => {
  it('no input means no rules', () => {
    expect(sanitizeQuantityRules({}, ctx)).toEqual({ ok: true, minOrderQuantity: null, priceTiers: null });
    expect(sanitizeQuantityRules({ minOrderQuantity: '', priceTiers: [] }, ctx)).toEqual({ ok: true, minOrderQuantity: null, priceTiers: null });
  });
  it('accepts a MOQ and descending tiers (strings from forms are coerced)', () => {
    const r = sanitizeQuantityRules({ minOrderQuantity: '50', priceTiers: [{ minQty: '500', price: '2500' }, { minQty: 100, price: 2800 }] }, ctx);
    expect(r).toEqual({ ok: true, minOrderQuantity: 50, priceTiers: [{ minQty: 100, price: 2800 }, { minQty: 500, price: 2500 }] });
  });
  it('rejects a MOQ above the stock', () => {
    expect(sanitizeQuantityRules({ minOrderQuantity: 2000 }, ctx).ok).toBe(false);
  });
  it('rejects non-whole MOQs', () => {
    expect(sanitizeQuantityRules({ minOrderQuantity: 2.5 }, ctx).ok).toBe(false);
  });
  it('rejects tiers that are not cheaper than the base / previous tier', () => {
    expect(sanitizeQuantityRules({ priceTiers: [{ minQty: 100, price: 3000 }] }, ctx).ok).toBe(false);
    expect(sanitizeQuantityRules({ priceTiers: [{ minQty: 100, price: 2800 }, { minQty: 200, price: 2900 }] }, ctx).ok).toBe(false);
  });
  it('rejects a tier at or below the MOQ, duplicates, and too many tiers', () => {
    expect(sanitizeQuantityRules({ minOrderQuantity: 50, priceTiers: [{ minQty: 50, price: 2000 }] }, ctx).ok).toBe(false);
    expect(sanitizeQuantityRules({ priceTiers: [{ minQty: 100, price: 2800 }, { minQty: 100, price: 2700 }] }, ctx).ok).toBe(false);
    const many = [2, 3, 4, 5, 6, 7].map((q, i) => ({ minQty: q, price: 2900 - i * 10 }));
    expect(sanitizeQuantityRules({ priceTiers: many }, ctx).ok).toBe(false);
  });
});

describe('unitPriceForQuantity', () => {
  const tiers = parsePriceTiers([{ minQty: 500, price: 2500 }, { minQty: 100, price: 2800 }]);
  it('uses the base price below the first tier', () => {
    expect(unitPriceForQuantity(3000, tiers, 50)).toBe(3000);
    expect(unitPriceForQuantity(3000, tiers, 99)).toBe(3000);
  });
  it('steps down at each tier boundary', () => {
    expect(unitPriceForQuantity(3000, tiers, 100)).toBe(2800);
    expect(unitPriceForQuantity(3000, tiers, 499)).toBe(2800);
    expect(unitPriceForQuantity(3000, tiers, 500)).toBe(2500);
    expect(unitPriceForQuantity(3000, tiers, 5000)).toBe(2500);
  });
  it('parsePriceTiers ignores junk', () => {
    expect(parsePriceTiers('nope')).toEqual([]);
    expect(parsePriceTiers([{ minQty: 1, price: 5 }, { minQty: 'x' }, null])).toEqual([]);
  });
});

describe('quantityProblem', () => {
  it('enforces the MOQ', () => {
    expect(quantityProblem({ title: 'Maize', minOrderQuantity: 50 }, 49)).toMatch(/minimum order/i);
    expect(quantityProblem({ title: 'Maize', minOrderQuantity: 50 }, 50)).toBeNull();
  });
  it('listings without a MOQ only need a positive quantity', () => {
    expect(quantityProblem({ title: 'Chair', minOrderQuantity: null }, 1)).toBeNull();
    expect(quantityProblem({ title: 'Chair' }, 0)).not.toBeNull();
  });
});
