import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, daysFromNow } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('subscription lifecycle (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let svc: typeof import('./utils/subscriptionService');

  beforeAll(async () => {
    ({ prisma } = await loadDeps());
    svc = await import('./utils/subscriptionService');
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); });

  const mkPackage = (over: Record<string, unknown> = {}) =>
    prisma.sellerPackage.create({ data: { name: `Pkg ${Math.random()}`, durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25, ...over } });

  it('a free package starts ACTIVE and can be taken only once per account', async () => {
    const u = await mkUser(prisma);
    const free = await mkPackage({ isFree: true, price: 0, maxListings: null });
    const { subscription } = await svc.subscribeToPackage(u.id, free.id, undefined);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.endDate.getTime()).toBeGreaterThan(daysFromNow(29).getTime());
    // expire it, then try the free package again — still refused
    await prisma.sellerSubscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
    await expect(svc.subscribeToPackage(u.id, free.id, undefined)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a paid LISTING package waits for payment confirmation and requires a reference', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage();
    await expect(svc.subscribeToPackage(u.id, paid.id, undefined)).rejects.toMatchObject({ statusCode: 400 });
    const { subscription, activated } = await svc.subscribeToPackage(u.id, paid.id, 'MOMO-123');
    expect(activated).toBe(false);
    expect(subscription.status).toBe('PENDING_PAYMENT');
    // a second request while one is pending is refused
    await expect(svc.subscribeToPackage(u.id, paid.id, 'MOMO-456')).rejects.toMatchObject({ statusCode: 409 });
    // pending grants nothing
    expect((await svc.loadListingEntitlement(u.id)).source).toBe('ORDINARY');
  });

  it('simultaneous subscribe requests create exactly one subscription', async () => {
    const u = await mkUser(prisma);
    const free = await mkPackage({ isFree: true, price: 0 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => svc.subscribeToPackage(u.id, free.id, undefined)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.sellerSubscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('admin confirming payment activates it, notifies the user, and grants the package cap', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage({ maxListings: 25 });
    const { subscription } = await svc.subscribeToPackage(u.id, paid.id, 'MOMO-1');
    const { subscription: active, activatedNow } = await svc.adminUpdateSubscription(subscription.id, { status: 'ACTIVE' });
    expect(activatedNow).toBe(true);
    expect(active.status).toBe('ACTIVE');
    const ent = await svc.loadListingEntitlement(u.id);
    expect(ent).toMatchObject({ source: 'SUBSCRIPTION', maxListings: 25 });
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'SUBSCRIPTION_ACTIVATED' } })).toBe(1);
  });

  it('early renewal chains after the current term so no paid days are lost', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage({ durationDays: 30 });
    const cur = await prisma.sellerSubscription.create({
      data: { userId: u.id, packageId: paid.id, status: 'ACTIVE', startDate: daysFromNow(-20), endDate: daysFromNow(10) },
    });
    const renewal = await svc.requestRenewal(u.id, cur.id, 'MOMO-RENEW');
    expect(renewal.status).toBe('PENDING_PAYMENT');
    const { subscription } = await svc.adminUpdateSubscription(renewal.id, { status: 'ACTIVE' });
    // starts when the current one ends; lasts the package duration after that
    expect(Math.abs(subscription.startDate.getTime() - cur.endDate.getTime())).toBeLessThan(2000);
    expect(Math.abs(subscription.endDate.getTime() - (cur.endDate.getTime() + 30 * 86_400_000))).toBeLessThan(2000);
    // both rows are ACTIVE; the earlier one is the one currently granting access
    expect((await svc.getCurrentSubscription(u.id, 'LISTING'))?.id).toBe(cur.id);
  });

  it('renewal is refused for free packages, other people\'s subscriptions and duplicates', async () => {
    const [a, b] = [await mkUser(prisma), await mkUser(prisma)];
    const free = await mkPackage({ isFree: true, price: 0 });
    const paid = await mkPackage();
    const freeSub = await prisma.sellerSubscription.create({ data: { userId: a.id, packageId: free.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(5) } });
    await expect(svc.requestRenewal(a.id, freeSub.id, 'X')).rejects.toMatchObject({ statusCode: 400 });
    const paidSub = await prisma.sellerSubscription.create({ data: { userId: a.id, packageId: paid.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(5) } });
    await expect(svc.requestRenewal(b.id, paidSub.id, 'X')).rejects.toMatchObject({ statusCode: 404 });
    await svc.requestRenewal(a.id, paidSub.id, 'X1');
    await expect(svc.requestRenewal(a.id, paidSub.id, 'X2')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('the status machine blocks bad admin transitions and bad dates', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage();
    const sub = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: paid.id, status: 'CANCELLED', startDate: daysFromNow(-5), endDate: daysFromNow(5) } });
    await expect(svc.adminUpdateSubscription(sub.id, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 400 }); // needs a future endDate
    await expect(svc.adminUpdateSubscription(sub.id, { status: 'WHATEVER' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.adminUpdateSubscription(sub.id, { endDate: 'nonsense' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.adminUpdateSubscription('missing', { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 404 });
    const revived = await svc.adminUpdateSubscription(sub.id, { status: 'ACTIVE', endDate: daysFromNow(20).toISOString() });
    expect(revived.subscription.status).toBe('ACTIVE');
  });

  it('expiry flips lapsed subscriptions once, notifies once, and NEVER touches isVerified', async () => {
    const u = await mkUser(prisma, { isVerified: true });
    const paid = await mkPackage();
    const lapsed = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: paid.id, status: 'ACTIVE', startDate: daysFromNow(-40), endDate: daysFromNow(-1) } });
    expect(svc.effectiveStatus(lapsed)).toBe('EXPIRED'); // real time, before any job runs
    expect(await svc.expireOverdueSubscriptions()).toBe(1);
    expect(await svc.expireOverdueSubscriptions()).toBe(0); // idempotent
    expect((await prisma.sellerSubscription.findUnique({ where: { id: lapsed.id } }))!.status).toBe('EXPIRED');
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'SUBSCRIPTION_EXPIRED' } })).toBe(1);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.isVerified).toBe(true); // can still log in
  });

  it('reminds exactly once when a subscription enters its final days', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage();
    const soon = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: paid.id, status: 'ACTIVE', startDate: daysFromNow(-27), endDate: daysFromNow(2) } });
    await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: (await mkPackage()).id, status: 'ACTIVE', startDate: daysFromNow(-1), endDate: daysFromNow(20) } });
    expect(await svc.sendSubscriptionReminders()).toBe(1);
    expect(await svc.sendSubscriptionReminders()).toBe(0);
    expect((await prisma.sellerSubscription.findUnique({ where: { id: soon.id } }))!.reminderSentAt).not.toBeNull();
    // extending the end date re-arms the reminder
    await svc.adminUpdateSubscription(soon.id, { endDate: daysFromNow(2.5).toISOString() });
    expect(await svc.sendSubscriptionReminders()).toBe(1);
  });

  it('the owner can cancel; ended or foreign subscriptions cannot be cancelled', async () => {
    const [a, b] = [await mkUser(prisma), await mkUser(prisma)];
    const paid = await mkPackage();
    const sub = await prisma.sellerSubscription.create({ data: { userId: a.id, packageId: paid.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(10) } });
    await expect(svc.cancelOwnSubscription(b.id, sub.id)).rejects.toMatchObject({ statusCode: 404 });
    const done = await svc.cancelOwnSubscription(a.id, sub.id);
    expect(done.status).toBe('CANCELLED');
    expect(done.cancelledAt).not.toBeNull();
    await expect(svc.cancelOwnSubscription(a.id, sub.id)).rejects.toMatchObject({ statusCode: 409 });
    expect((await svc.loadListingEntitlement(a.id)).source).toBe('ORDINARY'); // access ends immediately
  });

  it('a lapsed subscription stops granting access immediately, before the sweep runs', async () => {
    const u = await mkUser(prisma);
    const paid = await mkPackage({ maxListings: 99 });
    await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: paid.id, status: 'ACTIVE', startDate: daysFromNow(-31), endDate: new Date(Date.now() - 1000) } });
    expect((await svc.loadListingEntitlement(u.id)).source).toBe('ORDINARY');
  });
});
