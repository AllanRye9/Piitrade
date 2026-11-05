import { describe, expect, it } from 'vitest';
import { reconcile } from '@/lib/reconcile';

describe('reconcile', () => {
  it('returns the previous reference when nothing changed', () => {
    const prev = [{ id: 'a', n: 1, tags: ['x'] }, { id: 'b', n: 2, tags: [] }];
    const next = JSON.parse(JSON.stringify(prev));
    expect(reconcile(prev, next)).toBe(prev);
  });
  it('keeps unchanged items and replaces only the changed one', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
    const out = reconcile(prev, [{ id: 'a', n: 1 }, { id: 'b', n: 3 }]);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toEqual({ id: 'b', n: 3 });
  });
  it('handles removed and added items', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    expect(reconcile(prev, [{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(reconcile(prev, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toHaveLength(3);
  });
  it('handles null and primitives', () => {
    expect(reconcile(null as { a: number } | null, { a: 1 })).toEqual({ a: 1 });
    expect(reconcile({ a: 1 } as { a: number } | null, null)).toBeNull();
    expect(reconcile(1, 2)).toBe(2);
  });
});
