import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser } from './testing/integrationDb';

configureTestEnv();

/**
 * Primary vs secondary admins over real HTTP: a secondary admin reaches ONLY the areas the primary admin
 * granted, an admin with nothing granted reaches nothing, and the admin-management endpoints are primary-only.
 */
describe.skipIf(!TEST_DB)('admin access: primary and secondary admins (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let invalidate: (id: string) => void;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    ({ invalidateAccountStatus: invalidate } = await import('./middleware/auth'));
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); });

  const auth = (u: { id: string; email: string }) => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role: 'ADMIN' })}`, 'Content-Type': 'application/json' });
  const get = (path: string, u: { id: string; email: string }) => fetch(`${base}${path}`, { headers: auth(u) });
  const send = (method: string, path: string, u: { id: string; email: string }, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: auth(u), body: body === undefined ? undefined : JSON.stringify(body) });

  it('the primary admin can use every area, including primary-only ones', async () => {
    const primary = await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    expect((await get('/api/admin/stats', primary)).status).toBe(200);
    expect((await get('/api/admin/translations', primary)).status).toBe(200);
    expect((await get('/api/admin/backup/info', primary)).status).toBe(200);
    expect((await get('/api/admin/admins', primary)).status).toBe(200);
    const me = await (await get('/api/admin/me', primary)).json();
    expect(me.isPrimaryAdmin).toBe(true);
  });

  it('a secondary admin with nothing granted can sign in but reach no area (only /me)', async () => {
    await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    const nobody = await mkUser(prisma, { role: 'ADMIN', adminPermissions: [] });
    for (const p of ['/api/admin/stats', '/api/admin/listings', '/api/admin/users', '/api/admin/translations', '/api/admin/packages']) {
      expect((await get(p, nobody)).status, p).toBe(403);
    }
    const me = await get('/api/admin/me', nobody);
    expect(me.status).toBe(200);
    expect((await me.json()).permissions).toEqual([]);
  });

  it('a secondary admin reaches exactly the granted areas and nothing else', async () => {
    await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    const mod = await mkUser(prisma, { role: 'ADMIN', adminPermissions: ['listings'] });
    expect((await get('/api/admin/listings', mod)).status).toBe(200);
    expect((await get('/api/admin/reports', mod)).status).toBe(200); // reports belong to "listings"
    expect((await get('/api/admin/users', mod)).status).toBe(403);
    expect((await get('/api/admin/translations', mod)).status).toBe(403);
    expect((await get('/api/admin/transactions', mod)).status).toBe(403);
  });

  it('primary-only endpoints refuse every secondary admin, even one granted every area', async () => {
    await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    const full = await mkUser(prisma, { role: 'ADMIN' }); // helper default: every area granted
    expect((await get('/api/admin/backup/info', full)).status).toBe(403);
    expect((await get('/api/admin/admins', full)).status).toBe(403);
    expect((await send('PUT', `/api/admin/admins/${full.id}/permissions`, full, { permissions: ['listings'] })).status).toBe(403);
    expect((await send('POST', `/api/admin/admins/${full.id}/make-primary`, full)).status).toBe(403);
  });

  it('the primary admin changes a secondary admin\'s access and it applies on the next request', async () => {
    const primary = await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    const sec = await mkUser(prisma, { role: 'ADMIN', adminPermissions: ['listings'] });
    expect((await get('/api/admin/users', sec)).status).toBe(403);

    const res = await send('PUT', `/api/admin/admins/${sec.id}/permissions`, primary, { permissions: ['users', 'listings'] });
    expect(res.status).toBe(200);
    invalidate(sec.id); // same-process cache; other instances pick it up within seconds
    expect((await get('/api/admin/users', sec)).status).toBe(200);

    expect((await send('PUT', `/api/admin/admins/${sec.id}/permissions`, primary, { permissions: ['listings'] })).status).toBe(200);
    invalidate(sec.id);
    expect((await get('/api/admin/users', sec)).status).toBe(403);

    expect((await send('PUT', `/api/admin/admins/${sec.id}/permissions`, primary, { permissions: ['nope'] })).status).toBe(400);
    const audit = await prisma.adminAuditLog.findMany({ where: { action: 'ADMIN_PERMISSIONS_CHANGE', targetId: sec.id } });
    expect(audit).toHaveLength(2);
  });

  it('there can only be one primary admin, and the primary role can be handed over', async () => {
    const a = await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true });
    await expect(mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true })).rejects.toBeTruthy(); // partial unique index

    const b = await mkUser(prisma, { role: 'ADMIN' });
    expect((await send('POST', `/api/admin/admins/${b.id}/make-primary`, a)).status).toBe(200);
    invalidate(a.id); invalidate(b.id);
    expect((await get('/api/admin/backup/info', b)).status).toBe(200);
    expect((await get('/api/admin/backup/info', a)).status).toBe(403); // the old primary is now secondary
    expect(await prisma.user.count({ where: { isPrimaryAdmin: true } })).toBe(1);
  });
});
