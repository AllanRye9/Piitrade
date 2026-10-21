import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpMomoClient, MomoApiError } from './client';
import { loadMomoConfig } from './config';

const cfg = loadMomoConfig({
  MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_SUBSCRIPTION_KEY: 'sub-key-0123456789abcdef0123456789',
  MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde', MTN_API_KEY: 'api-key-secret-0123456789abcdef',
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenRes = (n = 1, expires = 3600) => json(200, { access_token: `tok-${n}`, token_type: 'access_token', expires_in: expires });

describe('HttpMomoClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('gets a token with Basic auth + subscription key and caches it', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes());
    const c = new HttpMomoClient(cfg);
    expect(await c.getToken()).toBe('tok-1');
    expect(await c.getToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sandbox.momodeveloper.mtn.com/collection/token/');
    expect((init as RequestInit).method).toBe('POST');
    const h = (init as RequestInit).headers as Record<string, string>;
    expect(h['Ocp-Apim-Subscription-Key']).toBe(cfg.subscriptionKey);
    expect(h.Authorization).toBe(`Basic ${Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString('base64')}`);
  });

  it('shares one token request between concurrent callers', async () => {
    fetchMock.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return tokenRes(); });
    const c = new HttpMomoClient(cfg);
    const out = await Promise.all([c.getToken(), c.getToken(), c.getToken(), c.getToken()]);
    expect(new Set(out).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token before it expires (5-minute margin)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    fetchMock.mockResolvedValueOnce(tokenRes(1, 3600)).mockResolvedValueOnce(tokenRes(2, 3600));
    const c = new HttpMomoClient(cfg);
    expect(await c.getToken()).toBe('tok-1');
    vi.setSystemTime(new Date('2026-10-20T10:54:00Z')); // 54 min in: still fresh
    expect(await c.getToken()).toBe('tok-1');
    vi.setSystemTime(new Date('2026-10-20T10:56:00Z')); // < 5 min left: refresh
    expect(await c.getToken()).toBe('tok-2');
  });

  it('re-fetches the token once on a 401 and retries the call', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes(1))
      .mockResolvedValueOnce(json(401, { code: 'EXPIRED' }))
      .mockResolvedValueOnce(tokenRes(2))
      .mockResolvedValueOnce(json(200, { result: true }));
    const c = new HttpMomoClient(cfg);
    expect(await c.validateAccountHolder('256772123456')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retryHeaders = (fetchMock.mock.calls[3][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer tok-2');
  });

  it('does not loop on repeated 401s', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith('/token/') ? tokenRes() : json(401, {})));
    await expect(new HttpMomoClient(cfg).validateAccountHolder('256772123456')).rejects.toBeInstanceOf(MomoApiError);
    expect(fetchMock.mock.calls.filter((c) => !String(c[0]).endsWith('/token/'))).toHaveLength(2);
  });

  it('sends the documented requesttopay request', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    await new HttpMomoClient(cfg).requestToPay({
      referenceId: 'ref-1', amount: '60000', currency: 'EUR', externalId: 'pay-1', msisdn: '256772123456',
      payerMessage: 'Piitrade Gold', payeeNote: 'Piitrade Gold', callbackUrl: 'https://api.piitrade.test/api/payments/momo/callback/ref-1?s=abc',
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay');
    const h = (init as RequestInit).headers as Record<string, string>;
    expect(h['X-Reference-Id']).toBe('ref-1');
    expect(h['X-Target-Environment']).toBe('sandbox');
    expect(h['X-Callback-Url']).toContain('/ref-1?s=abc');
    expect(h['Content-Type']).toBe('application/json');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      amount: '60000', currency: 'EUR', externalId: 'pay-1', payer: { partyIdType: 'MSISDN', partyId: '256772123456' },
      payerMessage: 'Piitrade Gold', payeeNote: 'Piitrade Gold',
    });
  });

  it('treats 409 RESOURCE_ALREADY_EXIST on requesttopay as the same payment (idempotent retry), but other 409s as errors', async () => {
    const input = { referenceId: 'ref-1', amount: '5000', currency: 'EUR', externalId: 'x', msisdn: '256772123456', payerMessage: 'a', payeeNote: 'b' };
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(json(409, { code: 'RESOURCE_ALREADY_EXIST', message: 'dup' }));
    await expect(new HttpMomoClient(cfg).requestToPay(input)).resolves.toBeUndefined();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(json(409, { code: 'SOMETHING_ELSE' }));
    await expect(new HttpMomoClient(cfg).requestToPay(input)).rejects.toMatchObject({ httpStatus: 409, code: 'SOMETHING_ELSE' });
  });

  it('sends X-Target-Environment on the token call too, and carries MTN error codes on errors', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes());
    await new HttpMomoClient(cfg).getToken();
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>)['X-Target-Environment']).toBe('sandbox');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(json(400, { code: 'INVALID_CURRENCY', message: 'm' }));
    await expect(new HttpMomoClient(cfg).requestToPay({ referenceId: 'r', amount: '1', currency: 'XXX', externalId: 'x', msisdn: '256772123456', payerMessage: 'a', payeeNote: 'b' }))
      .rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_CURRENCY', retryable: false });
  });

  it('omits X-Callback-Url when there is no callback (polling only)', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    await new HttpMomoClient(cfg).requestToPay({ referenceId: 'r', amount: '1000', currency: 'EUR', externalId: 'p', msisdn: '1', payerMessage: 'm', payeeNote: 'n' });
    expect(((fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>)['X-Callback-Url']).toBeUndefined();
  });

  it('parses the status response and maps outcomes', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(json(200, {
      amount: '60000', currency: 'EUR', externalId: 'pay-1', status: 'SUCCESSFUL', financialTransactionId: 987654321,
    }));
    const st = await new HttpMomoClient(cfg).getRequestToPayStatus('ref-1');
    expect(st).toMatchObject({ outcome: 'SUCCESSFUL', externalId: 'pay-1', amount: '60000', currency: 'EUR', financialTransactionId: '987654321', reason: null });
  });

  it('reads a failure reason whether MTN sends a string or an object', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, { status: 'FAILED', reason: { code: 'APPROVAL_REJECTED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { status: 'FAILED', reason: 'PAYER_NOT_FOUND' }));
    const c = new HttpMomoClient(cfg);
    expect((await c.getRequestToPayStatus('a')).reason).toBe('APPROVAL_REJECTED');
    expect((await c.getRequestToPayStatus('b')).reason).toBe('PAYER_NOT_FOUND');
  });

  it('flags 5xx / 429 / network failures as retryable and other 4xx as not', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(409, { code: 'RESOURCE_ALREADY_EXIST' }))
      .mockResolvedValueOnce(json(429, {})).mockRejectedValueOnce(new TypeError('fetch failed'));
    const c = new HttpMomoClient(cfg);
    await expect(c.getRequestToPayStatus('a')).rejects.toMatchObject({ retryable: true, httpStatus: 503 });
    await expect(c.getRequestToPayStatus('b')).rejects.toMatchObject({ retryable: false, httpStatus: 409 });
    await expect(c.getRequestToPayStatus('c')).rejects.toMatchObject({ retryable: true, httpStatus: 429 });
    await expect(c.getRequestToPayStatus('d')).rejects.toMatchObject({ retryable: true, httpStatus: null });
  });

  it('never leaks the API key, subscription key or token into error messages', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { message: `bad ${cfg.apiKey}` }));
    const err = await new HttpMomoClient(cfg).getToken().catch((e) => e as Error);
    expect(String(err.message)).not.toContain(cfg.apiKey);
    expect(String(err.message)).not.toContain(cfg.subscriptionKey);
  });

  it('treats an unparsable token response as a non-retryable error', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { nope: true }));
    await expect(new HttpMomoClient(cfg).getToken()).rejects.toMatchObject({ retryable: false });
  });
});
