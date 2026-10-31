import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing, daysFromNow } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('Merchant rental activation (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let svc: typeof import('./utils/storeRentalService');
  let sub: typeof import('./utils/subscriptionService');
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    svc = await import('./utils/storeRentalService');
    sub = await import('./utils/subscriptionService');
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_notification ON "Notification"');
    await resetDb(prisma);
  });

  async function fixture(over: { kyc?: boolean; endInDays?: number; tier?: 'FREE' | 'GOLD' | 'PLATINUM' } = {}) {
    const owner = await mkUser(prisma, { role: 'BUYER', isKycVerified: over.kyc ?? true });
    const cat = await mkCategory(prisma, `cat-${Math.random().toString(36).slice(2, 8)}`);
    const listings = await Promise.all([1, 2, 3].map(() => mkListing(prisma, owner.id, cat.id)));
    const rental = await prisma.storeRental.create({
      data: {
        userId: owner.id, status: 'PENDING', tier: over.tier ?? 'GOLD', maxListings: 40,
        endDate: daysFromNow(over.endInDays ?? 30), placements: { storeName: 'Kampala Gadgets', storeDescription: 'Phones & more' },
      },
    });
    return { owner, listings, rental };
  }

  it('a paid plan cannot go live unpaid unless the admin explicitly allows it', async () => {
    const { rental } = await fixture();
    await prisma.storeRental.update({ where: { id: rental.id }, data: { fee: 60000, durationDays: 30 } });
    await expect(svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 409 });
    expect((await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE', allowUnpaid: true })).rental.status).toBe('ACTIVE');
  });

  it('approving a paid application starts the term at approval, even when it was applied for long ago', async () => {
    const { rental } = await fixture({ endInDays: -5 }); // applied long ago: the old end date already passed
    await prisma.storeRental.update({
      where: { id: rental.id },
      data: { fee: 60000, durationDays: 30, placements: { storeName: 'Shop', paymentStatus: 'CONFIRMED' } },
    });
    const out = await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    const days = (out.rental.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('ACTIVE makes the Merchant account fully operational in one step', async () => {
    const { owner, listings, rental } = await fixture();
    const out = await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });

    expect(out.rental.status).toBe('ACTIVE');
    // permissions
    expect((await prisma.user.findUnique({ where: { id: owner.id } }))!.role).not.toBe('BUYER');
    // visibility
    const store = await prisma.store.findUnique({ where: { userId: owner.id } });
    expect(store).toMatchObject({ isActive: true, name: 'Kampala Gadgets', description: 'Phones & more' });
    // listing access
    const subs = await prisma.sellerSubscription.findMany({ where: { userId: owner.id, status: 'ACTIVE' }, include: { package: true } });
    expect(subs).toHaveLength(1);
    expect(subs[0].package.name).toBe(sub.STORE_OWNER_PACKAGE_NAME);
    expect(subs[0].package.isActive).toBe(false);          // never offered on the public packages list
    expect(Math.abs(subs[0].endDate.getTime() - rental.endDate.getTime())).toBeLessThan(1000);
    // listings render at the store's tier, and stay live
    const after = await prisma.listing.findMany({ where: { id: { in: listings.map((l) => l.id) } } });
    expect(after.every((l) => l.tier === 'GOLD' && l.status === 'ACTIVE')).toBe(true);
    // entitlement + notification
    expect(out.entitlement).toMatchObject({ source: 'STORE', maxListings: 40 });
    expect(out.effect === undefined).toBe(true); // (effect is added by the route, not the service)
    expect(out.activating).toBe(true);
    expect(await prisma.notification.count({ where: { userId: owner.id, title: { contains: 'Merchant Account is Now Active' } } })).toBe(1);
  });

  it('is idempotent: repeating ACTIVE repairs but never duplicates or re-announces', async () => {
    const { owner, rental } = await fixture();
    await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    // simulate a half-applied older activation: the store got frozen out-of-band
    await prisma.store.update({ where: { userId: owner.id }, data: { isActive: false } });
    const again = await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    expect(again.activating).toBe(false);
    expect((await prisma.store.findUnique({ where: { userId: owner.id } }))!.isActive).toBe(true); // repaired
    expect(await prisma.store.count({ where: { userId: owner.id } })).toBe(1);
    expect(await prisma.sellerSubscription.count({ where: { userId: owner.id, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner.id, title: { contains: 'Merchant Account is Now Active' } } })).toBe(1);
  });

  it('simultaneous admin clicks produce one Merchant account, one subscription, one announcement', async () => {
    const { owner, rental } = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' })));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.store.count({ where: { userId: owner.id } })).toBe(1);
    expect(await prisma.sellerSubscription.count({ where: { userId: owner.id, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner.id, title: { contains: 'Merchant Account is Now Active' } } })).toBe(1);
  });

  it('all-or-nothing: a failure part-way leaves NOTHING half-applied', async () => {
    const { owner, rental } = await fixture();
    // The announcement is the LAST step of activation; make it blow up.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_notification() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER test_fail_notification BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION test_fail_notification()');
    await expect(svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' })).rejects.toThrow();
    await prisma.$executeRawUnsafe('DROP TRIGGER test_fail_notification ON "Notification"');

    expect((await prisma.storeRental.findUnique({ where: { id: rental.id } }))!.status).toBe('PENDING');
    expect((await prisma.user.findUnique({ where: { id: owner.id } }))!.role).toBe('BUYER');
    expect(await prisma.store.count({ where: { userId: owner.id } })).toBe(0);
    expect(await prisma.sellerSubscription.count({ where: { userId: owner.id } })).toBe(0);
    expect(await prisma.listing.count({ where: { userId: owner.id, tier: 'GOLD' } })).toBe(0);
    // and a retry now succeeds cleanly
    expect((await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' })).rental.status).toBe('ACTIVE');
  });

  it('refuses unsafe activations without changing anything', async () => {
    const noKyc = await fixture({ kyc: false });
    await expect(svc.applyRentalUpdate(noKyc.rental.id, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 400 });
    const expired = await fixture({ endInDays: -2 });
    await expect(svc.applyRentalUpdate(expired.rental.id, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.applyRentalUpdate(expired.rental.id, { status: 'BOGUS' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.applyRentalUpdate('does-not-exist', { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 404 });
    expect((await prisma.storeRental.findUnique({ where: { id: noKyc.rental.id } }))!.status).toBe('PENDING');
    expect(await prisma.store.count()).toBe(0);
    // supplying a fresh end date in the same request makes the lapsed one valid
    const out = await svc.applyRentalUpdate(expired.rental.id, { status: 'ACTIVE', endDate: daysFromNow(15).toISOString() });
    expect(out.rental.status).toBe('ACTIVE');
  });

  it('ending a Merchant account freezes it, resets tiers/placements, keeps listings live, ends Merchant account access', async () => {
    const { owner, listings, rental } = await fixture();
    await prisma.listing.update({ where: { id: listings[0].id }, data: { placement: 'FEATURED_DEAL', placementExpiresAt: daysFromNow(5) } });
    await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    const out = await svc.applyRentalUpdate(rental.id, { status: 'CANCELLED' });

    expect(out.ending).toBe(true);
    expect((await prisma.store.findUnique({ where: { userId: owner.id } }))!.isActive).toBe(false);
    expect(await prisma.sellerSubscription.count({ where: { userId: owner.id, status: 'ACTIVE' } })).toBe(0);
    const after = await prisma.listing.findMany({ where: { userId: owner.id } });
    expect(after.every((l) => l.tier === 'FREE' && l.placement === 'NONE' && l.status === 'ACTIVE')).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: owner.id } }))!.role).not.toBe('BUYER'); // role is kept
    expect(out.entitlement.source).toBe('ORDINARY');
    expect(await prisma.notification.count({ where: { userId: owner.id, title: 'Merchant Account Deactivated' } })).toBe(1);
    // suspend-to-pending also freezes
    await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE', endDate: daysFromNow(10).toISOString() });
    expect((await prisma.store.findUnique({ where: { userId: owner.id } }))!.isActive).toBe(true); // re-opened, same store
    await svc.applyRentalUpdate(rental.id, { status: 'PENDING' });
    expect((await prisma.store.findUnique({ where: { userId: owner.id } }))!.isActive).toBe(false);
    expect(await prisma.store.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('a user\'s separately purchased subscription survives Merchant account activation and lapse', async () => {
    const { owner, rental } = await fixture();
    const pkg = await prisma.sellerPackage.create({ data: { name: 'Mine', durationDays: 30, price: 10000, isFree: false, scope: 'LISTING', maxListings: 12 } });
    const mine = await prisma.sellerSubscription.create({ data: { userId: owner.id, packageId: pkg.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(20) } });
    await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    expect((await prisma.sellerSubscription.findUnique({ where: { id: mine.id } }))!.status).toBe('ACTIVE');
    await svc.applyRentalUpdate(rental.id, { status: 'EXPIRED' });
    expect((await prisma.sellerSubscription.findUnique({ where: { id: mine.id } }))!.status).toBe('ACTIVE');
    expect(await sub.loadListingEntitlement(owner.id)).toMatchObject({ source: 'SUBSCRIPTION', maxListings: 12 });
  });

  it('the sweep expires overdue rentals atomically and repairs stale open Merchants (never admins)', async () => {
    const { owner, rental } = await fixture();
    await svc.applyRentalUpdate(rental.id, { status: 'ACTIVE' });
    await prisma.storeRental.update({ where: { id: rental.id }, data: { endDate: new Date(Date.now() - 1000) } });
    // an orphan: open store whose owner has no rental at all
    const orphan = await mkUser(prisma);
    await prisma.store.create({ data: { userId: orphan.id, name: 'Orphan', slug: `orphan-${orphan.id.slice(0, 6)}`, isActive: true } });
    // an admin's store must never be touched
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    await prisma.store.create({ data: { userId: admin.id, name: 'Official', slug: `official-${admin.id.slice(0, 6)}`, isActive: true } });

    const r = await svc.expireOverdueStoreRentals();
    expect(r.expired).toBe(1);
    expect((await prisma.storeRental.findUnique({ where: { id: rental.id } }))!.status).toBe('EXPIRED');
    expect((await prisma.store.findUnique({ where: { userId: owner.id } }))!.isActive).toBe(false);
    expect((await prisma.store.findUnique({ where: { userId: orphan.id } }))!.isActive).toBe(false);
    expect((await prisma.store.findUnique({ where: { userId: admin.id } }))!.isActive).toBe(true);
    expect((await svc.expireOverdueStoreRentals()).expired).toBe(0); // idempotent
  });

  it('admin PATCH over HTTP: enforced for admins only, returns the resulting operational state', async () => {
    const { owner, rental } = await fixture();
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const asAdmin = token({ userId: admin.id, email: admin.email, role: 'ADMIN' });
    const asOwner = token({ userId: owner.id, email: owner.email, role: 'BUYER' });
    const call = (t: string | null, body: unknown) => fetch(`${base}/api/store-rentals/admin/${rental.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body),
    });

    expect((await call(null, { status: 'ACTIVE' })).status).toBe(401);
    expect((await call(asOwner, { status: 'ACTIVE' })).status).toBe(403);
    expect((await prisma.storeRental.findUnique({ where: { id: rental.id } }))!.status).toBe('PENDING');

    const bad = await call(asAdmin, { status: 'ACTIVE', maxListings: 'lots' });
    expect(bad.status).toBe(400);

    const ok = await call(asAdmin, { status: 'ACTIVE' });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.rental.status).toBe('ACTIVE');
    expect(body.store).toMatchObject({ isActive: true, name: 'Kampala Gadgets' });
    expect(body.entitlement).toMatchObject({ source: 'STORE', maxListings: 40 });
    expect(body.effect).toMatchObject({ activated: true, deactivated: false });
    // the new role takes effect on the very next request (no stale cached account state)
    const me = await fetch(`${base}/api/users/me`, { headers: { Authorization: `Bearer ${asOwner}` } });
    const meBody = await me.json();
    const role = meBody.role ?? meBody.user?.role;
    expect(role).toBeTruthy();
    expect(role).not.toBe('BUYER');
  });
});
