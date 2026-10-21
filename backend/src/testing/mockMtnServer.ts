/**
 * Local stand-in for the MTN MoMo *sandbox*, used only by tests. It enforces the documented wire
 * contract (subscription key on every call, Basic auth for tokens, bearer + X-Target-Environment
 * for API calls, UUID references, EUR-only currency, 409 on a reused reference) so the REAL
 * HttpMomoClient and provisioning script can be exercised end to end without the network.
 */
import http, { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

export const SUB_KEY = 'a3f1c2d4e5b6a7980123456789abcdef';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MockRequestToPay {
  referenceId: string; amount: string; currency: string; externalId: string; payer: { partyIdType: string; partyId: string };
  payerMessage: string; payeeNote: string; callbackUrl: string | null; status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'; reason?: string;
}

export class MockMtnServer {
  users = new Map<string, { apiKey: string; callbackHost: string }>();
  validTokens = new Set<string>();
  tokenRequests = 0;
  payments = new Map<string, MockRequestToPay>();
  log: string[] = [];
  inactiveNumbers = new Set<string>();
  private server!: http.Server;
  url = '';

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => { this.handle(req, res).catch(() => { res.statusCode = 500; res.end(); }); });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async stop(): Promise<void> { await new Promise((r) => this.server.close(r)); }

  registerUser(): { apiUser: string; apiKey: string } {
    const apiUser = crypto.randomUUID(); const apiKey = crypto.randomBytes(16).toString('hex');
    this.users.set(apiUser, { apiKey, callbackHost: 'test' });
    return { apiUser, apiKey };
  }
  revokeTokens() { this.validTokens.clear(); }
  approve(ref: string) { const p = this.payments.get(ref); if (p) p.status = 'SUCCESSFUL'; }
  reject(ref: string, reason = 'APPROVAL_REJECTED') { const p = this.payments.get(ref); if (p) { p.status = 'FAILED'; p.reason = reason; } }

  private send(res: ServerResponse, status: number, body?: unknown) {
    res.statusCode = status;
    if (body !== undefined) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); } else res.end();
  }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.url);
    const path = url.pathname; const method = req.method ?? 'GET';
    this.log.push(`${method} ${path}`);
    if (req.headers['ocp-apim-subscription-key'] !== SUB_KEY) return this.send(res, 401, { message: 'Access denied due to invalid subscription key.' });

    if (method === 'POST' && path === '/v1_0/apiuser') {
      const id = String(req.headers['x-reference-id'] ?? ''); const b = await this.body(req);
      if (!UUID_RE.test(id) || typeof b.providerCallbackHost !== 'string') return this.send(res, 400, { code: 'BAD_REQUEST' });
      if (this.users.has(id)) return this.send(res, 409, { code: 'RESOURCE_ALREADY_EXIST' });
      this.users.set(id, { apiKey: '', callbackHost: b.providerCallbackHost });
      return this.send(res, 201);
    }
    let m = path.match(/^\/v1_0\/apiuser\/([^/]+)\/apikey$/);
    if (method === 'POST' && m) {
      const u = this.users.get(m[1]); if (!u) return this.send(res, 404, { code: 'RESOURCE_NOT_FOUND' });
      u.apiKey = crypto.randomBytes(16).toString('hex');
      return this.send(res, 201, { apiKey: u.apiKey });
    }
    if (method === 'POST' && path === '/collection/token/') {
      const auth = String(req.headers.authorization ?? '');
      const [user, key] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':');
      const u = this.users.get(user);
      if (!auth.startsWith('Basic ') || !u || u.apiKey !== key) return this.send(res, 401, { code: 'INVALID_CREDENTIALS' });
      this.tokenRequests++;
      const token = `tok-${crypto.randomBytes(12).toString('hex')}`; this.validTokens.add(token);
      return this.send(res, 200, { access_token: token, token_type: 'access_token', expires_in: 3600 });
    }

    // everything below needs a live bearer token and the target environment
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.validTokens.has(bearer)) return this.send(res, 401, { code: 'ACCESS_DENIED' });
    if (req.headers['x-target-environment'] !== 'sandbox') return this.send(res, 400, { code: 'INVALID_TARGET_ENVIRONMENT' });

    if (method === 'POST' && path === '/collection/v1_0/requesttopay') {
      const ref = String(req.headers['x-reference-id'] ?? ''); const b = await this.body(req);
      const payer = (b.payer ?? {}) as { partyIdType?: string; partyId?: string };
      if (!UUID_RE.test(ref)) return this.send(res, 400, { code: 'INVALID_REFERENCE' });
      if (this.payments.has(ref)) return this.send(res, 409, { code: 'RESOURCE_ALREADY_EXIST' });
      if (b.currency !== 'EUR') return this.send(res, 400, { code: 'INVALID_CURRENCY' }); // sandbox: EUR only
      if (typeof b.amount !== 'string' || !/^\d+(\.\d+)?$/.test(b.amount) || Number(b.amount) <= 0) return this.send(res, 400, { code: 'INVALID_AMOUNT' });
      if (payer.partyIdType !== 'MSISDN' || !payer.partyId || typeof b.externalId !== 'string') return this.send(res, 400, { code: 'INVALID_PAYER' });
      this.payments.set(ref, {
        referenceId: ref, amount: b.amount, currency: String(b.currency), externalId: b.externalId, payer: { partyIdType: payer.partyIdType, partyId: payer.partyId },
        payerMessage: String(b.payerMessage ?? ''), payeeNote: String(b.payeeNote ?? ''), callbackUrl: (req.headers['x-callback-url'] as string) ?? null, status: 'PENDING',
      });
      return this.send(res, 202);
    }
    m = path.match(/^\/collection\/v1_0\/requesttopay\/([^/]+)$/);
    if (method === 'GET' && m) {
      const p = this.payments.get(m[1]); if (!p) return this.send(res, 404, { code: 'RESOURCE_NOT_FOUND' });
      return this.send(res, 200, {
        amount: p.amount, currency: p.currency, externalId: p.externalId, payer: p.payer, payerMessage: p.payerMessage, payeeNote: p.payeeNote, status: p.status,
        ...(p.status === 'SUCCESSFUL' ? { financialTransactionId: '4004556677' } : {}),
        ...(p.status === 'FAILED' ? { reason: { code: p.reason ?? 'INTERNAL_PROCESSING_ERROR', message: 'x' } } : {}),
      });
    }
    m = path.match(/^\/collection\/v1_0\/accountholder\/msisdn\/([^/]+)\/active$/);
    if (method === 'GET' && m) return this.send(res, 200, { result: !this.inactiveNumbers.has(m[1]) });

    return this.send(res, 404, { code: 'NOT_FOUND' });
  }
}
