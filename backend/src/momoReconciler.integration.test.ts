import crypto from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser } from './testing/integrationDb';
import type { MomoClient, RequestToPayInput, RequestToPayStatus } from './utils/momo/client';

configureTestEnv();

const MOMO_ENV: Record<string, string> = {
  MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef', MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab', MTN_CALLBACK_SECRET: 'e'.repeat(40), API_BASE_URL: 'https://api.piitrade.test',
};

class FakeMomo implements MomoClient {
  requests: RequestToPayInput[] = [];
  statusCalls = 0;
  private table = new Map<string, Partial<RequestToPayStatus>>();
  async validateAccountHolder() { return true; }
  async requestToPay(i: RequestToPayInput) { this.requests.push(i); this.table.set(i.referenceId, { rawStatus: 'PENDING', outcome: 'PENDING' }); }
  async getRequestToPayStatus(ref: string): Promise<RequestToPayStatus> {
    this.statusCalls++;
    const req = this.requests.find((r) => r.referenceId === ref);
    return { rawStatus: 'PENDING', outcome: 'PENDING', reason: null, financialTransactionId: null, externalId: req?.externalId ?? null, amount: req?.amount ?? null, currency: req?.currency ?? null, ...(this.table.get(ref) ?? {}) } as RequestToPayStatus;
  }
  succeed(ref: string) { this.table.set(ref, { rawStatus: 'SUCCESSFUL', outcome: 'SUCCESSFUL', financialTransactionId: '555' }); }
}

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe.skipIf(!TEST_DB)('MoMo payment reconciler (real database, fake MTN)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let pay: typeof import('./utils/momo/paymentService');
  let rec: typeof import('./utils/momo/reconciler');
  let clientMod: typeof import('./utils/momo/client');
  let fake: FakeMomo;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of Object.keys(MOMO_ENV)) { saved[k] = process.env[k]; process.env[k] = MOMO_ENV[k]; }
    ({ prisma } = await loadDeps());
    pay = await import('./utils/momo/paymentService');
    rec = await import('./utils/momo/reconciler');
    clientMod = await import('./utils/momo/client');
  });
  afterAll(async () => {
    clientMod.setMomoClientForTests(null);
    for (const k of Object.keys(MOMO_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    fake = new FakeMomo();
    clientMod.setMomoClientForTests(fake);
    process.env.MTN_ENABLED = 'true';
  });

  const mkPackage = () => prisma.sellerPackage.create({ data: { name: 'Pro', durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25 } });
  async function startPayment() {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    const { payment } = await pay.initiatePayment({ userId: u.id, role: 'SELLER' }, { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' });
    const r = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    return { u, pkg, payment, ref: r.referenceId };
  }
  const subOf = (userId: string) => prisma.sellerSubscription.findFirstOrThrow({ where: { userId } });

  it('settles a due PENDING payment even if nobody polled and no callback arrived', async () => {
    const { u, payment, ref } = await startPayment();
    fake.succeed(ref);
    const r = await rec.runPaymentReconciler();
    expect(r).toMatchObject({ skipped: false, checked: 1 });
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).provisionedAt).not.toBeNull();
    expect((await subOf(u.id)).status).toBe('ACTIVE');
  });

  it('leaves payments that are not yet due alone (respects the backoff schedule)', async () => {
    const { payment, ref } = await startPayment();
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { lastCheckedAt: new Date(), checkCount: 0 } });
    fake.succeed(ref);
    const before = fake.statusCalls;
    const r = await rec.runPaymentReconciler();
    expect(r.checked).toBe(0);
    expect(fake.statusCalls).toBe(before);
    // ...but becomes due once the gap has passed
    const later = new Date(Date.now() + 6_000);
    expect((await rec.runPaymentReconciler(later)).checked).toBe(1);
  });

  it('keeps watching EXPIRED payments for 24h so a late approval is honoured — and stops afterwards', async () => {
    const { u, payment, ref } = await startPayment();
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'EXPIRED', createdAt: ago(2 * 60 * MIN), lastCheckedAt: ago(10 * MIN) } });
    fake.succeed(ref);
    expect((await rec.runPaymentReconciler()).checked).toBe(1);
    expect((await subOf(u.id)).status).toBe('ACTIVE');

    const { payment: old, ref: oldRef } = await startPaymentFor(await mkUser(prisma));
    await prisma.paymentTransaction.update({ where: { id: old.id }, data: { status: 'EXPIRED', createdAt: ago(25 * 60 * MIN), lastCheckedAt: null } });
    fake.succeed(oldRef);
    expect((await rec.runPaymentReconciler()).checked).toBe(0); // outside the 24h window
  });

  async function startPaymentFor(u: { id: string }) {
    const pkg = await mkPackage();
    const { payment } = await pay.initiatePayment({ userId: u.id, role: 'SELLER' }, { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' });
    return { payment, ref: (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).referenceId };
  }

  it('retries a paid-but-not-provisioned payment once its lease has lapsed', async () => {
    const { u, payment } = await startPayment();
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', lastCheckedAt: new Date(), provisioningStartedAt: ago(5 * MIN), provisionNote: 'ERROR: boom' } });
    const r = await rec.runPaymentReconciler();
    expect(r.provisioningRetried).toBe(1);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).provisionedAt).not.toBeNull();
    expect((await subOf(u.id)).status).toBe('ACTIVE');
  });

  it('does not run a second provisioning while another worker still holds the lease', async () => {
    const { u, payment } = await startPayment();
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', lastCheckedAt: new Date(), provisioningStartedAt: new Date() } });
    await rec.runPaymentReconciler();
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).provisionedAt).toBeNull();
    expect((await subOf(u.id)).status).toBe('PENDING_PAYMENT');
  });

  it('escalates a payment that has been stuck for 30+ minutes to admins instead of retrying forever', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const { u, payment } = await startPayment();
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', lastCheckedAt: ago(31 * MIN), provisioningStartedAt: ago(31 * MIN), provisionNote: 'ERROR: db down' } });
    const r = await rec.runPaymentReconciler();
    expect(r.escalated).toBe(1);
    const row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('NEEDS_REVIEW');
    expect(row.provisionNote).toMatch(/db down/);
    expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Payment needs review' } })).toBe(1);
    expect((await subOf(u.id)).status).toBe('PENDING_PAYMENT');
    expect((await rec.runPaymentReconciler()).escalated).toBe(0); // not escalated twice
  });

  describe('abandoned subscription requests', () => {
    async function pendingSub(userId: string, pkgId: string, ageMs: number, paymentRef = 'manual-ref') {
      return prisma.sellerSubscription.create({ data: { userId, packageId: pkgId, status: 'PENDING_PAYMENT', startDate: ago(ageMs), endDate: new Date(Date.now() + 30 * 86_400_000), paymentRef, createdAt: ago(ageMs) } });
    }
    const attempt = (targetId: string, userId: string, status: 'FAILED' | 'PENDING' | 'EXPIRED' | 'NEEDS_REVIEW', ageMs: number) =>
      prisma.paymentTransaction.create({ data: { referenceId: crypto.randomUUID(), environment: 'sandbox', purpose: 'SUBSCRIPTION', targetId, userId, amount: 50000, providerAmount: 50000, providerCurrency: 'EUR', msisdn: '256772123456', status, createdAt: ago(ageMs) } });

    it('cancels a MoMo-originated request whose payments all failed long ago, and tells the user', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const sub = await pendingSub(u.id, pkg.id, 26 * 60 * MIN);
      await attempt(sub.id, u.id, 'FAILED', 25 * 60 * MIN);
      expect((await rec.runPaymentReconciler()).staleSubscriptionsCancelled).toBe(1);
      expect((await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('CANCELLED');
      expect(await prisma.notification.count({ where: { userId: u.id, title: 'Subscription request cancelled' } })).toBe(1);
    });

    it('NEVER touches a manual-flow request (no MoMo payment attempts), however old', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const sub = await pendingSub(u.id, pkg.id, 10 * 24 * 60 * MIN);
      expect((await rec.runPaymentReconciler()).staleSubscriptionsCancelled).toBe(0);
      expect((await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('PENDING_PAYMENT');
    });

    it('keeps requests with a payment in flight, in review, or tried within the last 24h', async () => {
      const pkg = await mkPackage();
      const cases: Array<['PENDING' | 'NEEDS_REVIEW' | 'FAILED', number]> = [['PENDING', 25 * 60 * MIN], ['NEEDS_REVIEW', 30 * 60 * MIN], ['FAILED', 2 * 60 * MIN]];
      const subs = [];
      for (const [status, age] of cases) {
        const u = await mkUser(prisma);
        const sub = await pendingSub(u.id, pkg.id, 48 * 60 * MIN);
        await attempt(sub.id, u.id, status, age);
        subs.push(sub);
      }
      await prisma.paymentTransaction.updateMany({ where: { status: 'PENDING' }, data: { lastCheckedAt: new Date(), checkCount: 3 } }); // not due: isolate the cleanup step
      expect((await rec.runPaymentReconciler()).staleSubscriptionsCancelled).toBe(0);
      for (const s of subs) expect((await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PENDING_PAYMENT');
    });
  });

  it('is a no-op while the integration is disabled, and two overlapping runs never double up', async () => {
    const { payment, ref } = await startPayment();
    fake.succeed(ref);
    process.env.MTN_ENABLED = 'false';
    expect((await rec.runPaymentReconciler()).skipped).toBe(true);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
    process.env.MTN_ENABLED = 'true';
    const [a, b] = await Promise.all([rec.runPaymentReconciler(), rec.runPaymentReconciler()]);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCESSFUL');
  });
});
