/**
 * momo/fakeMtn.ts — an in-process imitation of the MTN MoMo *Collection* sandbox.
 *
 * Lets the real HttpMomoClient be exercised end to end (token, account check, requesttopay, status
 * polling) with no internet, no MTN credentials and no database. Used by `npm run momo:selftest`
 * and by momoFlow.test.ts. It follows MTN's documented sandbox behaviour:
 *
 *   46733123450  -> SUCCESSFUL           46733123451 -> FAILED (PAYER_NOT_FOUND-style reason)
 *   46733123452  -> FAILED (REJECTED)    46733123453 -> FAILED (TIMEOUT)
 *   46733123454  -> stays PENDING        any other number -> SUCCESSFUL
 *
 * Real sandbox / production traffic is NOT touched: point MTN_BASE_URL at `fake.baseUrl`.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';

export interface FakeMtnOptions {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  /** Polls that answer PENDING before the final result (default 1). */
  pendingPolls?: number;
  /** Token lifetime in seconds (default 3600). */
  tokenSeconds?: number;
}

interface StoredPayment {
  referenceId: string;
  externalId: string;
  amount: string;
  currency: string;
  msisdn: string;
  callbackUrl: string | null;
  polls: number;
}

const OUTCOMES: Record<string, { status: 'SUCCESSFUL' | 'FAILED' | 'PENDING'; reason?: string }> = {
  '46733123450': { status: 'SUCCESSFUL' },
  '46733123451': { status: 'FAILED', reason: 'PAYER_NOT_FOUND' },
  '46733123452': { status: 'FAILED', reason: 'APPROVAL_REJECTED' },
  '46733123453': { status: 'FAILED', reason: 'EXPIRED' },
  '46733123454': { status: 'PENDING' },
};

export class FakeMtn {
  readonly payments = new Map<string, StoredPayment>();
  readonly calls: { method: string; path: string }[] = [];
  /** Make the next N authed calls answer 401 (to test token refresh). */
  reject401 = 0;
  /** Make the next N authed calls answer 503 (to test retryable errors). */
  fail503 = 0;
  tokensIssued = 0;

  private server: http.Server | null = null;
  baseUrl = '';

  constructor(readonly opts: FakeMtnOptions) {}

  private validTokens = new Set<string>();

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  /** What MTN would do after the payer answers the prompt: the status the next poll(s) will return. */
  outcomeFor(msisdn: string) {
    return OUTCOMES[msisdn] ?? { status: 'SUCCESSFUL' as const };
  }

  private send(res: http.ServerResponse, status: number, body?: unknown) {
    res.statusCode = status;
    if (body !== undefined) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    } else res.end();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '');
    this.calls.push({ method: req.method ?? 'GET', path });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { this.route(req, res, path, raw); } catch { this.send(res, 500, { code: 'INTERNAL_ERROR' }); }
    });
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse, path: string, raw: string) {
    const h = req.headers;
    if (h['ocp-apim-subscription-key'] !== this.opts.subscriptionKey) return this.send(res, 401, { code: 'ACCESS_DENIED' });

    if (path === '/collection/token' && req.method === 'POST') {
      const expected = `Basic ${Buffer.from(`${this.opts.apiUser}:${this.opts.apiKey}`).toString('base64')}`;
      if (h.authorization !== expected) return this.send(res, 401, { code: 'ACCESS_DENIED' });
      const token = `fake-${crypto.randomBytes(8).toString('hex')}`;
      this.validTokens.add(token);
      this.tokensIssued += 1;
      return this.send(res, 200, { access_token: token, token_type: 'access_token', expires_in: this.opts.tokenSeconds ?? 3600 });
    }

    // Everything below needs a valid bearer token and the target environment header.
    const bearer = String(h.authorization ?? '').replace(/^Bearer /, '');
    if (this.reject401 > 0) { this.reject401 -= 1; this.validTokens.delete(bearer); return this.send(res, 401, { code: 'ACCESS_DENIED' }); }
    if (!this.validTokens.has(bearer)) return this.send(res, 401, { code: 'ACCESS_DENIED' });
    if (this.fail503 > 0) { this.fail503 -= 1; return this.send(res, 503, { code: 'SERVICE_UNAVAILABLE' }); }
    if (!h['x-target-environment']) return this.send(res, 400, { code: 'MISSING_TARGET_ENVIRONMENT' });

    const holder = path.match(/^\/collection\/v1_0\/accountholder\/msisdn\/([^/]+)\/active$/);
    if (holder && req.method === 'GET') return this.send(res, 200, { result: true });

    if (path === '/collection/v1_0/requesttopay' && req.method === 'POST') {
      const referenceId = String(h['x-reference-id'] ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(referenceId)) return this.send(res, 400, { code: 'INVALID_REFERENCE_ID' });
      if (this.payments.has(referenceId)) return this.send(res, 409, { code: 'RESOURCE_ALREADY_EXIST' });
      const b = JSON.parse(raw || '{}') as Record<string, any>;
      if (!b.amount || !b.currency || !b.payer?.partyId) return this.send(res, 400, { code: 'INVALID_REQUEST' });
      if (this.expectedCurrency && b.currency !== this.expectedCurrency) return this.send(res, 400, { code: 'INVALID_CURRENCY' });
      this.payments.set(referenceId, {
        referenceId, externalId: String(b.externalId ?? ''), amount: String(b.amount), currency: String(b.currency),
        msisdn: String(b.payer.partyId), callbackUrl: typeof h['x-callback-url'] === 'string' ? h['x-callback-url'] : null, polls: 0,
      });
      return this.send(res, 202);
    }

    const status = path.match(/^\/collection\/v1_0\/requesttopay\/([^/]+)$/);
    if (status && req.method === 'GET') {
      const p = this.payments.get(status[1]);
      if (!p) return this.send(res, 404, { code: 'RESOURCE_NOT_FOUND' });
      p.polls += 1;
      const outcome = this.outcomeFor(p.msisdn);
      const pending = outcome.status === 'PENDING' || p.polls <= (this.opts.pendingPolls ?? 1);
      const body: Record<string, unknown> = {
        amount: p.amount, currency: p.currency, externalId: p.externalId,
        payer: { partyIdType: 'MSISDN', partyId: p.msisdn },
        status: pending ? 'PENDING' : outcome.status,
      };
      if (!pending && outcome.status === 'SUCCESSFUL') body.financialTransactionId = String(1000000000 + (parseInt(p.referenceId.slice(0, 6), 16) % 999999999));
      if (!pending && outcome.status === 'FAILED') body.reason = outcome.reason;
      return this.send(res, 200, body);
    }

    return this.send(res, 404, { code: 'NOT_FOUND' });
  }

  /** Optionally enforce the currency the sandbox accepts (EUR). */
  expectedCurrency: string | null = null;
}
