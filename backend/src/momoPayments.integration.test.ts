import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing, daysFromNow } from './testing/integrationDb';
import type { MomoClient, RequestToPayInput, RequestToPayStatus } from './utils/momo/client';

configureTestEnv();

const SECRET = 'c'.repeat(40);
const MOMO_ENV: Record<string, string> = {
  MTN_ENABLED: 'true',
  MTN_ENVIRONMENT: 'sandbox',
  MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef',
  MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab',
  MTN_CALLBACK_SECRET: SECRET,
  API_BASE_URL: 'https://api.piitrade.test',
};
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** Scripted stand-in for MTN: remembers every request, answers status lookups from a table. */
class FakeMomo implements MomoClient {
  accountActive = true;
  accountCheckThrows = false;
  requestMode: 'ok' | 'reject' | 'network' = 'ok';
  requests: RequestToPayInput[] = [];
  statusCalls = 0;
  private table = new Map<string, Partial<RequestToPayStatus>>();

  async validateAccountHolder(): Promise<boolean> {
    if (this.accountCheckThrows) throw new Error('MTN down');
    return this.accountActive;
  }
  async requestToPay(input: RequestToPayInput): Promise<void> {
    const { MomoApiError } = await import('./utils/momo/client');
    if (this.requestMode === 'reject') throw new MomoApiError('rejected', 400, false);
    if (this.requestMode === 'network') { this.requests.push(input); throw new MomoApiError('timeout', null, true); }
    this.requests.push(input);
    this.table.set(input.referenceId, { rawStatus: 'PENDING', outcome: 'PENDING' });
  }
  async getRequestToPayStatus(referenceId: string): Promise<RequestToPayStatus> {
    this.statusCalls++;
    const { MomoApiError } = await import('./utils/momo/client');
    const row = this.table.get(referenceId);
    if (!row) throw new MomoApiError('not found', 404, false);
    const req = this.requests.find((r) => r.referenceId === referenceId);
    return {
      rawStatus: 'PENDING', outcome: 'PENDING', reason: null, financialTransactionId: null,
      externalId: req?.externalId ?? null, amount: req?.amount ?? null, currency: req?.currency ?? null,
      ...row,
    } as RequestToPayStatus;
  }
  succeed(ref: string, over: Partial<RequestToPayStatus> = {}) { this.table.set(ref, { rawStatus: 'SUCCESSFUL', outcome: 'SUCCESSFUL', financialTransactionId: '123456789', ...over }); }
  fail(ref: string, reason: string) { this.table.set(ref, { rawStatus: 'FAILED', outcome: 'FAILED', reason }); }
  forget(ref: string) { this.table.delete(ref); }
  last() { return this.requests[this.requests.length - 1]; }
}

describe.skipIf(!TEST_DB)('MTN MoMo payments (real database, fake MTN)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let pay: typeof import('./utils/momo/paymentService');
  let clientMod: typeof import('./utils/momo/client');
  let rules: typeof import('./utils/momo/rules');
  let subSvc: typeof import('./utils/subscriptionService');
  let fake: FakeMomo;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of Object.keys(MOMO_ENV)) { saved[k] = process.env[k]; process.env[k] = MOMO_ENV[k]; }
    ({ prisma } = await loadDeps());
    pay = await import('./utils/momo/paymentService');
    clientMod = await import('./utils/momo/client');
    rules = await import('./utils/momo/rules');
    subSvc = await import('./utils/subscriptionService');
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

  const mkPackage = (over: Record<string, unknown> = {}) =>
    prisma.sellerPackage.create({ data: { name: `Pkg ${Math.random()}`, durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25, ...over } });
  const actorOf = (u: { id: string }, role = 'SELLER') => ({ userId: u.id, role });
  const PHONE = '0772123456';
  const buy = (u: { id: string }, packageId: string, msisdn: unknown = PHONE) =>
    pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION', packageId, msisdn });
  const refOf = async (paymentId: string) => (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } })).referenceId;
  const row = (id: string) => prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });

  // ─── Subscriptions ────────────────────────────────────────────────────────

  describe('subscription payments', () => {
    it('initiate creates the pending subscription + a PENDING payment and sends the documented MTN request', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment, resumed } = await buy(u, pkg.id, '0772 123 456');
      expect(resumed).toBe(false);
      expect(payment).toMatchObject({ purpose: 'SUBSCRIPTION', status: 'PENDING', completed: false, amount: 50000, currency: 'UGX', msisdn: '256******456' });

      const sub = await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } });
      expect(sub.status).toBe('PENDING_PAYMENT');
      expect(payment.targetId).toBe(sub.id);

      const r = await row(payment.id);
      expect(sub.paymentRef).toBe(r.referenceId); // the MoMo reference doubles as the subscription's paymentRef
      expect(r).toMatchObject({ environment: 'sandbox', msisdn: '256772123456', providerCurrency: 'EUR', status: 'PENDING', provisionedAt: null });
      expect(Number(r.amount)).toBe(50000);

      expect(fake.requests).toHaveLength(1);
      expect(fake.last()).toMatchObject({ referenceId: r.referenceId, amount: '50000', currency: 'EUR', externalId: r.id, msisdn: '256772123456' });
      const cb = new URL(fake.last().callbackUrl!);
      expect(cb.origin + cb.pathname).toBe(`https://api.piitrade.test/api/payments/momo/callback/${r.referenceId}`);
      expect(rules.verifyCallbackSignature(r.referenceId, cb.searchParams.get('s'), SECRET)).toBe(true);
      // nothing is granted before MTN confirms
      expect((await subSvc.loadListingEntitlement(u.id)).source).toBe('ORDINARY');
    });

    it('a confirmed payment activates the subscription, notifies once and grants the package cap', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage({ maxListings: 25 });
      const { payment } = await buy(u, pkg.id);
      expect((await pay.verifyPayment(payment.id)).status).toBe('PENDING'); // MTN still waiting for the PIN

      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled).toMatchObject({ status: 'SUCCESSFUL', financialTransactionId: '123456789' });
      expect(settled.provisionedAt).not.toBeNull();

      const sub = await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.endDate.getTime()).toBeGreaterThan(daysFromNow(29).getTime());
      expect(await subSvc.loadListingEntitlement(u.id)).toMatchObject({ source: 'SUBSCRIPTION', maxListings: 25 });
      expect(await prisma.notification.count({ where: { userId: u.id, type: 'SUBSCRIPTION_ACTIVATED' } })).toBe(1);
      expect((await pay.getPaymentForActor(payment.id, actorOf(u))).completed).toBe(true);
    });

    it('is idempotent: six simultaneous verifications activate exactly once', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      fake.succeed(await refOf(payment.id));
      await Promise.all(Array.from({ length: 6 }, () => pay.verifyPayment(payment.id)));
      await pay.verifyPayment(payment.id); // and a late repeat
      expect(await prisma.notification.count({ where: { userId: u.id, type: 'SUBSCRIPTION_ACTIVATED' } })).toBe(1);
      expect((await prisma.sellerSubscription.findMany({ where: { userId: u.id } })).map((s) => s.status)).toEqual(['ACTIVE']);
      expect((await row(payment.id)).provisionedAt).not.toBeNull();
    });

    it('a double-tap resumes the same attempt: one payment row, one MTN request', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const first = await buy(u, pkg.id);
      const second = await buy(u, pkg.id);
      expect(second.resumed).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(fake.requests).toHaveLength(1);
    });

    it('five simultaneous initiations never push more than one prompt or create more than one payment', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => buy(u, pkg.id)));
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      for (const r of results) if (r.status === 'rejected') expect((r.reason as { statusCode?: number }).statusCode).toBe(409);
      expect(await prisma.paymentTransaction.count({ where: { userId: u.id } })).toBe(1);
      expect(await prisma.sellerSubscription.count({ where: { userId: u.id } })).toBe(1);
      expect(fake.requests).toHaveLength(1);
    });

    it('a declined payment stays FAILED with a friendly message, keeps the request, and can be retried', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      fake.fail(await refOf(payment.id), 'APPROVAL_REJECTED');
      const failed = await pay.verifyPayment(payment.id);
      expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'APPROVAL_REJECTED' });
      expect((await pay.getPaymentForActor(payment.id, actorOf(u))).failureMessage).toMatch(/declined on your phone/);
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('PENDING_PAYMENT');

      const retry = await buy(u, pkg.id);
      expect(retry.resumed).toBe(false);
      expect(retry.payment.id).not.toBe(payment.id);
      expect(retry.payment.targetId).toBe(payment.targetId); // same pending subscription
      expect(await prisma.sellerSubscription.count({ where: { userId: u.id } })).toBe(1);
      fake.succeed(await refOf(retry.payment.id));
      await pay.verifyPayment(retry.payment.id);
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
    });

    it('does not activate when MTN reports a different amount or currency — it goes to review and alerts admins', async () => {
      const admin = await mkUser(prisma, { role: 'ADMIN' });
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      fake.succeed(await refOf(payment.id), { amount: '1' });
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.status).toBe('NEEDS_REVIEW');
      expect(settled.provisionedAt).toBeNull();
      expect(settled.provisionNote).toMatch(/amount/);
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('PENDING_PAYMENT');
      expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Payment needs review' } })).toBe(1);

      // a different externalId is treated the same way
      const u2 = await mkUser(prisma);
      const p2 = (await buy(u2, pkg.id)).payment;
      fake.succeed(await refOf(p2.id), { externalId: 'someone-elses-payment' });
      expect((await pay.verifyPayment(p2.id)).status).toBe('NEEDS_REVIEW');
    });

    it('a payment that lands after the request was cancelled is sent to review, never silently kept', async () => {
      const admin = await mkUser(prisma, { role: 'ADMIN' });
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      await prisma.sellerSubscription.updateMany({ where: { userId: u.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled).toMatchObject({ status: 'NEEDS_REVIEW', provisionedAt: null });
      expect(settled.provisionNote).toMatch(/CANCELLED/);
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('CANCELLED');
      expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Payment needs review' } })).toBe(1);
      // and the user can't be charged again for the same item while it's in review
      await expect(buy(u, pkg.id)).resolves.toBeDefined(); // a NEW pending subscription is a different target
    });

    it('if an admin already confirmed manually, the payment is recorded without a second activation', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      const sub = await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } });
      await subSvc.adminUpdateSubscription(sub.id, { status: 'ACTIVE', review: { packageId: pkg.id, price: pkg.price, currency: pkg.currency, durationDays: pkg.durationDays, maxListings: pkg.maxListings } });
      const endBefore = (await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id } })).endDate;
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.status).toBe('SUCCESSFUL');
      expect(settled.provisionNote).toMatch(/Already active/);
      expect((await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: sub.id } })).endDate.getTime()).toBe(endBefore.getTime());
      expect(await prisma.notification.count({ where: { userId: u.id, type: 'SUBSCRIPTION_ACTIVATED' } })).toBe(1);
    });

    it('a second successful payment for the same item goes to review as a duplicate, not silently "done"', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const first = (await buy(u, pkg.id)).payment;
      await prisma.paymentTransaction.update({ where: { id: first.id }, data: { status: 'EXPIRED', failureReason: 'EXPIRED' } }); // looked dead, may still be approved
      const second = (await buy(u, pkg.id)).payment;
      expect(second.id).not.toBe(first.id);
      fake.succeed(await refOf(second.id));
      expect((await pay.verifyPayment(second.id)).provisionedAt).not.toBeNull();
      fake.succeed(await refOf(first.id)); // the late approval of the first prompt
      const dup = await pay.verifyPayment(first.id);
      expect(dup.status).toBe('NEEDS_REVIEW');
      expect(dup.provisionedAt).toBeNull();
      expect(dup.provisionNote).toMatch(/Duplicate payment/);
    });

    it('a renewal chains after the current term so no paid days are lost', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const base = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: pkg.id, status: 'ACTIVE', startDate: daysFromNow(-20), endDate: daysFromNow(10), paymentRef: 'old' } });
      const { payment } = await pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION_RENEWAL', subscriptionId: base.id, msisdn: PHONE });
      expect(payment.amount).toBe(50000);
      fake.succeed(await refOf(payment.id));
      await pay.verifyPayment(payment.id);
      const renewed = await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: payment.targetId } });
      expect(renewed.status).toBe('ACTIVE');
      expect(Math.abs(renewed.endDate.getTime() - daysFromNow(40).getTime())).toBeLessThan(2 * 60_000);
      expect(Math.abs(renewed.startDate.getTime() - base.endDate.getTime())).toBeLessThan(2 * 60_000);
    });

    it('prices a request from what it snapshotted, not from a package the admin has since repriced', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      await prisma.sellerPackage.update({ where: { id: pkg.id }, data: { price: 90000 } });
      expect(payment.amount).toBe(50000);
      const again = await buy(u, pkg.id); // retry resumes the same pending payment at the agreed price
      expect(again.payment.amount).toBe(50000);
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.provisionedAt).not.toBeNull();
      expect((await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: payment.targetId } })).status).toBe('ACTIVE');
    });

    it.each(['IMMEDIATE', 'AFTER_EXPIRY'] as const)('an upgrade (%s) is paid at the new package price and activates per its mode', async (mode) => {
      const u = await mkUser(prisma);
      const small = await mkPackage({ price: 50000, maxListings: 25 });
      const big = await mkPackage({ price: 120000, maxListings: 100, durationDays: 30 });
      const cur = await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: small.id, status: 'ACTIVE', startDate: daysFromNow(-10), endDate: daysFromNow(20), paymentRef: 'old', ...subSvc.packageSnapshot({ ...small, maxListings: 25 }) } });
      const { payment } = await pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION_UPGRADE', packageId: big.id, upgradeMode: mode, msisdn: PHONE });
      expect(payment).toMatchObject({ purpose: 'SUBSCRIPTION_UPGRADE', amount: 120000 });
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.provisionedAt).not.toBeNull();
      const up = await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: payment.targetId } });
      const old = await prisma.sellerSubscription.findUniqueOrThrow({ where: { id: cur.id } });
      expect(up.status).toBe('ACTIVE');
      if (mode === 'IMMEDIATE') {
        expect(old.status).toBe('CANCELLED');
        expect(Math.abs(up.startDate.getTime() - Date.now())).toBeLessThan(2 * 60_000);
      } else {
        expect(old.status).toBe('ACTIVE');
        expect(Math.abs(up.startDate.getTime() - cur.endDate.getTime())).toBeLessThan(2 * 60_000);
      }
    });

    it('an upgrade needs a valid mode and a real upgrade', async () => {
      const u = await mkUser(prisma);
      const small = await mkPackage({ price: 50000, maxListings: 25 });
      await prisma.sellerSubscription.create({ data: { userId: u.id, packageId: small.id, status: 'ACTIVE', startDate: daysFromNow(-10), endDate: daysFromNow(20), paymentRef: 'old', ...subSvc.packageSnapshot({ ...small, maxListings: 25 }) } });
      await expect(pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION_UPGRADE', packageId: small.id, upgradeMode: 'SOON', msisdn: PHONE })).rejects.toMatchObject({ statusCode: 400 });
      await expect(pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION_UPGRADE', packageId: small.id, upgradeMode: 'IMMEDIATE', msisdn: PHONE })).rejects.toMatchObject({ statusCode: 400 });
      expect(await prisma.paymentTransaction.count()).toBe(0);
    });

    it('rejects what cannot be paid for: free, CV-scope, inactive, someone else\'s, non-UGX', async () => {
      const u = await mkUser(prisma); const other = await mkUser(prisma);
      await expect(buy(u, (await mkPackage({ isFree: true, price: 0 })).id)).rejects.toMatchObject({ statusCode: 400 });
      await expect(buy(u, (await mkPackage({ scope: 'CV' })).id)).rejects.toMatchObject({ statusCode: 400 });
      await expect(buy(u, (await mkPackage({ isActive: false })).id)).rejects.toMatchObject({ statusCode: 404 });
      await expect(buy(u, (await mkPackage({ currency: 'KES' })).id)).rejects.toMatchObject({ statusCode: 400 });
      await expect(buy(u, 'no-such-package')).rejects.toMatchObject({ statusCode: 404 });
      const pkg = await mkPackage();
      const theirs = await prisma.sellerSubscription.create({ data: { userId: other.id, packageId: pkg.id, status: 'ACTIVE', startDate: new Date(), endDate: daysFromNow(5) } });
      await expect(pay.initiatePayment(actorOf(u), { purpose: 'SUBSCRIPTION_RENEWAL', subscriptionId: theirs.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 404 });
      await expect(pay.initiatePayment({ userId: null }, { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 401 });
      expect(await prisma.paymentTransaction.count()).toBe(0);
      expect(fake.requests).toHaveLength(0);
    });
  });

  // ─── Phone / provider handling ────────────────────────────────────────────

  describe('payer number and MTN request handling', () => {
    it('rejects an invalid number before anything is created', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      await expect(buy(u, pkg.id, '12345')).rejects.toMatchObject({ statusCode: 400 });
      await expect(buy(u, pkg.id, null)).rejects.toMatchObject({ statusCode: 400 });
      expect(await prisma.sellerSubscription.count()).toBe(0);
    });

    it('an inactive MoMo account is refused up front (no payment row, no prompt)', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      fake.accountActive = false;
      await expect(buy(u, pkg.id)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not an active MTN/) });
      expect(await prisma.paymentTransaction.count()).toBe(0);
      expect(fake.requests).toHaveLength(0);
    });

    it('if the account pre-check itself is unavailable the payment still goes ahead', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      fake.accountCheckThrows = true;
      expect((await buy(u, pkg.id)).payment.status).toBe('PENDING');
      expect(fake.requests).toHaveLength(1);
    });

    it('a request MTN rejects is recorded FAILED and reported; the user can try again', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      fake.requestMode = 'reject';
      await expect(buy(u, pkg.id)).rejects.toMatchObject({ statusCode: 400 });
      const r = await prisma.paymentTransaction.findFirstOrThrow({ where: { userId: u.id } });
      expect(r).toMatchObject({ status: 'FAILED', failureReason: 'REQUEST_REJECTED_400' });
      fake.requestMode = 'ok';
      expect((await buy(u, pkg.id)).payment.status).toBe('PENDING');
    });

    it('a request that gets no answer stays PENDING (MTN may have it); if MTN never heard of it, it fails later', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      fake.requestMode = 'network';
      const { payment } = await buy(u, pkg.id);
      expect(payment.status).toBe('PENDING');
      // MTN says 404 right away: too early to conclude anything
      expect((await pay.verifyPayment(payment.id)).status).toBe('PENDING');
      await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
      const failed = await pay.verifyPayment(payment.id);
      expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'NOT_FOUND_AT_PROVIDER' });
    });

    it('gives up on a prompt nobody approved, frees the item for a fresh attempt, and still honours a very late approval', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const first = (await buy(u, pkg.id)).payment;
      await prisma.paymentTransaction.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
      expect((await pay.verifyPayment(first.id)).status).toBe('EXPIRED');

      const second = (await buy(u, pkg.id)).payment;
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('PENDING');

      // the payer approves the FIRST prompt after all
      fake.succeed(await refOf(first.id));
      const late = await pay.verifyPayment(first.id);
      expect(late.status).toBe('SUCCESSFUL');
      expect(late.provisionedAt).not.toBeNull();
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
    });

    it('does not take a second payment while one has been received but not yet turned into access', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      fake.succeed(await refOf(payment.id));
      // simulate a worker holding the lease (access being granted)
      await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', provisioningStartedAt: new Date() } });
      expect((await pay.verifyPayment(payment.id)).provisionedAt).toBeNull(); // lease held: nobody else provisions
      await expect(buy(u, pkg.id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already been received/) });
      // the lease expires (worker died) -> next verification provisions
      await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { provisioningStartedAt: new Date(Date.now() - 3 * 60_000) } });
      expect((await pay.verifyPayment(payment.id)).provisionedAt).not.toBeNull();
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
    });

    it('is unavailable (503) when MTN_ENABLED is off', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      process.env.MTN_ENABLED = 'false';
      await expect(buy(u, pkg.id)).rejects.toMatchObject({ statusCode: 503 });
      expect(await prisma.sellerSubscription.count()).toBe(0);
    });

    it('after an admin switches MoMo OFF, new payments are refused but MTN\'s callback for one already approved still credits it', async () => {
      const cfg = await import('./utils/momo/config');
      const u = await mkUser(prisma); const other = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);               // the prompt was pushed while MoMo was on
      const ref = await refOf(payment.id);
      cfg.setMomoAdminSwitch(false);                          // an admin switches MoMo off
      try {
        await expect(buy(other, pkg.id)).rejects.toMatchObject({ statusCode: 503 }); // no NEW payments
        fake.succeed(ref);                                    // the customer approves after the switch went off
        await pay.handleCallback(ref, rules.signCallback(ref, SECRET)); // MTN's callback is still accepted
        expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
        expect((await row(payment.id)).provisionedAt).not.toBeNull();
      } finally { cfg.setMomoAdminSwitch(null); }
    });
  });

  // ─── Callback ─────────────────────────────────────────────────────────────

  describe('callback', () => {
    it('rejects a bad signature and an unknown reference; a good one makes us ask MTN and settle', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      const ref = await refOf(payment.id);
      await expect(pay.handleCallback(ref, 'forged')).rejects.toMatchObject({ statusCode: 403 });
      await expect(pay.handleCallback(ref, undefined)).rejects.toMatchObject({ statusCode: 403 });
      await expect(pay.handleCallback('unknown-ref', rules.signCallback('unknown-ref', SECRET))).rejects.toMatchObject({ statusCode: 404 });
      expect(fake.statusCalls).toBe(0); // forged callbacks never even reach MTN

      fake.succeed(ref);
      await pay.handleCallback(ref, rules.signCallback(ref, SECRET));
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
    });

    it('a signed callback cannot mark anything paid by itself — MTN is always the source of truth', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      const ref = await refOf(payment.id);
      await pay.handleCallback(ref, rules.signCallback(ref, SECRET)); // MTN still says PENDING
      expect((await row(payment.id)).status).toBe('PENDING');
      expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('PENDING_PAYMENT');
    });
  });

  // ─── Visibility / authorisation ───────────────────────────────────────────

  describe('who can see a payment', () => {
    it('the owner and admins can; other users get a 404', async () => {
      const u = await mkUser(prisma); const stranger = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      expect((await pay.getPaymentForActor(payment.id, actorOf(u))).id).toBe(payment.id);
      expect((await pay.getPaymentForActor(payment.id, { userId: stranger.id, role: 'ADMIN' })).id).toBe(payment.id);
      await expect(pay.getPaymentForActor(payment.id, actorOf(stranger))).rejects.toMatchObject({ statusCode: 404 });
      await expect(pay.getPaymentForActor(payment.id, { userId: null })).rejects.toMatchObject({ statusCode: 404 });
      await expect(pay.getPaymentForActor('nope', actorOf(u))).rejects.toMatchObject({ statusCode: 404 });
    });

    it('polling the status refreshes from MTN, but no more than once every few seconds', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      const t0 = new Date();
      await pay.getPaymentForActor(payment.id, actorOf(u), undefined, t0);
      const calls = fake.statusCalls;
      await pay.getPaymentForActor(payment.id, actorOf(u), undefined, new Date(t0.getTime() + 1000));
      expect(fake.statusCalls).toBe(calls); // throttled
      fake.succeed(await refOf(payment.id));
      const view = await pay.getPaymentForActor(payment.id, actorOf(u), undefined, new Date(Date.now() + 10_000));
      expect(view.completed).toBe(true);
    });
  });

  // ─── Store rentals ────────────────────────────────────────────────────────

  describe('store payments', () => {
    it('a paid first application is marked paid and queued for admin approval — it is NOT auto-approved', async () => {
      const admin = await mkUser(prisma, { role: 'ADMIN' });
      const owner = await mkUser(prisma);
      const rental = await prisma.storeRental.create({ data: { userId: owner.id, status: 'PENDING', tier: 'GOLD', fee: 150000, endDate: daysFromNow(30), placements: { storeName: 'Kampala Gadgets', paymentStatus: 'PENDING' } } });
      const { payment } = await pay.initiatePayment(actorOf(owner), { purpose: 'STORE_RENTAL', rentalId: rental.id, msisdn: PHONE });
      expect(payment.amount).toBe(150000);
      expect(fake.last().amount).toBe('150000');
      fake.succeed(await refOf(payment.id));
      await pay.verifyPayment(payment.id);

      const after = await prisma.storeRental.findUniqueOrThrow({ where: { id: rental.id } });
      expect(after.status).toBe('PENDING'); // admin approval (KYC / content review) is unchanged
      expect(after.placements).toMatchObject({ storeName: 'Kampala Gadgets', paymentStatus: 'CONFIRMED', paymentRef: (await row(payment.id)).referenceId });
      expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Paid store application' } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: owner.id, title: 'Store payment received' } })).toBe(1);
      await expect(pay.initiatePayment(actorOf(owner), { purpose: 'STORE_RENTAL', rentalId: rental.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects paying for someone else\'s application, a free fee, or an already-active store', async () => {
      const owner = await mkUser(prisma); const other = await mkUser(prisma);
      const mine = await prisma.storeRental.create({ data: { userId: owner.id, status: 'PENDING', fee: 60000, endDate: daysFromNow(30) } });
      await expect(pay.initiatePayment(actorOf(other), { purpose: 'STORE_RENTAL', rentalId: mine.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 404 });
      const free = await prisma.storeRental.create({ data: { userId: other.id, status: 'PENDING', fee: 0, endDate: daysFromNow(30) } });
      await expect(pay.initiatePayment(actorOf(other), { purpose: 'STORE_RENTAL', rentalId: free.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 400 });
      const active = await mkUser(prisma);
      const live = await prisma.storeRental.create({ data: { userId: active.id, status: 'ACTIVE', fee: 60000, endDate: daysFromNow(30) } });
      await expect(pay.initiatePayment(actorOf(active), { purpose: 'STORE_RENTAL', rentalId: live.id, msisdn: PHONE })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('a paid renewal confirms through the existing renewal logic: new end date, tier, store open, nothing left pending', async () => {
      const owner = await mkUser(prisma, { role: 'SELLER' });
      const newEnd = daysFromNow(35);
      const rental = await prisma.storeRental.create({
        data: {
          userId: owner.id, status: 'ACTIVE', tier: 'FREE', fee: 60000, endDate: daysFromNow(5),
          placements: { storeName: 'Shop', pendingRenewal: { plan: 'MONTHLY', tier: 'GOLD', newEndDate: newEnd.toISOString(), fee: 150000, currency: 'UGX' } },
        },
      });
      const { payment } = await pay.initiatePayment(actorOf(owner), { purpose: 'STORE_RENEWAL', rentalId: rental.id, msisdn: PHONE });
      expect(payment.amount).toBe(150000); // the renewal's fee, not the old rental fee
      fake.succeed(await refOf(payment.id));
      expect((await pay.verifyPayment(payment.id)).provisionedAt).not.toBeNull();

      const after = await prisma.storeRental.findUniqueOrThrow({ where: { id: rental.id } });
      expect(after).toMatchObject({ status: 'ACTIVE', tier: 'GOLD', fee: 150000 });
      expect(after.endDate.getTime()).toBe(newEnd.getTime());
      expect(after.placements).toMatchObject({ pendingRenewal: null, paymentStatus: 'CONFIRMED', subscriptionPlan: 'MONTHLY' });
      expect((await prisma.store.findUnique({ where: { userId: owner.id } }))?.isActive).toBe(true);
    });

    it('if the renewal was changed after the payment started, the money goes to review instead of buying the wrong thing', async () => {
      const owner = await mkUser(prisma, { role: 'SELLER' });
      const rental = await prisma.storeRental.create({
        data: { userId: owner.id, status: 'ACTIVE', tier: 'FREE', endDate: daysFromNow(5), placements: { pendingRenewal: { plan: 'MONTHLY', tier: 'GOLD', newEndDate: daysFromNow(35).toISOString(), fee: 150000, currency: 'UGX' } } },
      });
      const { payment } = await pay.initiatePayment(actorOf(owner), { purpose: 'STORE_RENEWAL', rentalId: rental.id, msisdn: PHONE });
      await prisma.storeRental.update({ where: { id: rental.id }, data: { placements: { pendingRenewal: { plan: 'YEARLY', tier: 'PLATINUM', newEndDate: daysFromNow(370).toISOString(), fee: 400000, currency: 'UGX' } } } });
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled).toMatchObject({ status: 'NEEDS_REVIEW', provisionedAt: null });
      expect((await prisma.storeRental.findUniqueOrThrow({ where: { id: rental.id } })).tier).toBe('FREE');
    });
  });

  // ─── Listing tiers ────────────────────────────────────────────────────────

  describe('listing visibility tiers', () => {
    // The platform has no built-in tier prices: the admin sets them in Site Config → Tier Pricing.
    const PRICING = { currency: 'UGX', listingGoldPrice: 20000, listingPlatinumPrice: 50000, listingTierDurationDays: 30 };
    beforeEach(async () => {
      await prisma.siteConfig.upsert({ where: { id: 'global' }, create: { id: 'global', tierPricing: PRICING }, update: { tierPricing: PRICING } });
    });
    async function seller() {
      const u = await mkUser(prisma); const cat = await mkCategory(prisma, `c-${Math.random().toString(36).slice(2, 8)}`);
      const listing = await mkListing(prisma, u.id, cat.id, { requestedTier: 'GOLD' });
      return { u, listing };
    }
    const buyTier = (u: { id: string }, listingId: string, tier: unknown) => pay.initiatePayment(actorOf(u), { purpose: 'LISTING_TIER', listingId, tier, msisdn: PHONE });

    it('GOLD at the configured price: tier set, expiry in 30 days, request cleared, owner notified', async () => {
      const { u, listing } = await seller();
      const { payment } = await buyTier(u, listing.id, 'gold');
      expect(payment.amount).toBe(20000);
      expect(fake.last().amount).toBe('20000');
      fake.succeed(await refOf(payment.id));
      await pay.verifyPayment(payment.id);
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after).toMatchObject({ tier: 'GOLD', requestedTier: null });
      expect(Math.abs(after.tierExpiresAt!.getTime() - daysFromNow(30).getTime())).toBeLessThan(2 * 60_000);
      expect(await prisma.notification.count({ where: { userId: u.id, title: 'Gold visibility activated' } })).toBe(1);
    });

    it('uses the admin-set pricing and duration, snapshotting the duration at purchase time', async () => {
      const { u, listing } = await seller();
      await prisma.siteConfig.upsert({ where: { id: 'global' }, create: { id: 'global', tierPricing: { listingPlatinumPrice: 75000, listingTierDurationDays: 14 } }, update: { tierPricing: { listingPlatinumPrice: 75000, listingTierDurationDays: 14 } } });
      const { payment } = await buyTier(u, listing.id, 'PLATINUM');
      expect(payment.amount).toBe(75000);
      // admin changes the duration while the payer is entering their PIN: the buyer still gets what was advertised
      await prisma.siteConfig.update({ where: { id: 'global' }, data: { tierPricing: { listingPlatinumPrice: 75000, listingTierDurationDays: 90 } } });
      fake.succeed(await refOf(payment.id));
      await pay.verifyPayment(payment.id);
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.tier).toBe('PLATINUM');
      expect(Math.abs(after.tierExpiresAt!.getTime() - daysFromNow(14).getTime())).toBeLessThan(2 * 60_000);
    });

    it('refuses invalid tiers, equal-or-lower tiers, other people\'s listings, admins, rejected listings and store owners', async () => {
      const { u, listing } = await seller();
      await expect(buyTier(u, listing.id, 'FREE')).rejects.toMatchObject({ statusCode: 400 });
      await expect(buyTier(u, listing.id, undefined)).rejects.toMatchObject({ statusCode: 400 });
      const stranger = await mkUser(prisma);
      await expect(buyTier(stranger, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 404 });
      await expect(pay.initiatePayment({ userId: u.id, role: 'ADMIN' }, { purpose: 'LISTING_TIER', listingId: listing.id, tier: 'GOLD', msisdn: PHONE })).rejects.toMatchObject({ statusCode: 400 });
      await prisma.listing.update({ where: { id: listing.id }, data: { tier: 'PLATINUM' } });
      await expect(buyTier(u, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 409 });
      await expect(buyTier(u, listing.id, 'PLATINUM')).rejects.toMatchObject({ statusCode: 409 });
      await prisma.listing.update({ where: { id: listing.id }, data: { tier: 'FREE', status: 'REJECTED' } });
      await expect(buyTier(u, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 409 });
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } });
      await prisma.storeRental.create({ data: { userId: u.id, status: 'ACTIVE', endDate: daysFromNow(30) } });
      await expect(buyTier(u, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('never downgrades a listing that was upgraded while the payment was in flight', async () => {
      const { u, listing } = await seller();
      const { payment } = await buyTier(u, listing.id, 'GOLD');
      await prisma.listing.update({ where: { id: listing.id }, data: { tier: 'PLATINUM', tierExpiresAt: daysFromNow(60) } });
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.provisionedAt).not.toBeNull();
      expect(settled.provisionNote).toMatch(/already had/);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).tier).toBe('PLATINUM');
    });

    it('a listing that is still PENDING approval can be paid for: the tier is recorded and the seller is told it starts on approval', async () => {
      const { u, listing } = await seller();
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PENDING' } });
      const { payment } = await buyTier(u, listing.id, 'gold');           // used to fail with "A pending listing cannot be promoted."
      expect(payment.amount).toBe(20000);
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.status).toBe('SUCCESSFUL');
      expect(settled.provisionedAt).not.toBeNull();
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after).toMatchObject({ tier: 'GOLD', requestedTier: null, status: 'PENDING' });
      expect((settled.metadata as Record<string, unknown>).awaitingApproval).toBe(true);
      expect(await prisma.notification.count({ where: { userId: u.id, title: 'Gold visibility paid' } })).toBe(1);
    });

    it('approving the listing restarts the paid period so no paid days are spent while it was invisible (once only)', async () => {
      const { startPaidTierOnApproval } = await import('./utils/listingTierClock');
      const { u, listing } = await seller();
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PENDING' } });
      const { payment } = await buyTier(u, listing.id, 'gold');
      fake.succeed(await refOf(payment.id));
      await pay.verifyPayment(payment.id);
      // still pending: nothing to restart yet, the marker stays
      expect(await startPaidTierOnApproval([listing.id])).toBe(0);
      expect(((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).metadata as Record<string, unknown>).awaitingApproval).toBe(true);
      // the payment was made 10 days "ago" in terms of the running window
      await prisma.listing.update({ where: { id: listing.id }, data: { tierExpiresAt: daysFromNow(20) } });
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'ACTIVE' } });
      expect(await startPaidTierOnApproval([listing.id])).toBe(1);
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(Math.abs(after.tierExpiresAt!.getTime() - daysFromNow(30).getTime())).toBeLessThan(2 * 60_000);
      expect(((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).metadata as Record<string, unknown>).awaitingApproval).toBe(false);
      // a later re-approval (e.g. after an edit) must NOT extend it again
      await prisma.listing.update({ where: { id: listing.id }, data: { tierExpiresAt: daysFromNow(12) } });
      expect(await startPaidTierOnApproval([listing.id])).toBe(0);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).tierExpiresAt!.getTime()).toBeLessThan(daysFromNow(13).getTime());
    });

    it('still refuses hidden, sold and expired listings, and a payment that lands after the ad was rejected goes to manual review', async () => {
      const { u, listing } = await seller();
      for (const status of ['HIDDEN', 'SOLD', 'EXPIRED'] as const) {
        await prisma.listing.update({ where: { id: listing.id }, data: { status } });
        await expect(buyTier(u, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 409 });
      }
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PENDING' } });
      const { payment } = await buyTier(u, listing.id, 'GOLD');
      await prisma.listing.update({ where: { id: listing.id }, data: { status: 'REJECTED' } });   // moderator rejects while the PIN is being entered
      fake.succeed(await refOf(payment.id));
      const settled = await pay.verifyPayment(payment.id);
      expect(settled.status).toBe('NEEDS_REVIEW');
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).tier).toBe('FREE');
    });

    it('an unset tier price is simply not offered', async () => {
      await prisma.siteConfig.update({ where: { id: 'global' }, data: { tierPricing: { currency: 'UGX', listingGoldPrice: null, listingPlatinumPrice: 50000, listingTierDurationDays: 30 } } });
      const { u, listing } = await seller();
      await expect(buyTier(u, listing.id, 'GOLD')).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/no price/) });
      expect((await buyTier(u, listing.id, 'PLATINUM')).payment.amount).toBe(50000);
    });

    it('a different tier request while one is in flight is refused rather than mixed up', async () => {
      const { u, listing } = await seller();
      await buyTier(u, listing.id, 'GOLD');
      await expect(buyTier(u, listing.id, 'PLATINUM')).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/in progress/) });
    });
  });

  // ─── CV downloads ─────────────────────────────────────────────────────────

  describe('CV download payments (guests included)', () => {
    async function mkToken(over: Record<string, unknown> = {}) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const token = await prisma.cvDownloadToken.create({ data: { tokenHash: sha256(rawToken), paid: false, amount: 5000, currency: 'UGX', country: 'UGANDA', expiresAt: daysFromNow(1), ...over } });
      return { rawToken, token };
    }
    const buyCv = (actor: { userId: string | null; role?: string }, tokenId: string, rawToken: unknown) =>
      pay.initiatePayment(actor, { purpose: 'CV_DOWNLOAD', tokenId, rawToken, msisdn: PHONE });

    it('a guest pays with the token secret and the download unlocks after MTN confirms', async () => {
      const { rawToken, token } = await mkToken();
      const { payment } = await buyCv({ userId: null }, token.id, rawToken);
      expect(payment.amount).toBe(5000);
      expect((await row(payment.id)).userId).toBeNull();
      expect((await prisma.cvDownloadToken.findUniqueOrThrow({ where: { id: token.id } })).paid).toBe(false);

      // the guest can poll with the same secret; nobody else can
      await expect(pay.getPaymentForActor(payment.id, { userId: null })).rejects.toMatchObject({ statusCode: 404 });
      await expect(pay.getPaymentForActor(payment.id, { userId: null }, 'wrong')).rejects.toMatchObject({ statusCode: 404 });
      fake.succeed(await refOf(payment.id));
      const view = await pay.getPaymentForActor(payment.id, { userId: null }, rawToken, new Date(Date.now() + 10_000));
      expect(view.completed).toBe(true);
      expect((await prisma.cvDownloadToken.findUniqueOrThrow({ where: { id: token.id } })).paid).toBe(true);
    });

    it('refuses a wrong secret, an already-paid token and an expired one; never trusts the amount from the client', async () => {
      const { rawToken, token } = await mkToken();
      await expect(buyCv({ userId: null }, token.id, 'not-the-secret')).rejects.toMatchObject({ statusCode: 404 });
      const paid = await mkToken({ paid: true });
      await expect(buyCv({ userId: null }, paid.token.id, paid.rawToken)).rejects.toMatchObject({ statusCode: 409 });
      const old = await mkToken({ expiresAt: new Date(Date.now() - 1000) });
      await expect(buyCv({ userId: null }, old.token.id, old.rawToken)).rejects.toMatchObject({ statusCode: 410 });
      const free = await mkToken({ amount: 0 });
      await expect(buyCv({ userId: null }, free.token.id, free.rawToken)).rejects.toMatchObject({ statusCode: 400 });
      const foreign = await mkToken({ currency: 'KES' });
      await expect(buyCv({ userId: null }, foreign.token.id, foreign.rawToken)).rejects.toMatchObject({ statusCode: 400 });
      expect(fake.requests).toHaveLength(0);
      // the charged amount is always the token's (admin-package) price
      await buyCv({ userId: null }, token.id, rawToken);
      expect(fake.last().amount).toBe('5000');
    });

    it('a logged-in payer\'s payment is theirs: visible to them, tied to their account', async () => {
      const u = await mkUser(prisma);
      const { rawToken, token } = await mkToken({ userId: u.id });
      const { payment } = await buyCv(actorOf(u), token.id, rawToken);
      expect((await row(payment.id)).userId).toBe(u.id);
      expect((await pay.getPaymentForActor(payment.id, actorOf(u))).id).toBe(payment.id);
    });

    it('a token that expired before the payment landed goes to review', async () => {
      const { rawToken, token } = await mkToken();
      const { payment } = await buyCv({ userId: null }, token.id, rawToken);
      await prisma.cvDownloadToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      fake.succeed(await refOf(payment.id));
      expect((await pay.verifyPayment(payment.id)).status).toBe('NEEDS_REVIEW');
    });
  });

  // ─── Admin & database guarantees ──────────────────────────────────────────

  describe('admin tools and database guarantees', () => {
    it('lists/filters payments and lets an admin resolve a payment that was handled by hand', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      fake.succeed(await refOf(payment.id), { amount: '5' });
      await pay.verifyPayment(payment.id); // -> NEEDS_REVIEW
      const list = await pay.listPayments({ status: 'NEEDS_REVIEW' });
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({ id: payment.id, status: 'NEEDS_REVIEW', msisdn: '256******456' });
      expect((await pay.listPayments({ status: 'PENDING' })).total).toBe(0);
      expect((await pay.listPayments({ purpose: 'SUBSCRIPTION', search: (await refOf(payment.id)) })).total).toBe(1);
      expect((await pay.listPayments({ status: "'; DROP TABLE" })).total).toBe(1); // unknown filter values are ignored, never executed

      await expect(pay.resolveReviewedPayment(payment.id, '  ', 'admin-1', 'GRANTED')).rejects.toMatchObject({ statusCode: 400 });
      await expect(pay.resolveReviewedPayment(payment.id, 'x', 'admin-1', undefined)).rejects.toMatchObject({ statusCode: 400 });
      const resolved = await pay.resolveReviewedPayment(payment.id, 'refunded manually', 'admin-1', 'REFUNDED');
      expect(resolved.status).toBe('REFUNDED');
      expect(resolved.completed).toBe(false); // a refund is never "granted"
      expect((await row(payment.id)).provisionedAt).toBeNull();
      expect((await row(payment.id)).provisionNote).toMatch(/Refunded by admin admin-1: refunded manually/);
      await expect(pay.resolveReviewedPayment(payment.id, 'again', 'admin-1', 'GRANTED')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('the database itself allows only one PENDING attempt per item and never a provisioned unpaid payment', async () => {
      const base = { purpose: 'SUBSCRIPTION' as const, targetId: 't-1', amount: 1000, providerAmount: 1000, providerCurrency: 'EUR', msisdn: '256772123456', environment: 'sandbox' };
      await prisma.paymentTransaction.create({ data: { ...base, referenceId: crypto.randomUUID() } });
      await expect(prisma.paymentTransaction.create({ data: { ...base, referenceId: crypto.randomUUID() } })).rejects.toBeDefined();
      await prisma.paymentTransaction.create({ data: { ...base, referenceId: crypto.randomUUID(), status: 'FAILED' } }); // history is unrestricted
      await expect(prisma.paymentTransaction.create({ data: { ...base, targetId: 't-2', referenceId: crypto.randomUUID(), provisionedAt: new Date() } })).rejects.toBeDefined();
      await expect(prisma.paymentTransaction.create({ data: { ...base, targetId: 't-3', referenceId: crypto.randomUUID(), status: 'SUCCESSFUL', provisionedAt: new Date() } })).resolves.toBeDefined();
    });

    it('deleting the user or the target never deletes the financial record', async () => {
      const u = await mkUser(prisma); const pkg = await mkPackage();
      const { payment } = await buy(u, pkg.id);
      await prisma.user.delete({ where: { id: u.id } });
      expect(await prisma.paymentTransaction.count({ where: { id: payment.id } })).toBe(1);
    });
  });
});
