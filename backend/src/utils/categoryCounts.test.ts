import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));
import { rollUp, CategoryRow } from './categoryCounts';

// motors > used-cars > toyota ; property ; jobs
const cats: CategoryRow[] = [
  { id: 'm', slug: 'motors', parentId: null },
  { id: 'u', slug: 'used-cars', parentId: 'm' },
  { id: 't', slug: 'toyota', parentId: 'u' },
  { id: 'p', slug: 'property', parentId: null },
  { id: 'j', slug: 'jobs', parentId: null },
];

describe('rollUp', () => {
  it('credits a listing to its category and every ancestor, tracking direct counts separately', () => {
    const r = rollUp([{ categoryId: 't', direct: 3, recent: 1 }, { categoryId: 'u', direct: 2, recent: 0 }], cats, 0);
    expect(r.counts).toEqual({ toyota: 3, 'used-cars': 5, motors: 5 });
    expect(r.direct).toEqual({ toyota: 3, 'used-cars': 2 });
    expect(r.new24h).toEqual({ toyota: 1, 'used-cars': 1, motors: 1 });
    expect(r.total).toBe(5);
  });
  it('omits empty categories entirely (missing key means zero)', () => {
    const r = rollUp([{ categoryId: 'p', direct: 4, recent: 0 }], cats, 0);
    expect(r.counts).toEqual({ property: 4 });
    expect(r.new24h).toEqual({});
  });
  it('uses open job posts for "jobs", overriding any listings in that category', () => {
    expect(rollUp([{ categoryId: 'j', direct: 9, recent: 0 }], cats, 2).counts.jobs).toBe(2);
    expect(rollUp([{ categoryId: 'j', direct: 9, recent: 0 }], cats, 0).counts.jobs).toBeUndefined();
  });
  it('ignores listings pointing at an unknown category and survives a parent cycle', () => {
    expect(rollUp([{ categoryId: 'ghost', direct: 5, recent: 0 }], cats, 0).total).toBe(0);
    const cyc: CategoryRow[] = [{ id: 'a', slug: 'a', parentId: 'b' }, { id: 'b', slug: 'b', parentId: 'a' }];
    expect(rollUp([{ categoryId: 'a', direct: 1, recent: 0 }], cyc, 0).counts).toEqual({ a: 1, b: 1 });
  });
});
