import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser } from './testing/integrationDb';
import type { MomoClient, RequestToPayInput, RequestToPayStatus } from './utils/momo/client';

configureTestEnv();

// Capture receipt emails instead of sending them; everything else in the email module stays real.
vi.mock('./utils/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('./utils/email')>();
  return { ...real, sendPaymentReceiptEmail: vi.fn(async () => {}) };
});

const MOMO_ENV: Record<string, string> = {
  MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef', MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab', MTN_CALLBACK_SECRET: 'e'.repeat(40), API_BASE_URL: 'https://api.piitrade.test',
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
  succeed(ref: string) { this.table.set(ref, { rawStatus: 'SUCCESSFUL', outcome: 'SUCCESSFUL', financialTransactionId: '987654321' }); }
}

describe.skipIf(!TEST_DB)('payment receipts (real database, fake MTN)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';
  let fake: FakeMomo;
  let clientMod: typeof import('./utils/momo/client');
  let receipt: typeof import('./utils/momo/receipt');
  let emailMod: typeof import('./utils/email');
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of Object.keys(MOMO_ENV)) { saved[k] = process.env[k]; process.env[k] = MOMO_ENV[k]; }
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    clientMod = await import('./utils/momo/client');
    receipt = await import('./utils/momo/receipt');
    emailMod = await import('./utils/email');
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
    vi.mocked(emailMod.sendPaymentReceiptEmail).mockReset();
    vi.mocked(emailMod.sendPaymentReceiptEmail).mockResolvedValue(undefined);
    (await import('./utils/siteSettings')).invalidateGeneralSettings();
  });

  const auth = (u: { id: string; email: string }, role = 'SELLER') => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}` });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, res, body: await res.clone().json().catch(() => null) };
  };
  const mkPackage = () => prisma.sellerPackage.create({ data: { name: 'Pro', durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25 } });

  /** Start a subscription payment for `user`, have MTN approve it, and let an admin trigger the check. */
  async function paidBy(user: { id: string; email: string }, admin: { id: string; email: string }, msisdn = '0772123456') {
    const pkg = await mkPackage();
    const started = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn }, auth(user));
    expect(started.status).toBe(201);
    const id = started.body.payment.id as string;
    fake.succeed((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).referenceId);
    const v = await call('POST', `/api/payments/admin/${id}/verify`, {}, auth(admin, 'ADMIN'));
    expect(v.status).toBe(200);
    return id;
  }

  it('a completed payment gets its own tracking code and the PDF is emailed once', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const u1 = await mkUser(prisma); const u2 = await mkUser(prisma);
    const id1 = await paidBy(u1, admin);
    const id2 = await paidBy(u2, admin, '0782123456');

    const r1 = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: id1 } });
    const r2 = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: id2 } });
    expect(r1.receiptNumber).toMatch(receipt.RECEIPT_CODE_RE);
    expect(r1.receiptNumber!.startsWith('TST-')).toBe(true); // sandbox payments are clearly TEST receipts
    expect(r2.receiptNumber).toMatch(receipt.RECEIPT_CODE_RE);
    expect(r1.receiptNumber).not.toBe(r2.receiptNumber);
    expect(r1.receiptEmailedAt).not.toBeNull();

    const send = vi.mocked(emailMod.sendPaymentReceiptEmail);
    expect(send).toHaveBeenCalledTimes(2);
    const [to, , data, pdf] = send.mock.calls[0];
    expect(to).toBe(u1.email);
    expect(data).toMatchObject({ receiptNumber: r1.receiptNumber, isTest: true, amountText: 'UGX 50,000' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);

    // issuing again is a no-op: same code, no second email
    const again = await receipt.issueReceipt(id1);
    expect(again?.receiptNumber).toBe(r1.receiptNumber);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('no receipt for a payment that has not completed', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    const started = await call('POST', '/api/payments/momo/initiate', { purpose: 'SUBSCRIPTION', packageId: pkg.id, msisdn: '0772123456' }, auth(u));
    const id = started.body.payment.id as string;
    expect(await receipt.issueReceipt(id)).toBeNull();
    expect((await call('GET', '/api/payments/receipts', undefined, auth(u))).body.receipts).toEqual([]);
    expect((await call('GET', `/api/payments/${id}/receipt.pdf`, undefined, auth(u))).status).toBe(409);
    expect(vi.mocked(emailMod.sendPaymentReceiptEmail)).not.toHaveBeenCalled();
  });

  it('the profile lists my receipts and downloads a real PDF; strangers cannot', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const u = await mkUser(prisma); const stranger = await mkUser(prisma);
    const id = await paidBy(u, admin);
    const code = (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).receiptNumber!;

    expect((await call('GET', '/api/payments/receipts')).status).toBe(401);
    const mine = await call('GET', '/api/payments/receipts', undefined, auth(u));
    expect(mine.body.receipts).toHaveLength(1);
    expect(mine.body.receipts[0]).toMatchObject({ paymentId: id, receiptNumber: code, amount: 50000, currency: 'UGX', emailed: true, isTest: true });
    expect((await call('GET', '/api/payments/receipts', undefined, auth(stranger))).body.receipts).toEqual([]);

    const pdfRes = await fetch(`${base}/api/payments/${id}/receipt.pdf`, { headers: auth(u) });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    expect(pdfRes.headers.get('content-disposition')).toContain(`Piitrade-receipt-${code}.pdf`);
    expect(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await call('GET', `/api/payments/${id}/receipt.pdf`, undefined, auth(stranger))).status).toBe(404);
    expect((await call('GET', `/api/payments/${id}/receipt.pdf`)).status).toBe(401);
    expect((await fetch(`${base}/api/payments/${id}/receipt.pdf`, { headers: auth(admin, 'ADMIN') })).status).toBe(200);
  });

  it('older paid payments get a receipt (without an email) the first time the profile is opened', async () => {
    const u = await mkUser(prisma);
    const row = await prisma.paymentTransaction.create({
      data: {
        referenceId: crypto.randomUUID(), environment: 'production', purpose: 'LISTING_TIER', targetId: 'x', userId: u.id, amount: 15000, currency: 'UGX',
        providerAmount: 15000, providerCurrency: 'UGX', msisdn: '256772123456', status: 'SUCCESSFUL', provisionedAt: new Date(), metadata: { label: 'Gold listing, 30 days' },
      },
    });
    const list = await call('GET', '/api/payments/receipts', undefined, auth(u));
    expect(list.body.receipts[0]).toMatchObject({ paymentId: row.id, item: 'Gold listing, 30 days', emailed: false, isTest: false });
    expect(list.body.receipts[0].receiptNumber.startsWith('PTR-')).toBe(true); // live payments get real PTR codes
    expect(vi.mocked(emailMod.sendPaymentReceiptEmail)).not.toHaveBeenCalled();

    // "Email me this receipt" sends it on request
    const sent = await call('POST', `/api/payments/${row.id}/receipt/email`, {}, auth(u));
    expect(sent.body).toEqual({ sent: true });
    expect(vi.mocked(emailMod.sendPaymentReceiptEmail)).toHaveBeenCalledTimes(1);
  });

  it('public verification: genuine codes pass (however typed), unknown ones fail, and no personal data is exposed', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' }); const u = await mkUser(prisma);
    const id = await paidBy(u, admin);
    const code = (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).receiptNumber!;

    const ok = await call('GET', `/api/payments/receipts/verify?code=${encodeURIComponent(code)}`);
    expect(ok.body).toMatchObject({ valid: true, receiptNumber: code, status: 'PAID', amount: 50000, currency: 'UGX', isTest: true });
    const text = JSON.stringify(ok.body);
    expect(text).not.toContain(u.email); expect(text).not.toContain('2567'); expect(text).not.toContain(u.name);

    const sloppy = code.toLowerCase().replace(/-/g, ' ');
    expect((await call('GET', `/api/payments/receipts/verify?code=${encodeURIComponent(sloppy)}`)).body.valid).toBe(true);
    expect((await call('GET', '/api/payments/receipts/verify?code=PTR-AAAA-BBBB-CCCC')).body).toEqual({ valid: false });
    expect((await call('GET', '/api/payments/receipts/verify')).body).toEqual({ valid: false });
  });

  it('a failed email is retried later and stops after the maximum attempts; the payment is never affected', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' }); const u = await mkUser(prisma);
    const send = vi.mocked(emailMod.sendPaymentReceiptEmail);
    send.mockRejectedValue(new Error('SMTP down'));
    const id = await paidBy(u, admin);

    let row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUCCESSFUL'); expect(row.provisionedAt).not.toBeNull(); // payment unaffected
    expect(row.receiptNumber).not.toBeNull();
    expect(row.receiptEmailedAt).toBeNull(); expect(row.receiptEmailAttempts).toBe(1);

    send.mockResolvedValue(undefined);
    expect(await receipt.retryPendingReceipts()).toBeGreaterThan(0);
    row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } });
    expect(row.receiptEmailedAt).not.toBeNull();

    // a permanently failing address gives up after RECEIPT_EMAIL_MAX_ATTEMPTS
    const u2 = await mkUser(prisma);
    send.mockClear(); send.mockRejectedValue(new Error('bad address'));
    const id2 = await paidBy(u2, admin, '0782123456');
    for (let i = 0; i < 10; i++) await receipt.retryPendingReceipts();
    row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: id2 } });
    expect(row.receiptEmailAttempts).toBe(receipt.RECEIPT_EMAIL_MAX_ATTEMPTS);
    expect(row.receiptEmailedAt).toBeNull();
    expect(send).toHaveBeenCalledTimes(receipt.RECEIPT_EMAIL_MAX_ATTEMPTS);
  });

  it('an admin granting a payment that needed review issues the receipt too', async () => {
    const admin = await mkUser(prisma, { role: 'ADMIN' }); const u = await mkUser(prisma);
    const row = await prisma.paymentTransaction.create({
      data: {
        referenceId: crypto.randomUUID(), environment: 'sandbox', purpose: 'SUBSCRIPTION', targetId: 'x', userId: u.id, amount: 20000, currency: 'UGX',
        providerAmount: 20, providerCurrency: 'EUR', msisdn: '256772123456', status: 'NEEDS_REVIEW', provisionNote: 'needs a look',
      },
    });
    const res = await call('POST', `/api/payments/admin/${row.id}/resolve`, { note: 'checked with MTN statement', outcome: 'GRANTED' }, auth(admin, 'ADMIN'));
    expect(res.status).toBe(200);
    const after = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.receiptNumber).toMatch(receipt.RECEIPT_CODE_RE);
    expect(vi.mocked(emailMod.sendPaymentReceiptEmail)).toHaveBeenCalledTimes(1);
  });
});
