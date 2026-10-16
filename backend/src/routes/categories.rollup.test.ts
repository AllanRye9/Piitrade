import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Pure unit test: Prisma is mocked, no database. Exercises GET /rollup-counts,
// which feeds the item counts shown next to the home page category icons.

const prismaMock = {
  listing: { groupBy: vi.fn() },
  category: { findMany: vi.fn() },
  jobPost: { count: vi.fn() },
};
vi.mock('../utils/prisma', () => ({ prisma: prismaMock }));

// root 'motors' > 'used-cars' > 'toyota' ; root 'property' ; root 'jobs'
const CATEGORIES = [
  { id: 'c-motors', slug: 'motors', parentId: null },
  { id: 'c-used', slug: 'used-cars', parentId: 'c-motors' },
  { id: 'c-toyota', slug: 'toyota', parentId: 'c-used' },
  { id: 'c-property', slug: 'property', parentId: null },
  { id: 'c-jobs', slug: 'jobs', parentId: null },
];

let server: Server;

async function startApp(): Promise<string> {
  vi.resetModules(); // fresh module-level cache per test
  const { default: router } = await import('./categories');
  const app = express();
  app.use('/api/categories', router);
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/categories`;
}

beforeEach(() => {
  prismaMock.listing.groupBy.mockReset();
  prismaMock.category.findMany.mockReset().mockResolvedValue(CATEGORIES);
  prismaMock.jobPost.count.mockReset().mockResolvedValue(0);
});
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  vi.restoreAllMocks();
});

describe('GET /api/categories/rollup-counts', () => {
  it('rolls listing counts up through every ancestor and totals all listings', async () => {
    prismaMock.listing.groupBy.mockResolvedValue([
      { categoryId: 'c-toyota', _count: { _all: 5 } },
      { categoryId: 'c-used', _count: { _all: 3 } },
      { categoryId: 'c-property', _count: { _all: 7 } },
    ]);
    const base = await startApp();
    const body = await (await fetch(`${base}/rollup-counts`)).json();
    expect(body.counts).toEqual({
      toyota: 5,
      'used-cars': 8, // 5 (toyota) + 3 direct
      motors: 8, // rolled up to the root
      property: 7,
    });
    expect(body.total).toBe(15);
    expect(body.counts['jobs']).toBeUndefined(); // empty categories have no key
  });

  it('uses open JobPost rows for "jobs" (override, not add) and drops it when there are none', async () => {
    prismaMock.listing.groupBy.mockResolvedValue([{ categoryId: 'c-jobs', _count: { _all: 4 } }]);
    prismaMock.jobPost.count.mockResolvedValue(12);
    let base = await startApp();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.jobs).toBe(12);
    await new Promise<void>((r) => server.close(() => r()));

    prismaMock.jobPost.count.mockResolvedValue(0);
    base = await startApp();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.jobs).toBeUndefined();
  });

  it('scopes to a supported country and ignores an unsupported one', async () => {
    prismaMock.listing.groupBy.mockResolvedValue([]);
    const base = await startApp();
    await fetch(`${base}/rollup-counts?country=UGANDA`);
    expect(prismaMock.listing.groupBy.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', country: 'UGANDA' });
    expect(prismaMock.jobPost.count.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', country: 'UGANDA' });

    await fetch(`${base}/rollup-counts?country=ATLANTIS`);
    expect(prismaMock.listing.groupBy.mock.calls[1][0].where).toEqual({ status: 'ACTIVE' });
  });

  it('serves repeat requests from a 30s cache without re-querying', async () => {
    prismaMock.listing.groupBy.mockResolvedValue([{ categoryId: 'c-property', _count: { _all: 2 } }]);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const base = await startApp();
    const a = await (await fetch(`${base}/rollup-counts?country=UGANDA`)).json();
    now.mockReturnValue(1_000_000 + 29_000);
    const b = await (await fetch(`${base}/rollup-counts?country=UGANDA`)).json();
    expect(b).toEqual(a);
    expect(prismaMock.listing.groupBy).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 31_000); // expired
    await fetch(`${base}/rollup-counts?country=UGANDA`);
    expect(prismaMock.listing.groupBy).toHaveBeenCalledTimes(2);
  });

  it('terminates on a corrupt category cycle instead of looping forever', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'a', slug: 'a', parentId: 'b' },
      { id: 'b', slug: 'b', parentId: 'a' },
    ]);
    prismaMock.listing.groupBy.mockResolvedValue([{ categoryId: 'a', _count: { _all: 1 } }]);
    const base = await startApp();
    const body = await (await fetch(`${base}/rollup-counts`)).json();
    expect(body.counts).toEqual({ a: 1, b: 1 });
  });

  it('returns 500 via the error handler when the database fails', async () => {
    prismaMock.listing.groupBy.mockRejectedValue(new Error('db down'));
    const base = await startApp();
    const res = await fetch(`${base}/rollup-counts`);
    expect(res.status).toBe(500);
  });
});
