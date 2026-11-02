import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('admin translations over HTTP (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); (await import('./utils/translations')).invalidateTranslations(); });

  const auth = (u: { id: string; email: string }, role: string) => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}`, 'Content-Type': 'application/json' });
  const put = (headers: Record<string, string>, entries: unknown) => fetch(`${base}/api/admin/translations/bulk`, { method: 'PUT', headers, body: JSON.stringify({ entries }) });
  const pub = async (locale: string) => (await fetch(`${base}/api/public/translations?locale=${locale}`)).json();

  it('is admin-only', async () => {
    const seller = await mkUser(prisma);
    expect((await fetch(`${base}/api/admin/translations`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/translations`, { headers: auth(seller, 'BUYER') })).status).toBe(403);
    expect((await put(auth(seller, 'BUYER'), [{ key: 'a', locale: 'sw', value: 'b' }])).status).toBe(403);
  });

  it('saves, serves publicly (unicode intact), updates, and a blank value removes the override', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const h = auth(admin, 'ADMIN');
    const r1 = await (await put(h, [
      { key: 'Login', locale: 'lg', value: 'Yingira' },
      { key: 'Share this listing', locale: 'lg', value: 'Gabana ekirango kino — “ŋ” ’' },
      { key: 'Login', locale: 'sw', value: 'Ingia' },
    ])).json();
    expect(r1).toMatchObject({ saved: 3, removed: 0, rejected: 0 });

    const lg = await pub('lg');
    expect(lg.strings).toEqual({ Login: 'Yingira', 'Share this listing': 'Gabana ekirango kino — “ŋ” ’' });
    expect((await pub('sw')).strings).toEqual({ Login: 'Ingia' });
    expect((await pub('en')).strings).toEqual({});

    // update is live immediately (cache dropped on write)
    await put(h, [{ key: 'Login', locale: 'lg', value: 'Yingira nno' }]);
    expect((await pub('lg')).strings.Login).toBe('Yingira nno');
    expect(await prisma.translation.count({ where: { locale: 'lg', key: 'Login' } })).toBe(1); // upsert, not a duplicate

    // blank → override removed
    const r2 = await (await put(h, [{ key: 'Login', locale: 'lg', value: '' }])).json();
    expect(r2).toMatchObject({ saved: 0, removed: 1 });
    expect((await pub('lg')).strings.Login).toBeUndefined();

    const all = await (await fetch(`${base}/api/admin/translations`, { headers: h })).json();
    expect(all.total).toBe(2);
    expect(all.translations.sw.Login).toBe('Ingia');

    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.adminAuditLog.count({ where: { action: 'TRANSLATIONS_UPDATED', actorId: admin.id } })).toBe(3);
  });

  it('rejects bad input without storing it; one bad row does not block good ones', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const h = auth(admin, 'ADMIN');
    expect((await put(h, 'nope')).status).toBe(400);
    expect((await put(h, [{ key: 'x', locale: 'en', value: 'y' }])).status).toBe(400);
    const mixed = await (await put(h, [{ key: 'x', locale: 'en', value: 'y' }, { key: 'Sell', locale: 'sw', value: 'Uza' }])).json();
    expect(mixed).toMatchObject({ saved: 1, rejected: 1 });
    expect((await fetch(`${base}/api/public/translations?locale=NOPE!`)).status).toBe(400);
    expect((await fetch(`${base}/api/public/translations`)).status).toBe(400);
  });

  it('DELETE resets one language only, and needs the typed confirmation', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const h = auth(admin, 'ADMIN');
    await put(h, [{ key: 'A', locale: 'lg', value: '1' }, { key: 'B', locale: 'lg', value: '2' }, { key: 'A', locale: 'sw', value: '3' }]);
    expect((await fetch(`${base}/api/admin/translations?locale=lg`, { method: 'DELETE', headers: h })).status).toBe(400);
    const res = await (await fetch(`${base}/api/admin/translations?locale=lg&confirm=RESET`, { method: 'DELETE', headers: h })).json();
    expect(res.removed).toBe(2);
    expect((await pub('lg')).strings).toEqual({});
    expect((await pub('sw')).strings).toEqual({ A: '3' });
  });

  it('a backup taken now includes the new table automatically', async () => {
    const { introspect } = await import('./utils/backup/backupService');
    expect((await introspect(prisma)).tables).toContain('Translation');
  });
});
