import { describe, it, expect } from 'vitest';
import { planTableOrder, type FkEdge } from './plan';

const nullableAll = () => true;

describe('planTableOrder', () => {
  it('puts parents before children and is deterministic', () => {
    const fks: FkEdge[] = [
      { child: 'Listing', parent: 'User', columns: ['userId'] },
      { child: 'Listing', parent: 'Category', columns: ['categoryId'] },
      { child: 'Favorite', parent: 'Listing', columns: ['listingId'] },
      { child: 'Favorite', parent: 'User', columns: ['userId'] },
    ];
    const { order, deferred } = planTableOrder(['Favorite', 'Listing', 'User', 'Category'], fks, () => false);
    expect(order).toEqual(['Category', 'User', 'Listing', 'Favorite']);
    expect(deferred).toEqual({});
    expect(planTableOrder(['User', 'Category', 'Listing', 'Favorite'], fks, () => false).order).toEqual(order);
  });

  it('defers a nullable self-reference (Category.parentId) instead of looping forever', () => {
    const { order, deferred } = planTableOrder(['Category'], [{ child: 'Category', parent: 'Category', columns: ['parentId'] }], nullableAll);
    expect(order).toEqual(['Category']);
    expect(deferred).toEqual({ Category: ['parentId'] });
  });

  it('refuses a required self-reference: no row could ever be inserted first', () => {
    expect(() => planTableOrder(['T'], [{ child: 'T', parent: 'T', columns: ['p'] }], () => false)).toThrow(/self-reference/);
  });

  it('breaks a two-table loop by deferring a nullable key', () => {
    const fks: FkEdge[] = [
      { child: 'A', parent: 'B', columns: ['bId'] },
      { child: 'B', parent: 'A', columns: ['aId'] },
    ];
    const { order, deferred } = planTableOrder(['A', 'B'], fks, (t, c) => !(t === 'B' && c === 'aId'));
    // B.aId is required, so the loop must be broken at A.bId: A loads first with bId = NULL (patched
    // after B exists), then B, whose required aId can point at the already-loaded A rows.
    expect(deferred).toEqual({ A: ['bId'] });
    expect(order).toEqual(['A', 'B']);
  });

  it('fails clearly when a loop has only required keys', () => {
    const fks: FkEdge[] = [
      { child: 'A', parent: 'B', columns: ['bId'] },
      { child: 'B', parent: 'A', columns: ['aId'] },
    ];
    expect(() => planTableOrder(['A', 'B'], fks, () => false)).toThrow(/circular/);
  });

  it('ignores foreign keys to tables outside the list', () => {
    expect(planTableOrder(['A'], [{ child: 'A', parent: 'Elsewhere', columns: ['x'] }], () => false).order).toEqual(['A']);
  });
});
