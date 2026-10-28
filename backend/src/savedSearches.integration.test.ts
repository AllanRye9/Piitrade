import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing } from './testing/integrationDb';
import { MAX_SAVED_SEARCHES_PER_USER } from './utils/savedSearches';

configureTestEnv();

describe.skipIf(!TEST_DB)('saved searches / alert rules (real database)', () => {
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
  beforeEach(async () => { await resetDb(prisma); });

  const auth = (u: { id: string; email: string }) => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role: 'BUYER' })}`, 'Content-Type': 'application/json' });
  const call = async (method: string, path: string, u?: { id: string; email: string }, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: u ? auth(u) : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  it('requires login, rejects empty searches, de-duplicates and enforces the per-user cap', async () => {
    const u = await mkUser(prisma);
    expect((await call('GET', '/api/saved-searches')).status).toBe(401);
    expect((await call('POST', '/api/saved-searches', u, { params: {} })).status).toBe(400);
    const first = await call('POST', '/api/saved-searches', u, { params: { q: 'toyota', evil: { $ne: 1 } } });
    expect(first.status).toBe(201);
    const dup = await call('POST', '/api/saved-searches', u, { params: { q: 'toyota' } });
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);
    for (let i = 1; i < MAX_SAVED_SEARCHES_PER_USER; i++) expect((await call('POST', '/api/saved-searches', u, { params: { q: `item${i}` } })).status).toBe(201);
    expect((await call('POST', '/api/saved-searches', u, { params: { q: 'one-too-many' } })).status).toBe(400);
  });

  it("never lets one user read or change another user's alerts", async () => {
    const a = await mkUser(prisma); const b = await mkUser(prisma);
    const { body } = await call('POST', '/api/saved-searches', a, { params: { q: 'iphone' } });
    expect((await call('GET', '/api/saved-searches', b)).body.searches).toHaveLength(0);
    expect((await call('PATCH', `/api/saved-searches/${body.id}`, b, { notify: false })).status).toBe(404);
    expect((await call('DELETE', `/api/saved-searches/${body.id}`, b)).status).toBe(404);
    expect((await call('DELETE', `/api/saved-searches/${body.id}`, a)).status).toBe(200);
  });

  it('"new since you last looked" counts matches; opening ("seen") resets it; alerts off keeps counting; no digest notification any more', async () => {
    const buyer = await mkUser(prisma); const seller = await mkUser(prisma);
    const cars = await mkCategory(prisma, 'used-cars');
    const { body } = await call('POST', '/api/saved-searches', buyer, { params: { q: 'toyota', priceMax: 30000000, withPhotos: true } });

    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Premio', price: 25000000, images: ['a.jpg'] });
    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Land Cruiser', price: 90000000, images: ['a.jpg'] }); // too expensive
    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Vitz', price: 9000000, images: [] });                  // no photo
    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Axio', price: 8000000, images: ['b.jpg'], status: 'PENDING' }); // not live
    await mkListing(prisma, seller.id, cars.id, { title: 'Honda Fit', price: 8000000, images: ['b.jpg'] });             // different keyword
    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Passo USD', price: 5000, currency: 'USD', images: ['b.jpg'] }); // other currency vs a UGX bound

    expect((await call('GET', '/api/saved-searches', buyer)).body.searches[0].newCount).toBe(1);
    expect(await prisma.notification.count({ where: { userId: buyer.id, type: 'SYSTEM' } })).toBe(0); // the old 5-minute digest is gone
    await call('PATCH', `/api/saved-searches/${body.id}`, buyer, { notify: false });
    await mkListing(prisma, seller.id, cars.id, { title: 'Toyota Passo', price: 7000000, images: ['c.jpg'] });
    expect((await call('GET', '/api/saved-searches', buyer)).body.searches[0].newCount).toBe(2);
    await call('PATCH', `/api/saved-searches/${body.id}`, buyer, { seen: true });
    expect((await call('GET', '/api/saved-searches', buyer)).body.searches[0].newCount).toBe(0);
  });

  it('deleting a user removes their alerts and delivery history (cascade)', async () => {
    const u = await mkUser(prisma);
    await call('POST', '/api/saved-searches', u, { params: { q: 'x1' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.savedSearch.count()).toBe(0);
  });
});
