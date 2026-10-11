import { describe, it, expect } from 'vitest';
import { isCheckoutEligible, normalizeMarketplaceMode, findActiveStoreOwnerIds } from './checkoutPolicy';

const base = { topCategorySlug: 'electronics', sellerIsAdmin: false, sellerHasActiveStore: false };

describe('isCheckoutEligible — HYBRID (the intended mode): web stores and Piitrade only', () => {
  it('regular seller: contact/chat only', () => {
    expect(isCheckoutEligible({ ...base, mode: 'HYBRID' })).toBe(false);
  });
  it('seller with an active web store: checkout', () => {
    expect(isCheckoutEligible({ ...base, mode: 'HYBRID', sellerHasActiveStore: true })).toBe(true);
  });
  it('admin (Piitrade) listing: checkout', () => {
    expect(isCheckoutEligible({ ...base, mode: 'HYBRID', sellerIsAdmin: true })).toBe(true);
  });
  it('unset or unknown mode behaves as HYBRID', () => {
    for (const mode of [undefined, null, '', 'WHATEVER', 42]) {
      expect(isCheckoutEligible({ ...base, mode })).toBe(false);
      expect(isCheckoutEligible({ ...base, mode, sellerHasActiveStore: true })).toBe(true);
    }
  });
});

describe('isCheckoutEligible — other modes and categories', () => {
  it('CLASSIFIEDS: nobody, not even stores or admin', () => {
    expect(isCheckoutEligible({ ...base, mode: 'CLASSIFIEDS', sellerIsAdmin: true, sellerHasActiveStore: true })).toBe(false);
  });
  it('ECOMMERCE: every seller (explicit admin choice)', () => {
    expect(isCheckoutEligible({ ...base, mode: 'ECOMMERCE' })).toBe(true);
  });
  it('motors and property are contact-only in EVERY mode, even for stores/admin', () => {
    for (const mode of ['CLASSIFIEDS', 'ECOMMERCE', 'HYBRID']) {
      for (const topCategorySlug of ['motors', 'property']) {
        expect(isCheckoutEligible({ mode, topCategorySlug, sellerIsAdmin: true, sellerHasActiveStore: true })).toBe(false);
      }
    }
  });
  it('normalizeMarketplaceMode defaults to HYBRID', () => {
    expect(normalizeMarketplaceMode(undefined)).toBe('HYBRID');
    expect(normalizeMarketplaceMode('ECOMMERCE')).toBe('ECOMMERCE');
  });
});

describe('findActiveStoreOwnerIds', () => {
  it('asks only for ACTIVE, unexpired rentals of the given sellers (de-duplicated)', async () => {
    let seen: any;
    const now = new Date('2026-10-10T00:00:00Z');
    const db = { storeRental: { async findMany(args: any) { seen = args; return [{ userId: 'a' }]; } } };
    const ids = await findActiveStoreOwnerIds(db as any, ['a', 'b', 'a'], now);
    expect([...ids]).toEqual(['a']);
    expect(seen.where).toEqual({ userId: { in: ['a', 'b'] }, status: 'ACTIVE', endDate: { gt: now } });
  });
  it('makes no query for an empty list', async () => {
    const db = { storeRental: { async findMany() { throw new Error('should not be called'); } } };
    expect((await findActiveStoreOwnerIds(db as any, [])).size).toBe(0);
  });
});
