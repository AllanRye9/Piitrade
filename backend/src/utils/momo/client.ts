/**
 * momo/client.ts — thin, dependency-free client for the MTN MoMo *Collection* API.
 *
 * Auth ("triple lock"): API User (UUID) + API Key + Subscription Key. Every call uses a bearer
 * access token obtained from POST /collection/token/ (Basic base64(apiUser:apiKey)); the token
 * lives ~1 hour, is cached in memory, refreshed a few minutes before expiry, fetched single-flight
 * (concurrent callers share one request) and re-fetched once if MTN answers 401.
 *
 * Secrets (API key, subscription key, tokens) are never logged and never put in error messages.
 * Network and 5xx/429 failures are flagged `retryable`; callers decide what to do with them.
 */
import { getMomoSettlementConfig, MomoConfig } from './config';
import { mapProviderStatus, ProviderOutcome } from './rules';
import { logger } from '../logger';

export class MomoApiError extends Error {
  constructor(message: string, readonly httpStatus: number | null, readonly retryable: boolean, readonly code: string | null = null) {
    super(message);
    this.name = 'MomoApiError';
  }
}

export interface RequestToPayInput {
  /** X-Reference-Id — a fresh UUID v4 per attempt (MTN rejects a reused one with 409). */
  referenceId: string;
  /** Whole-number string, already formatted for the provider currency. */
  amount: string;
  currency: string;
  /** Our PaymentTransaction id — echoed back by MTN, used to cross-check the status response. */
  externalId: string;
  msisdn: string;
  payerMessage: string;
  payeeNote: string;
  /** Per-payment signed callback URL (omit for polling-only). */
  callbackUrl?: string | null;
}

export interface RequestToPayStatus {
  /** Raw MTN status string. */
  rawStatus: string;
  outcome: ProviderOutcome;
  reason: string | null;
  financialTransactionId: string | null;
  externalId: string | null;
  amount: string | null;
  currency: string | null;
}

export interface MomoClient {
  /** true/false from MTN's "is this an active MoMo account" check. Throws on transport/API errors. */
  validateAccountHolder(msisdn: string): Promise<boolean>;
  requestToPay(input: RequestToPayInput): Promise<void>;
  getRequestToPayStatus(referenceId: string): Promise<RequestToPayStatus>;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function shortText(value: unknown, max = 120): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function reasonOf(value: unknown): string | null {
  if (typeof value === 'string') return shortText(value);
  if (value && typeof value === 'object') {
    const v = value as { code?: unknown; message?: unknown };
    return shortText(v.code) ?? shortText(v.message);
  }
  return null;
}

export class HttpMomoClient implements MomoClient {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly cfg: MomoConfig) {}

  private baseHeaders(): Record<string, string> {
    return { 'Ocp-Apim-Subscription-Key': this.cfg.subscriptionKey };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      throw new MomoApiError(aborted ? 'MTN request timed out' : 'Could not reach MTN', null, true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorFrom(res: Response, what: string): Promise<MomoApiError> {
    let code: string | null = null;
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown } | null;
      code = shortText(body?.code, 60);
    } catch { /* body is optional */ }
    const retryable = res.status >= 500 || res.status === 429;
    return new MomoApiError(`MTN ${what} failed (HTTP ${res.status}${code ? `, ${code}` : ''})`, res.status, retryable, code);
  }

  /** A valid bearer token (cached, refreshed before it expires, single-flight). */
  async getToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) return this.token.value;
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const basic = Buffer.from(`${this.cfg.apiUser}:${this.cfg.apiKey}`).toString('base64');
      const res = await this.fetchWithTimeout(`${this.cfg.baseUrl}/collection/token/`, {
        method: 'POST',
        headers: { ...this.baseHeaders(), Authorization: `Basic ${basic}`, 'X-Target-Environment': this.cfg.targetEnvironment },
      });
      if (!res.ok) throw await this.errorFrom(res, 'token request');
      const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
      if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new MomoApiError('MTN token response was invalid', res.status, false);
      const seconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
      this.token = { value: body.access_token, expiresAt: Date.now() + seconds * 1000 };
      return this.token.value;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Authenticated call; on a 401 the token is dropped and the call is repeated exactly once. */
  private async authed(method: 'GET' | 'POST', path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const send = async (forceRefresh: boolean) => {
      const token = await this.getToken(forceRefresh);
      return this.fetchWithTimeout(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          ...this.baseHeaders(),
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.cfg.targetEnvironment,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    };
    const first = await send(false);
    if (first.status !== 401) return first;
    this.token = null;
    return send(true);
  }

  async validateAccountHolder(msisdn: string): Promise<boolean> {
    const res = await this.authed('GET', `/collection/v1_0/accountholder/msisdn/${encodeURIComponent(msisdn)}/active`);
    if (!res.ok) throw await this.errorFrom(res, 'account check');
    const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
    return body?.result === true;
  }

  async requestToPay(input: RequestToPayInput): Promise<void> {
    const res = await this.authed('POST', '/collection/v1_0/requesttopay', {
      headers: {
        'X-Reference-Id': input.referenceId,
        ...(input.callbackUrl ? { 'X-Callback-Url': input.callbackUrl } : {}),
      },
      body: {
        amount: input.amount,
        currency: input.currency,
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: input.payerMessage,
        payeeNote: input.payeeNote,
      },
    });
    if (res.status === 202 || res.ok) return;
    const err = await this.errorFrom(res, 'payment request');
    // 409 RESOURCE_ALREADY_EXIST: MTN already holds this exact X-Reference-Id (e.g. our first attempt
    // timed out after MTN accepted it). That is the same payment, not a failure — status checks decide.
    if (res.status === 409 && (err.code === 'RESOURCE_ALREADY_EXIST' || err.code === null)) return;
    throw err;
  }

  async getRequestToPayStatus(referenceId: string): Promise<RequestToPayStatus> {
    const res = await this.authed('GET', `/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`);
    if (!res.ok) throw await this.errorFrom(res, 'payment status');
    const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new MomoApiError('MTN status response was invalid', res.status, false);
    const rawStatus = typeof b.status === 'string' ? b.status : '';
    return {
      rawStatus,
      outcome: mapProviderStatus(rawStatus),
      reason: reasonOf(b.reason),
      financialTransactionId: b.financialTransactionId == null ? null : shortText(String(b.financialTransactionId), 80),
      externalId: typeof b.externalId === 'string' ? b.externalId : null,
      amount: b.amount == null ? null : String(b.amount),
      currency: typeof b.currency === 'string' ? b.currency : null,
    };
  }
}

// ─── Singleton + test seam ──────────────────────────────────────────────────

let override: MomoClient | null = null;
let shared: HttpMomoClient | null = null;

export function getMomoClient(): MomoClient {
  if (override) return override;
  if (!shared) {
    shared = new HttpMomoClient(getMomoSettlementConfig()); // settling in-flight payments keeps working while new ones are paused
    logger.info('MTN MoMo client initialised');
  }
  return shared;
}

/** Tests inject a fake client here (pass null to restore the real one). */
export function setMomoClientForTests(client: MomoClient | null): void {
  override = client;
  shared = null;
}
