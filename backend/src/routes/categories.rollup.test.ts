import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Pure unit test: Prisma is mocked, no database. Exercises GET /rollup-counts,
// which feeds the item counts shown next to the home page category icons.

const prismaMock = {
  $queryRaw: vi.fn(),
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
  prismaMock.$queryRaw.mockReset();
  prismaMock.category.findMany.mockReset().mockResolvedValue(CATEGORIES);
  prismaMock.jobPost.count.mockReset().mockResolvedValue(0);
});
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  vi.restoreAllMocks();
});

describe('GET /api/categories/rollup-counts', () => {
  it('rolls listing counts up through every ancestor and totals all listings', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { categoryId: 'c-toyota', direct: 5, recent: 0 },
      { categoryId: 'c-used', direct: 3, recent: 0 },
      { categoryId: 'c-property', direct: 7, recent: 0 },
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
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-jobs', direct: 4, recent: 0 }]);
    prismaMock.jobPost.count.mockResolvedValue(12);
    let base = await startApp();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.jobs).toBe(12);
    await new Promise<void>((r) => server.close(() => r()));

    prismaMock.jobPost.count.mockResolvedValue(0);
    base = await startApp();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.jobs).toBeUndefined();
  });

  it('scopes to a supported country and ignores an unsupported one', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const base = await startApp();
    await fetch(`${base}/rollup-counts?country=UGANDA`);
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toContain('UGANDA'); // bound parameter, not interpolated
    expect(prismaMock.jobPost.count.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', country: 'UGANDA' });

    await fetch(`${base}/rollup-counts?country=ATLANTIS`);
    expect(prismaMock.$queryRaw.mock.calls[1][0].values).not.toContain('ATLANTIS');
    expect(prismaMock.jobPost.count.mock.calls[1][0].where).toEqual({ status: 'ACTIVE' });
  });

  it('serves repeat requests from a short cache without re-querying', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-property', direct: 2, recent: 0 }]);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const base = await startApp();
    const a = await (await fetch(`${base}/rollup-counts?country=UGANDA`)).json();
    now.mockReturnValue(1_000_000 + 4_000);
    const b = await (await fetch(`${base}/rollup-counts?country=UGANDA`)).json();
    expect(b).toEqual(a);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 6_000); // expired
    await fetch(`${base}/rollup-counts?country=UGANDA`);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('terminates on a corrupt category cycle instead of looping forever', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'a', slug: 'a', parentId: 'b' },
      { id: 'b', slug: 'b', parentId: 'a' },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'a', direct: 1, recent: 0 }]);
    const base = await startApp();
    const body = await (await fetch(`${base}/rollup-counts`)).json();
    expect(body.counts).toEqual({ a: 1, b: 1 });
  });

  it('returns 500 via the error handler when the database fails', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('db down'));
    const base = await startApp();
    const res = await fetch(`${base}/rollup-counts`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/categories/counts and invalidation', () => {
  it('returns rolled-up, direct and new-in-24h counts in one response', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-toyota', direct: 5, recent: 2 }, { categoryId: 'c-used', direct: 3, recent: 0 }]);
    const base = await startApp();
    const body = await (await fetch(`${base}/counts`)).json();
    expect(body.counts).toMatchObject({ toyota: 5, 'used-cars': 8, motors: 8 });
    expect(body.direct).toEqual({ toyota: 5, 'used-cars': 3 });
    expect(body.new24h).toEqual({ toyota: 2, 'used-cars': 2, motors: 2 });
    expect(body.total).toBe(8);
    expect(body.etag).toBeUndefined(); // an HTTP header, not part of the body
  });

  it('supports conditional requests: 304 while nothing changed, fresh body when it does', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-property', direct: 2, recent: 0 }]);
    const base = await startApp();
    const first = await fetch(`${base}/counts`);
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    expect((await fetch(`${base}/counts`, { headers: { 'If-None-Match': etag } })).status).toBe(304);

    const { invalidateCategoryCounts } = await import('../utils/categoryCounts');
    invalidateCategoryCounts();
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-property', direct: 3, recent: 0 }]);
    const changed = await fetch(`${base}/counts`, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect((await changed.json()).counts.property).toBe(3);
  });

  it('reflects a listing change immediately after invalidation, without waiting for the TTL', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-property', direct: 2, recent: 0 }]);
    const base = await startApp();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.property).toBe(2);
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-property', direct: 3, recent: 0 }]);
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.property).toBe(2); // still cached
    const { invalidateCategoryCounts } = await import('../utils/categoryCounts');
    invalidateCategoryCounts();
    expect((await (await fetch(`${base}/rollup-counts`)).json()).counts.property).toBe(3);
  });

  it('active-counts keeps its old shape: direct counts only', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ categoryId: 'c-toyota', direct: 5, recent: 0 }]);
    const base = await startApp();
    expect(await (await fetch(`${base}/active-counts`)).json()).toEqual({ counts: { toyota: 5 }, country: null });
  });

  it('shares one query between simultaneous requests', async () => {
    let release!: (v: unknown) => void;
    prismaMock.$queryRaw.mockReturnValue(new Promise((r) => { release = r; }));
    const base = await startApp();
    const calls = Promise.all([fetch(`${base}/counts`), fetch(`${base}/counts`), fetch(`${base}/counts`)]);
    await new Promise((r) => setTimeout(r, 50));
    release([{ categoryId: 'c-property', direct: 1, recent: 0 }]);
    await calls;
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
