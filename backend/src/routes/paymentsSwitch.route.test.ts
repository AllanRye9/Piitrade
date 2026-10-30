/**
 * HTTP-level test of the admin MoMo switch routes (GET /admin/status, PUT /admin/switch) and the public
 * GET /config, against the REAL router. Only the database, auth identity and unrelated services are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('@prisma/client', () => ({ PaymentPurpose: {}, Prisma: {} }));
vi.mock('../utils/prisma', () => ({ prisma: { siteConfig: { findUnique: db.findUnique, upsert: db.upsert } } }));
vi.mock('../utils/adminAudit', () => ({ recordAdminAudit: vi.fn(async () => undefined) }));
vi.mock('../utils/momo/paymentService', () => ({}));
vi.mock('../utils/momo/receipt', () => ({}));
// Identity comes from a header; authorize() keeps the real rule (role must be listed).
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role'];
    if (!role) return res.status(401).json({ message: 'Authentication required' });
    req.user = { userId: 'u1', role };
    next();
  },
  optionalAuthenticate: (_req: any, _res: any, next: any) => next(),
  authorize: (...roles: string[]) => (req: any, res: any, next: any) =>
    (!req.user || !roles.includes(req.user.role)) ? res.status(403).json({ message: 'Insufficient permissions' }) : next(),
}));

import router from './payments';
import { errorHandler } from '../middleware/errorHandler';
import { setMomoAdminSwitch } from '../utils/momo/config';

const GOOD_ENV = {
  MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox', MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef', MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab', API_BASE_URL: 'https://api.piitrade.test', MTN_CALLBACK_SECRET: 'c'.repeat(40),
};
const SAVED = { ...process.env };
let server: Server; let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', router);
  app.use(errorHandler as any);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payments`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  db.findUnique.mockResolvedValue({ generalSettings: {} });
  db.upsert.mockResolvedValue({});
  setMomoAdminSwitch(null);
  for (const k of Object.keys(process.env)) if (k.startsWith('MTN_')) delete process.env[k];
});
afterEach(() => { setMomoAdminSwitch(null); process.env = { ...SAVED }; });

const useEnv = (e: Record<string, string | undefined>) => Object.assign(process.env, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)));
const call = (path: string, init: { method?: string; role?: string; body?: unknown } = {}) =>
  fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.role ? { 'x-test-role': init.role } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe('PUT /api/payments/admin/switch', () => {
  it('is admin-only: 401 when anonymous, 403 for a normal user — and nothing is written', async () => {
    expect((await call('/admin/switch', { method: 'PUT', body: { enabled: true } })).status).toBe(401);
    expect((await call('/admin/switch', { method: 'PUT', role: 'USER', body: { enabled: true } })).status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('400 unless enabled is a real boolean', async () => {
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }]) {
      const r = await call('/admin/switch', { method: 'PUT', role: 'ADMIN', body });
      expect(r.status).toBe(400);
    }
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('ON with complete credentials → 200, persisted, and the PUBLIC /config flips to enabled immediately', async () => {
    useEnv(GOOD_ENV); // note: no MTN_ENABLED at all
    expect((await (await call('/config')).json()).momoEnabled).toBe(false);
    const r = await call('/admin/switch', { method: 'PUT', role: 'ADMIN', body: { enabled: true } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: true, switchedOn: true, switchSource: 'admin', problems: [] });
    expect(db.upsert.mock.calls[0][0].update.generalSettings.momoEnabled).toBe(true);
    expect(await (await call('/config')).json()).toMatchObject({ momoEnabled: true, environment: 'sandbox' });
  });

  it('ON with incomplete credentials → 409 naming the variables; nothing saved; public /config stays off', async () => {
    useEnv({ ...GOOD_ENV, MTN_API_KEY: undefined });
    const r = await call('/admin/switch', { method: 'PUT', role: 'ADMIN', body: { enabled: true } });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.message).toMatch(/cannot be switched on/);
    expect(body.problems).toEqual(['MTN_API_KEY is not set']);
    expect(JSON.stringify(body)).not.toContain(GOOD_ENV.MTN_SUBSCRIPTION_KEY);
    expect(db.upsert).not.toHaveBeenCalled();
    expect((await (await call('/config')).json()).momoEnabled).toBe(false);
  });

  it('OFF → 200 and the public /config flips to disabled, even when MTN_ENABLED=true is still set on the server', async () => {
    useEnv({ ...GOOD_ENV, MTN_ENABLED: 'true' });
    expect((await (await call('/config')).json()).momoEnabled).toBe(true); // env default, switch never used
    const r = await call('/admin/switch', { method: 'PUT', role: 'ADMIN', body: { enabled: false } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: false, switchedOn: false, switchSource: 'admin' });
    expect((await (await call('/config')).json())).toMatchObject({ momoEnabled: false, environment: null });
  });
});

describe('GET /api/payments/admin/status', () => {
  it('is admin-only', async () => {
    expect((await call('/admin/status')).status).toBe(401);
    expect((await call('/admin/status', { role: 'USER' })).status).toBe(403);
  });
  it('reports the switch, who set it, and problems by name only', async () => {
    useEnv({ ...GOOD_ENV, MTN_API_USER: undefined });
    setMomoAdminSwitch(true);
    const b = await (await call('/admin/status', { role: 'ADMIN' })).json();
    expect(b).toMatchObject({ enabled: false, switchedOn: true, switchSource: 'admin', environment: 'sandbox', problems: ['MTN_API_USER is not set'] });
  });
});
