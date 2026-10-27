import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { HttpMomoClient, MomoApiError } from './client';
import { loadMomoConfig, MomoConfig } from './config';
import { FakeMtn } from './fakeMtn';

const KEYS = {
  subscriptionKey: 'sub-key-0123456789abcdef0123456789',
  apiUser: '7b9a4c12-3456-4789-a12b-3456789abcde',
  apiKey: 'api-key-secret-0123456789abcdef',
};

let fake: FakeMtn;
let cfg: MomoConfig;
const client = () => new HttpMomoClient(cfg);

const pay = (c: HttpMomoClient, msisdn: string, extra: Partial<Parameters<HttpMomoClient['requestToPay']>[0]> = {}) => {
  const referenceId = crypto.randomUUID();
  return c.requestToPay({
    referenceId, amount: '50', currency: 'EUR', externalId: `txn-${referenceId.slice(0, 8)}`, msisdn,
    payerMessage: 'Piitrade listing', payeeNote: 'Piitrade', ...extra,
  }).then(() => referenceId);
};

describe('MoMo collection flow against the fake MTN sandbox', () => {
  beforeAll(async () => {
    fake = await new FakeMtn({ ...KEYS, pendingPolls: 1 }).start();
    fake.expectedCurrency = 'EUR';
    cfg = loadMomoConfig({
      MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox', MTN_BASE_URL: fake.baseUrl,
      MTN_SUBSCRIPTION_KEY: KEYS.subscriptionKey, MTN_API_USER: KEYS.apiUser, MTN_API_KEY: KEYS.apiKey,
    });
  });
  afterAll(async () => { await fake.stop(); });
  beforeEach(() => { fake.reject401 = 0; fake.fail503 = 0; });

  it('pays: PENDING first, then SUCCESSFUL with a financial transaction id', async () => {
    const c = client();
    const ref = await pay(c, '46733123450');
    const first = await c.getRequestToPayStatus(ref);
    expect(first.outcome).toBe('PENDING');
    const second = await c.getRequestToPayStatus(ref);
    expect(second.outcome).toBe('SUCCESSFUL');
    expect(second.financialTransactionId).toMatch(/^\d{6,}$/);
    expect(second.amount).toBe('50');
    expect(second.currency).toBe('EUR');
  });

  it.each([
    ['46733123451', 'PAYER_NOT_FOUND'],
    ['46733123452', 'APPROVAL_REJECTED'],
    ['46733123453', 'EXPIRED'],
  ])('maps sandbox number %s to FAILED (%s)', async (msisdn, reason) => {
    const c = client();
    const ref = await pay(c, msisdn);
    await c.getRequestToPayStatus(ref);
    const s = await c.getRequestToPayStatus(ref);
    expect(s.outcome).toBe('FAILED');
    expect(s.reason).toBe(reason);
    expect(s.financialTransactionId).toBeNull();
  });

  it('keeps 46733123454 PENDING however often it is polled (never treated as paid)', async () => {
    const c = client();
    const ref = await pay(c, '46733123454');
    for (let i = 0; i < 4; i++) expect((await c.getRequestToPayStatus(ref)).outcome).toBe('PENDING');
  });

  it('echoes our externalId so the caller can cross-check the payment', async () => {
    const c = client();
    const ref = await pay(c, '46733123450', { externalId: 'txn-abc123' });
    expect((await c.getRequestToPayStatus(ref)).externalId).toBe('txn-abc123');
  });

  it('treats a repeated requesttopay with the same reference as the same payment (409 is not an error)', async () => {
    const c = client();
    const ref = await pay(c, '46733123450');
    await expect(c.requestToPay({ referenceId: ref, amount: '50', currency: 'EUR', externalId: 'x', msisdn: '46733123450', payerMessage: 'a', payeeNote: 'b' })).resolves.toBeUndefined();
    expect([...fake.payments.keys()].filter((k) => k === ref)).toHaveLength(1);
  });

  it('sends the callback URL to MTN when configured', async () => {
    const c = client();
    const ref = await pay(c, '46733123450', { callbackUrl: 'https://api.example.com/api/payments/momo/callback/abc?s=sig' });
    expect(fake.payments.get(ref)!.callbackUrl).toBe('https://api.example.com/api/payments/momo/callback/abc?s=sig');
  });

  it('refreshes the token once when MTN answers 401, and the payment still goes through', async () => {
    const c = client();
    await c.getToken();
    const before = fake.tokensIssued;
    fake.reject401 = 1;
    await expect(pay(c, '46733123450')).resolves.toBeTruthy();
    expect(fake.tokensIssued).toBe(before + 1);
  });

  it('flags a 503 as retryable', async () => {
    const c = client();
    await c.getToken();
    fake.fail503 = 1;
    const err = await pay(c, '46733123450').catch((e) => e);
    expect(err).toBeInstanceOf(MomoApiError);
    expect((err as MomoApiError).retryable).toBe(true);
  });

  it('rejects wrong credentials without leaking them', async () => {
    const bad = new HttpMomoClient({ ...cfg, apiKey: 'wrong-key-wrong-key-wrong-key' });
    const err = await bad.getToken().catch((e) => e as Error);
    expect(err).toBeInstanceOf(MomoApiError);
    expect(err.message).not.toContain('wrong-key');
    expect(err.message).not.toContain(KEYS.subscriptionKey);
  });

  it('rejects a payment in a currency the sandbox does not accept (UGX)', async () => {
    const c = client();
    const err = await pay(c, '46733123450', { currency: 'UGX' }).catch((e) => e);
    expect((err as MomoApiError).code).toBe('INVALID_CURRENCY');
    expect((err as MomoApiError).retryable).toBe(false);
  });

  it('answers the account-holder check', async () => {
    expect(await client().validateAccountHolder('46733123450')).toBe(true);
  });
});
