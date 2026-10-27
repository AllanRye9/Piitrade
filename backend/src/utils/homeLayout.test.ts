import { describe, it, expect } from 'vitest';
import { BUILT_IN_KEYS, normalizeHomeLayout, customKey } from './homeLayout';

describe('normalizeHomeLayout', () => {
  it('gives the default layout for nothing / junk', () => {
    for (const raw of [null, undefined, 'x', 5, [], {}]) {
      const l = normalizeHomeLayout(raw);
      expect(l.order).toEqual(BUILT_IN_KEYS);
      expect(l.collections).toEqual([]);
      expect(Object.values(l.settings).every((s) => s.enabled)).toBe(true);
    }
  });
  it('keeps a saved order, drops unknown keys and duplicates, and adds sections the save predates', () => {
    const l = normalizeHomeLayout({ order: ['featured-deal', 'nope', 'featured-deal', 'flash-deals'] });
    expect(l.order.indexOf('featured-deal')).toBeLessThan(l.order.indexOf('flash-deals'));
    expect(l.order[0]).toBe('featured-deal');
    expect(l.order.indexOf('todays-deals')).toBe(l.order.indexOf('flash-deals') + 1);
    expect(new Set(l.order).size).toBe(l.order.length);
    expect(l.order.sort()).toEqual([...BUILT_IN_KEYS].sort());
  });
  it('hides a section only when explicitly disabled', () => {
    const l = normalizeHomeLayout({ settings: { 'featured-deal': { enabled: false }, 'flash-deals': { enabled: true } } });
    expect(l.settings['featured-deal'].enabled).toBe(false);
    expect(l.settings['flash-deals'].enabled).toBe(true);
  });
  it('allows renaming only the sections that support it, and strips markup', () => {
    const l = normalizeHomeLayout({ settings: { 'featured-deal': { title: ' Hot <b>picks</b> ', subtitle: 'x' }, 'flash-deals': { title: 'Nope' } } });
    expect(l.settings['featured-deal'].title).toBe('Hot bpicks/b');
    expect(l.settings['flash-deals'].title).toBeUndefined();
  });
  it('accepts valid custom collections only, and places them', () => {
    const l = normalizeHomeLayout({
      collections: [
        { id: 'abc12345', title: 'Phones under 500k', source: { type: 'category', slug: 'smartphones' }, limit: 99 },
        { id: 'bad id!', title: 'x', source: { type: 'category', slug: 'a' } },
        { id: 'def67890', title: 'No source' },
        { id: 'ghi11111', title: 'Picked', source: { type: 'listings', ids: ['a', 'a', 'b'] } },
        { id: 'jkl22222', title: 'Flash', source: { type: 'placement', placement: 'HACK' } },
      ],
      order: [customKey('abc12345'), 'flash-deals'],
    });
    expect(l.collections.map((c) => c.id)).toEqual(['abc12345', 'ghi11111']);
    expect(l.collections[0].limit).toBe(24);
    expect(l.collections[1].source).toEqual({ type: 'listings', ids: ['a', 'b'] });
    expect(l.order[0]).toBe('custom:abc12345');
    expect(l.order).toContain('custom:ghi11111');
  });
  it('drops order entries pointing at removed collections', () => {
    expect(normalizeHomeLayout({ order: ['custom:gone1234'] }).order).not.toContain('custom:gone1234');
  });
});
