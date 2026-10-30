import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing, daysFromNow } from './testing/integrationDb';
import type { MomoClient, RequestToPayInput, RequestToPayStatus } from './utils/momo/client';

configureTestEnv();

const SECRET = 'd'.repeat(40);
const MOMO_ENV: Record<string, string> = {
  MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef', MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab', MTN_CALLBACK_SECRET: SECRET, API_BASE_URL: 'https://api.piitrade.test',
};

class FakeMomo implements MomoClient {
  requests: RequestToPayInput[] = [];
  private table = new Map<string, Partial<RequestToPayStatus>>();
  async validateAccountHolder() { return true; }
  async requestToPay(i: RequestToPayInput) { this.requests.push(i); this.table.set(i.referenceId, { rawStatus: 'PENDING', outcome: 'PENDING' }); }
  async getRequestToPayStatus(ref: string): Promise<RequestToPayStatus> {
    const req = this.requests.find((r) => r.referenceId === ref);
    return { rawStatus: 'PENDING', outcome: 'PENDING', reason: null, financialTransactionId: null, externalId: req?.externalId ?? null, amount: req?.amount ?? null, currency: req?.currency ?? null, ...(this.table.get(ref) ?? {}) } as RequestToPayStatus;
  }
  succeed(ref: string) { this.table.set(ref, { rawStatus: 'SUCCESSFUL', outcome: 'SUCCESSFUL', financialTransactionId: '777' }); }
}

describe.skipIf(!TEST_DB)('payment HTTP routes (real database, fake MTN)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';
  let fake: FakeMomo;
  let clientMod: typeof import('./utils/momo/client');
  let rules: typeof import('./utils/momo/rules');
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of Object.keys(MOMO_ENV)) { saved[k] = process.env[k]; process.env[k] = MOMO_ENV[k]; }
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    clientMod = await import('./utils/momo/client');
    rules = await import('./utils/momo/rules');
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    clientMod.setMomoClientForTests(null);
    for (const k of Object.keys(MOMO_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    fake = new FakeMomo();
    clientMod.setMomoClientForTests(fake);
    process.env.MTN_ENABLED = 'true';
    (await import('./utils/siteSettings')).invalidateGeneralSettings();
  });

  const auth = (u: { id: string; email: string }, role = 'SELLER') => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}` });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  };
  const mkPackage = () => prisma.sellerPackage.create({ data: { name: 'Pro', durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25 } });
  const refOf = async (paymentId: string) => (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } })).referenceId;

  it('ad pay-then-approve over HTTP: a PENDING ad can be paid for, and the admin approval starts the paid period', async () => {
    await prisma.siteConfig.upsert({ where: { id: 'global' }, create: { id: 'global', tierPricing: { currency: 'UGX', listingGoldPrice: 20000, listingPlatinumPrice: 50000, listingTierDurationDays: 30 } }, update: { tierPricing: { currency: 'UGX', listingGoldPrice: 20000, listingPlatinumPrice: 50000, listingTierDurationDays: 30 } } });
    const u = await mkUser(prisma); const admin = await mkUser(prisma, { role: 'ADMIN' });
    const cat = await mkCategory(prisma, `c-${Math.random().toString(36).slice(2, 8)}`);
    const listing = await mkListing(prisma, u.id, cat.id, { status: 'PENDING', requestedTier: 'GOLD' });

    const init = await call('POST', '/api/payments/momo/initiate', { purpose: 'LISTING_TIER', listingId: listing.id, tier: 'GOLD', msisdn: '0772123456' }, auth(u));
    expect(init.status).toBe(201);                                      // was 409 "A pending listing cannot be promoted."
    fake.succeed(await refOf(init.body.payment.id));
    const done = await call('GET', `/api/payments/${init.body.payment.id}`, undefined, auth(u));
    expect(done.body.payment.status).toBe('SUCCESSFUL');
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ tier: 'GOLD', status: 'PENDING' });

    await prisma.listing.update({ where: { id: listing.id }, data: { tierExpiresAt: daysFromNow(21) } }); // 9 days of the window "used" while pending
    const approve = await call('PUT', `/api/admin/listings/${listing.id}/approve`, { placement: 'LATEST_COLLECTIONS' }, auth(admin, 'ADMIN'));
    expect(approve.status).toBe(200);
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe('ACTIVE');
    expect(Math.abs(after.tierExpiresAt!.getTime() - daysFromNow(30).getTime())).toBeLessThan(2 * 60_000);
  });

  it('GET /config reports availability and is never cached', async () => {
    const on = await call('GET', '/api/payments/config');
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ momoEnabled: true, currency: 'UGX', environment: 'sandbox' });
    expect(on.headers.get('cache-control')).toBe('no-store');
    process.env.MTN_ENABLED = 'false';
    expect((await call('GET', '/api/payments/config')).body).toEqual({ momoEnabled: false, currency: 'UGX', environment: null });
  });

  it('initiate: validates input, requires login, ignores any client-supplied amount, and resumes on a double-tap', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' })).status).toBe(401);
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'HACK', msisdn: '0772123456' }, auth(u))).status).toBe(400);
    expect((await call('POST', '/api/payments/momo/initiate', { msisdn: '0772123456' }, auth(u))).status).toBe(400);
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: 'abc' }, auth(u))).status).toBe(400);

    const first = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456', amount: 1, currency: 'EUR', userId: 'someone-else' }, auth(u));
    expect(first.status).toBe(201);
    expect(first.body.payment).toMatchObject({ purpose: 'SUBSCRIPTION', status: 'PENDING', amount: 50000, currency: 'UGX', msisdn: '256******456', completed: false });
    expect(fake.requests[0].amount).toBe('50000');
    expect((await prisma.paymentTransaction.findFirstOrThrow()).userId).toBe(u.id);

    const second = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ resumed: true, payment: { id: first.body.payment.id } });
    expect(fake.requests).toHaveLength(1);
  });

  it('initiate answers 503 when the integration is off', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    process.env.MTN_ENABLED = 'false';
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u))).status).toBe(503);
  });

  it('the payer polls GET /:id; only the owner (or an admin) may', async () => {
    const u = await mkUser(prisma); const stranger = await mkUser(prisma); const admin = await mkUser(prisma, { role: 'ADMIN' }); const pkg = await mkPackage();
    const { body } = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u));
    const id = body.payment.id;
    expect((await call('GET', `/api/payments/${id}`, undefined, auth(u))).body.payment.status).toBe('PENDING');
    expect((await call('GET', `/api/payments/${id}`, undefined, auth(stranger))).status).toBe(404);
    expect((await call('GET', `/api/payments/${id}`)).status).toBe(404);
    expect((await call('GET', `/api/payments/${id}`, undefined, auth(admin, 'ADMIN'))).status).toBe(200);

    fake.succeed(await refOf(id));
    await new Promise((r) => setTimeout(r, 4100)); // the status endpoint throttles MTN lookups to one per ~4s
    const done = await call('GET', `/api/payments/${id}`, undefined, auth(u));
    expect(done.body.payment).toMatchObject({ status: 'SUCCESSFUL', completed: true });
    expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
  });

  it('MTN callback: accepts PUT and POST on a signed URL, rejects bad signatures, and still works during maintenance', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    const { body } = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u));
    const ref = await refOf(body.payment.id);
    const sig = rules.signCallback(ref, SECRET);

    expect((await call('PUT', `/api/payments/momo/callback/${ref}?s=forged`, { status: 'SUCCESSFUL' })).status).toBe(403);
    expect((await call('POST', `/api/payments/momo/callback/${ref}`, { status: 'SUCCESSFUL' })).status).toBe(403);
    expect((await call('PUT', `/api/payments/momo/callback/nope?s=${rules.signCallback('nope', SECRET)}`, {})).status).toBe(404);
    expect((await call('GET', `/api/payments/momo/callback/${ref}?s=${sig}`)).status).toBe(404); // not a callback method
    // a forged "SUCCESSFUL" body with a valid signature still changes nothing: MTN says PENDING
    expect((await call('PUT', `/api/payments/momo/callback/${ref}?s=${sig}`, { status: 'SUCCESSFUL' })).status).toBe(200);
    expect((await prisma.paymentTransaction.findFirstOrThrow()).status).toBe('PENDING');

    // maintenance mode: new payments are blocked, MTN's callback is not
    await prisma.siteConfig.upsert({ where: { id: 'global' }, create: { id: 'global', generalSettings: { maintenanceMode: true } }, update: { generalSettings: { maintenanceMode: true } } });
    (await import('./utils/siteSettings')).invalidateGeneralSettings();
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u))).status).toBe(503);
    fake.succeed(ref);
    expect((await call('POST', `/api/payments/momo/callback/${ref}?s=${sig}`, { whatever: 1 })).status).toBe(200);
    expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
  });

  it('guests buy a CV download with the token secret; status polling needs the same secret in the body', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const t = await prisma.cvDownloadToken.create({ data: { tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'), paid: false, amount: 5000, currency: 'UGX', country: 'UGANDA', expiresAt: daysFromNow(1) } });
    const init = await call('POST', '/api/payments/momo/initiate', { purpose: 'CV_DOWNLOAD', tokenId: t.id, rawToken, msisdn: '0772123456' });
    expect(init.status).toBe(201);
    const id = init.body.payment.id;
    expect((await call('POST', `/api/payments/${id}/status`, {})).status).toBe(404);
    expect((await call('POST', `/api/payments/${id}/status`, { rawToken: 'wrong' })).status).toBe(404);
    expect((await call('GET', `/api/payments/${id}`)).status).toBe(404);
    const ok = await call('POST', `/api/payments/${id}/status`, { rawToken });
    expect(ok.status).toBe(200);
    expect(ok.body.payment).toMatchObject({ purpose: 'CV_DOWNLOAD', status: 'PENDING' });
    expect((await call('POST', '/api/payments/momo/initiate', { purpose: 'CV_DOWNLOAD', tokenId: t.id, rawToken: 'wrong', msisdn: '0772123456' })).status).toBe(404);
  });

  it('CV: a browser can never self-confirm a download, with MoMo on or off', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const t = await prisma.cvDownloadToken.create({ data: { tokenHash: hash, paid: false, amount: 5000, currency: 'UGX', country: 'UGANDA', expiresAt: daysFromNow(1) } });

    const blocked = await call('POST', '/api/cv-payment/confirm', { rawToken });
    expect(blocked.status).toBe(403);
    expect((await prisma.cvDownloadToken.findUniqueOrThrow({ where: { id: t.id } })).paid).toBe(false);

    // MoMo is the only payment method, so the browser stays locked out even with MoMo switched off.
    process.env.MTN_ENABLED = 'false';
    expect((await call('POST', '/api/cv-payment/confirm', { rawToken })).status).toBe(403);
    expect((await prisma.cvDownloadToken.findUniqueOrThrow({ where: { id: t.id } })).paid).toBe(false);
  });

  it('admin endpoints: list, force re-check and resolve — all closed to non-admins', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' }); const u = await mkUser(prisma); const pkg = await mkPackage();
    const { body } = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u));
    const id = body.payment.id;

    expect((await call('GET', '/api/payments/admin/list')).status).toBe(401);
    expect((await call('GET', '/api/payments/admin/list', undefined, auth(u))).status).toBe(403);
    expect((await call('POST', `/api/payments/admin/${id}/verify`, {}, auth(u))).status).toBe(403);
    expect((await call('POST', `/api/payments/admin/${id}/resolve`, { note: 'x' }, auth(u))).status).toBe(403);

    const list = await call('GET', '/api/payments/admin/list?status=PENDING&limit=10', undefined, auth(admin, 'ADMIN'));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ id, referenceId: expect.any(String), environment: 'sandbox', msisdn: '256******456' }] });
    expect(JSON.stringify(list.body)).not.toContain('256772123456'); // full numbers never leave the server

    fake.succeed(await refOf(id));
    expect((await call('POST', `/api/payments/admin/${id}/verify`, {}, auth(admin, 'ADMIN'))).body.payment.completed).toBe(true);
    expect((await call('POST', `/api/payments/admin/${id}/resolve`, { note: 'n/a', outcome: 'GRANTED' }, auth(admin, 'ADMIN'))).status).toBe(409); // only NEEDS_REVIEW can be resolved
    expect((await call('POST', '/api/payments/admin/missing/verify', {}, auth(admin, 'ADMIN'))).status).toBe(404);
  });
});
