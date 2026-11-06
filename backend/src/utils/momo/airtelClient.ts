/**
 * momo/airtelClient.ts — dependency-free client for the Airtel Money Open API (Collections, Uganda).
 *
 * Auth: POST /auth/oauth2/token {client_id, client_secret, grant_type} -> bearer token (cached, refreshed
 * before expiry, single-flight, re-fetched once on 401). Collect: POST /merchant/v2/payments/ (USSD push).
 * Status: GET /standard/v1/payments/{id}. Implements the same MomoClient interface as MTN so the payment
 * service treats both networks identically. Secrets are never logged or put in errors.
 *
 * Airtel's status response carries no amount/currency, so those are returned as null; the payment
 * service accepts that only for Airtel (the amount was fixed by OUR request and Airtel debits exactly it).
 */
import { AirtelConfig, loadAirtelConfig } from './airtelConfig';
import { MomoApiError, MomoClient, RequestToPayInput, RequestToPayStatus } from './client';
import { ProviderOutcome } from './rules';
import { logger } from '../logger';

const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/** TS success · TF failed · TA ambiguous (keep checking) · TIP in progress · TE expired. Unknown -> still pending, never paid. */
export function mapAirtelStatus(raw: unknown): ProviderOutcome {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'TS' || s === 'SUCCESS' || s === 'SUCCESSFUL') return 'SUCCESSFUL';
  if (s === 'TF' || s === 'TE' || s === 'FAILED' || s === 'EXPIRED') return 'FAILED';
  return 'PENDING';
}

const REASONS: Record<string, string> = { TF: 'DECLINED', TE: 'EXPIRED' };

function short(v: unknown, max = 120): string | null {
  return typeof v === 'string' && v.trim() ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : null;
}

/** Airtel wants the subscriber number WITHOUT the country code (772123456 / 701234567). */
export function airtelLocalNumber(msisdn: string, country = 'UG'): string {
  return country === 'UG' && msisdn.startsWith('256') ? msisdn.slice(3) : msisdn;
}

export class HttpAirtelClient implements MomoClient {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  constructor(private readonly cfg: AirtelConfig) {}

  private async fetchT(url: string, init: RequestInit): Promise<Response> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: c.signal });
    } catch (err) {
      throw new MomoApiError((err as { name?: string })?.name === 'AbortError' ? 'Airtel request timed out' : 'Could not reach Airtel', null, true);
    } finally {
      clearTimeout(t);
    }
  }

  private async errorFrom(res: Response, what: string): Promise<MomoApiError> {
    let code: string | null = null;
    try {
      const b = (await res.json()) as { status?: { response_code?: unknown; code?: unknown }; error?: unknown } | null;
      code = short(b?.status?.response_code, 60) ?? short(b?.status?.code, 60) ?? short(b?.error, 60);
    } catch { /* optional */ }
    return new MomoApiError(`Airtel ${what} failed (HTTP ${res.status}${code ? `, ${code}` : ''})`, res.status, res.status >= 500 || res.status === 429, code);
  }

  async getToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) return this.token.value;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const res = await this.fetchT(`${this.cfg.baseUrl}/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: '*/*' },
        body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'client_credentials' }),
      });
      if (!res.ok) throw await this.errorFrom(res, 'token request');
      const b = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
      if (!b || typeof b.access_token !== 'string' || !b.access_token) throw new MomoApiError('Airtel token response was invalid', res.status, false);
      const secs = Number(b.expires_in);
      this.token = { value: b.access_token, expiresAt: Date.now() + (secs > 0 ? secs : 180) * 1000 };
      return this.token.value;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async authed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const send = async (force: boolean) => {
      const token = await this.getToken(force);
      return this.fetchT(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`, Accept: '*/*',
          'X-Country': this.cfg.country, 'X-Currency': this.cfg.currency,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };
    const first = await send(false);
    if (first.status !== 401) return first;
    this.token = null;
    return send(true);
  }

  /** Airtel has no cheap "is this an active account" check; the USSD prompt itself fails for a bad number. */
  async validateAccountHolder(): Promise<boolean> {
    return true;
  }

  async requestToPay(input: RequestToPayInput): Promise<void> {
    const res = await this.authed('POST', '/merchant/v2/payments/', {
      reference: input.payerMessage.slice(0, 60),
      subscriber: { country: this.cfg.country, currency: this.cfg.currency, msisdn: airtelLocalNumber(input.msisdn, this.cfg.country) },
      transaction: { amount: Number(input.amount), country: this.cfg.country, currency: this.cfg.currency, id: input.referenceId },
    });
    const b = (await res.clone().json().catch(() => null)) as { status?: { success?: unknown; response_code?: unknown } } | null;
    if (res.ok && b?.status?.success !== false) return;
    // Duplicate transaction id: the same payment is already held by Airtel; status checks decide.
    const code = short(b?.status?.response_code, 60);
    if (code === 'DP00800001006' || res.status === 409) return;
    const err = await this.errorFrom(res, 'payment request');
    throw res.ok ? new MomoApiError('Airtel payment request failed', 400, false, code) : err;
  }

  async getRequestToPayStatus(referenceId: string): Promise<RequestToPayStatus> {
    const res = await this.authed('GET', `/standard/v1/payments/${encodeURIComponent(referenceId)}`);
    if (!res.ok) throw await this.errorFrom(res, 'payment status');
    const b = (await res.json().catch(() => null)) as { data?: { transaction?: { id?: unknown; status?: unknown; message?: unknown; airtel_money_id?: unknown } } } | null;
    const tx = b?.data?.transaction;
    if (!tx) throw new MomoApiError('Airtel status response was invalid', res.status, false);
    const raw = typeof tx.status === 'string' ? tx.status : '';
    const outcome = mapAirtelStatus(raw);
    return {
      rawStatus: raw,
      outcome,
      reason: outcome === 'FAILED' ? (REASONS[raw.toUpperCase()] ?? short(tx.message, 60)) : null,
      financialTransactionId: tx.airtel_money_id == null ? null : short(String(tx.airtel_money_id), 80),
      externalId: null,
      amount: null,
      currency: null,
    };
  }
}

let override: MomoClient | null = null;
let shared: HttpAirtelClient | null = null;

export function getAirtelClient(): MomoClient {
  if (override) return override;
  if (!shared) {
    shared = new HttpAirtelClient(loadAirtelConfig());
    logger.info('Airtel Money client initialised');
  }
  return shared;
}

export function setAirtelClientForTests(client: MomoClient | null): void {
  override = client;
  shared = null;
}
