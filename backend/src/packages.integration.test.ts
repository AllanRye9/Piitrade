import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing, daysFromNow } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('subscriptions over HTTP, enforcement and sweeps (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let subSvc: typeof import('./utils/subscriptionService');
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    subSvc = await import('./utils/subscriptionService');
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); delete process.env.ORDINARY_USER_MAX_LISTINGS; });
  beforeEach(async () => { await resetDb(prisma); delete process.env.ORDINARY_USER_MAX_LISTINGS; });

  const auth = (u: { id: string; email: string }, role = 'BUYER') => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}` });
  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const mkPackage = (over: Record<string, unknown> = {}) =>
    prisma.sellerPackage.create({ data: { name: `Pkg ${Math.random()}`, durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25, ...over } });

  it('subscribe -> my-subscription -> entitlements -> renew -> cancel, all reachable and consistent', async () => {
    const u = await mkUser(prisma);
    const free = await mkPackage({ isFree: true, price: 0, maxListings: null, name: 'Free Trial' });

    const sub = await call('POST', `/api/packages/${free.id}/subscribe`, auth(u), {});
    expect(sub.status).toBe(201);
    expect(sub.body.subscription.status).toBe('ACTIVE');

    const mine = await call('GET', '/api/packages/my-subscription', auth(u));
    expect(mine.body.subscription).toMatchObject({ status: 'ACTIVE', isCurrent: true });
    expect(mine.body.subscription.daysRemaining).toBeGreaterThan(28);
    expect(mine.body.subscription.package.name).toBe('Free Trial');
    expect(mine.body.pending).toBeNull();

    const ent = await call('GET', '/api/packages/my-entitlements', auth(u));
    expect(ent.body.listing).toMatchObject({ source: 'SUBSCRIPTION', maxListings: null, remaining: null, used: 0 });

    const history = await call('GET', '/api/packages/my-subscriptions', auth(u));
    expect(history.body).toMatchObject({ total: 1, page: 1 });

    // a free subscription cannot be renewed (route reachable, rule enforced) ...
    expect((await call('POST', `/api/packages/subscriptions/${sub.body.subscription.id}/renew`, auth(u), { paymentRef: 'X' })).status).toBe(400);
    // ... and the second free subscription is refused
    expect((await call('POST', `/api/packages/${free.id}/subscribe`, auth(u), {})).status).toBe(409);

    // paid: pending, then renew is refused while a request is pending, then cancel works
    const paid = await mkPackage();
    const other = await mkUser(prisma);
    // the HTTP route only starts free packages — paid ones are bought with MoMo, which creates the request itself
    expect((await call('POST', `/api/packages/${paid.id}/subscribe`, auth(other), { paymentRef: 'MOMO-9' })).status).toBe(400);
    expect((await call('POST', `/api/packages/${paid.id}/upgrade`, auth(other), { mode: 'IMMEDIATE', paymentRef: 'X' })).status).toBe(400);
    const made = await subSvc.subscribeToPackage(other.id, paid.id, 'MOMO-9');
    const p = { body: { subscription: made.subscription } };
    expect(p.body.subscription.status).toBe('PENDING_PAYMENT');
    const pending = await call('GET', '/api/packages/my-subscription', auth(other));
    expect(pending.body.subscription).toBeNull();
    expect(pending.body.pending.status).toBe('PENDING_PAYMENT');
    const cancelled = await call('POST', `/api/packages/subscriptions/${p.body.subscription.id}/cancel`, auth(other));
    expect(cancelled.body.subscription.status).toBe('CANCELLED');
    expect((await call('POST', `/api/packages/subscriptions/${p.body.subscription.id}/cancel`, auth(other))).status).toBe(409);
    expect((await call('POST', `/api/packages/subscriptions/${p.body.subscription.id}/cancel`, auth(u))).status).toBe(404); // not theirs
    expect((await call('GET', '/api/packages/my-subscription', {})).status).toBe(401);
  });

  it('status is real-time on reads: a lapsed ACTIVE row reads as EXPIRED, and a GET never writes', async () => {
    const u = await mkUser(prisma);
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const pkg = await mkPackage();
    const lapsed = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: pkg.id, status: 'ACTIVE', startDate: daysFromNow(-31), endDate: new Date(Date.now() - 5000) } });

    const mine = await call('GET', '/api/packages/my-subscription', auth(u));
    expect(mine.body.subscription).toBeNull();                                           // no longer current
    expect((await prisma.sellerSubscription.findUnique({ where: { id: lapsed.id } }))!.status).toBe('ACTIVE'); // GET did not write
    const hist = await call('GET', '/api/packages/my-subscriptions', auth(u));
    expect(hist.body.subscriptions[0]).toMatchObject({ status: 'EXPIRED', storedStatus: 'ACTIVE', isCurrent: false, daysRemaining: 0 });

    // admin list filters agree
    expect((await call('GET', '/api/admin/subscriptions?status=ACTIVE', auth(admin, 'ADMIN'))).body.total).toBe(0);
    const expired = await call('GET', '/api/admin/subscriptions?status=EXPIRED', auth(admin, 'ADMIN'));
    expect(expired.body.total).toBe(1);
    expect(expired.body.subscriptions[0]).toMatchObject({ status: 'EXPIRED' });
    expect((await call('GET', '/api/admin/subscriptions?status=NOPE', auth(admin, 'ADMIN'))).status).toBe(400);
  });

  it('ending a paid subscription never locks the customer out of their account', async () => {
    const password = await bcrypt.hash('CorrectHorse1!', 4);
    const u = await mkUser(prisma, { password, isVerified: true });
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const pkg = await mkPackage();
    const sub = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: pkg.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(10) } });

    const end = await call('PUT', `/api/admin/subscriptions/${sub.id}`, auth(admin, 'ADMIN'), { status: 'CANCELLED' });
    expect(end.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.isVerified).toBe(true);
    const login = await call('POST', '/api/auth/login', {}, { email: u.email, password: 'CorrectHorse1!' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(u.email);
    // and the admin endpoint validates
    expect((await call('PUT', `/api/admin/subscriptions/${sub.id}`, auth(admin, 'ADMIN'), { status: 'ACTIVE' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/subscriptions/nope', auth(admin, 'ADMIN'), { status: 'ACTIVE' })).status).toBe(404);
    expect((await call('PUT', `/api/admin/subscriptions/${sub.id}`, auth(u), { status: 'ACTIVE' })).status).toBe(403);
  });

  it('the posting cap follows the live entitlement on a real create request', async () => {
    process.env.ORDINARY_USER_MAX_LISTINGS = '1';
    const u = await mkUser(prisma);
    const cat = await mkCategory(prisma, 'misc');
    await mkListing(prisma, u.id, cat.id);
    const body = { title: 'Another item', description: 'A perfectly good item for sale', price: 5000, location: 'Kampala', categoryId: cat.id, country: 'UGANDA' };

    const blocked = await call('POST', '/api/listings', auth(u), body);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/up to 1 live listings/);

    // a current subscription raises the cap …
    const pkg = await mkPackage({ name: 'Basic', maxListings: 3 });
    const sub = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: pkg.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(10) } });
    const allowed = await call('POST', '/api/listings', auth(u), body);
    expect(allowed.status).not.toBe(403);
    expect(allowed.status).toBeLessThan(500);

    // … and the moment it lapses (dates only — no job has run) the ordinary cap applies again
    await prisma.sellerSubscription.update({ where: { id: sub.id }, data: { endDate: new Date(Date.now() - 1000) } });
    expect((await call('POST', '/api/listings', auth(u), body)).status).toBe(403);
  });

  it('the lifecycle sweep expires, reminds and repairs, and never runs two sweeps at once', async () => {
    const { runLifecycleSweep } = await import('./utils/lifecycleJobs');
    const u = await mkUser(prisma);
    const pkg = await mkPackage();
    await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: pkg.id, status: 'ACTIVE', startDate: daysFromNow(-31), endDate: new Date(Date.now() - 1000) } });
    const u2 = await mkUser(prisma);
    await prisma.sellerSubscription.create({ data: { userId: u2.id, packageId: pkg.id, status: 'ACTIVE', startDate: daysFromNow(-28), endDate: daysFromNow(2) } });
    const orphan = await mkUser(prisma);
    await prisma.store.create({ data: { userId: orphan.id, name: 'Orphan', slug: `o-${orphan.id.slice(0, 6)}`, isActive: true } });

    const [a, b] = await Promise.all([runLifecycleSweep(), runLifecycleSweep()]);
    const real = a.skipped ? b : a;
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);   // the overlapping call was skipped
    expect(real).toMatchObject({ subscriptionsExpired: 1, subscriptionReminders: 1, storesRepaired: 1, errors: [] });
    const second = await runLifecycleSweep();
    expect(second).toMatchObject({ subscriptionsExpired: 0, subscriptionReminders: 0, storesRepaired: 0 });
  });
});
