/**
 * HTTP-level tests for the Special Offers admin endpoints. Prisma is replaced
 * by an in-memory single-row SiteConfig so the real admin router code runs
 * unchanged. Pins the contract that the admin form must show exactly what the
 * public site resolves (see utils/offers.ts → resolveSpecialOffers).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const row: { current: Record<string, unknown> } = { current: {} };

vi.mock('../utils/prisma', () => ({
  prisma: {
    siteConfig: {
      upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (!row.current.id) row.current = { id: where.id, specialOffers: null, generalSettings: null, ...create };
        else row.current = { ...row.current, ...update };
        return row.current;
      }),
    },
  },
}));
vi.mock('../middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  authorize: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import { resolveSpecialOffers } from '../utils/offers';
import { errorHandler } from '../middleware/errorHandler';

let server: Server;
let base = '';

beforeAll(async () => {
  const { default: adminRouter } = await import('./admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  await new Promise<void>((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/site-config/special-offers`;
});
afterAll(() => { server.close(); });
beforeEach(() => { row.current = {}; });

const get = async () => (await fetch(base)).json() as Promise<Record<string, unknown>>;
const put = async (body: unknown) => fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('admin Special Offers matches what the public site resolves', () => {
  it('a never-saved config is ON in the admin form, same as the storefront', async () => {
    const adminView = await get();
    expect(adminView.enabled).toBe(true);
    expect(adminView.enabled).toBe(resolveSpecialOffers(row.current as never).enabled);
    expect(adminView.minDiscountPercent).toBe(30);
  });

  it('honours the legacy general-settings flag exactly like the public resolver', async () => {
    row.current = { id: 'x', specialOffers: null, generalSettings: { specialFindsEnabled: false } };
    const adminView = await get();
    expect(adminView.enabled).toBe(false);
    expect(adminView.enabled).toBe(resolveSpecialOffers(row.current as never).enabled);
  });

  it('saving ONLY the threshold on a never-saved config does not silently switch the section off', async () => {
    const res = await put({ minDiscountPercent: 50 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    expect(body.minDiscountPercent).toBe(50);
    expect((row.current.specialOffers as Record<string, unknown>).enabled).toBe(true);
    expect(resolveSpecialOffers(row.current as never).enabled).toBe(true);
  });

  it('an explicit OFF is stored and read back as OFF in both views', async () => {
    const res = await put({ enabled: false, minDiscountPercent: 30, startAt: null, endAt: null });
    expect(res.status).toBe(200);
    expect((await get()).enabled).toBe(false);
    expect(resolveSpecialOffers(row.current as never).enabled).toBe(false);
  });

  it('keeps rejecting invalid input with 400 and does not write', async () => {
    for (const bad of [{ minDiscountPercent: 0 }, { minDiscountPercent: 96 }, { enabled: 'yes' }, { startAt: '2030-01-02', endAt: '2030-01-01' }]) {
      const res = await put(bad);
      expect(res.status).toBe(400);
    }
    expect(row.current.specialOffers ?? null).toBeNull();
  });
});
