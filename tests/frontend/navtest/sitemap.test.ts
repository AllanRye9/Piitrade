import { describe, it, expect, vi, afterEach } from 'vitest';
import sitemap from '@/app/sitemap';

const parents = [{ slug: 'motors' }, { slug: 'pets-animals' }, { slug: 'food-groceries' }, { slug: 'jobs' }, { slug: 'cv-services' }];
function mockFetch(counts: any, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('rollup-counts')) return ok ? { ok: true, json: async () => ({ counts }) } : { ok: false, json: async () => ({}) };
    if (u.includes('/api/categories')) return { ok: true, json: async () => parents };
    return { ok: true, json: async () => ({ listings: [], posts: [] }) };
  }));
}
const urls = async () => (await sitemap()).map((r) => r.url);
afterEach(() => vi.unstubAllGlobals());

describe('sitemap categories', () => {
  it('emits only live categories with real URLs, de-duplicated, plus /categories', async () => {
    mockFetch({ motors: 3, 'food-groceries': 2 });
    const u = await urls();
    expect(u.some((x) => x.endsWith('/categories'))).toBe(true);
    expect(u.filter((x) => x.endsWith('/motors'))).toHaveLength(1);       // static + category route de-duplicated
    expect(u.some((x) => x.endsWith('/category/food-groceries'))).toBe(true);
    expect(u.some((x) => x.includes('pets-animals'))).toBe(false);        // empty -> not indexed
    expect(u.some((x) => x.includes('/browse/'))).toBe(false);            // the old, non-existent route
    expect(u.some((x) => x.endsWith('/cv-services'))).toBe(true);         // ungated tree
  });
  it('emits no category routes when counts are unavailable', async () => {
    mockFetch(null, false);
    const u = await urls();
    expect(u.some((x) => x.includes('food-groceries'))).toBe(false);
    expect(u.some((x) => x.endsWith('/cv-services'))).toBe(false);
  });
});
