/**
 * whatsappWebhook.ts — pure logic for Meta's WhatsApp Cloud API webhook (no database, no network).
 *
 * What Meta does, and what this file answers:
 *   1. "Verify and save" in the dashboard sends GET <callback>?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 *      We must answer 200 with the challenge as plain text, but only when the token equals ours.
 *   2. Afterwards every event arrives as POST with an `X-Hub-Signature-256: sha256=<hmac>` header, the HMAC-SHA256
 *      of the EXACT raw request bytes keyed with the app secret. Anything that does not verify is rejected.
 *   3. The JSON carries delivery receipts (`statuses`), inbound messages and account/template events.
 *
 * Environment (see backend/.env.example):
 *   WHATSAPP_VERIFY_TOKEN   the "Verify token" typed into the Meta dashboard (any string you choose)
 *   WHATSAPP_APP_SECRET     Meta app → Settings → Basic → App secret (signs every POST)
 */
import crypto from 'crypto';
import { safeEqual } from './safeEqual';
import { logger } from './logger';
import { isWhatsAppConfigured } from './whatsapp';

export const WEBHOOK_PATH = '/api/webhooks/whatsapp';

export function getVerifyToken(): string | null {
  return process.env.WHATSAPP_VERIFY_TOKEN?.trim() || null;
}

export function getAppSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET?.trim() || null;
}

/** Public callback URL to paste into Meta, or null when this backend's public origin is unknown. */
export function getCallbackUrl(): string | null {
  const raw = process.env.API_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${WEBHOOK_PATH}`;
  } catch {
    return null;
  }
}

/** One startup line saying what is and is not set, so a half-configured WhatsApp shows up in the deploy log. */
export function logWhatsAppConfigStatus(): void {
  const sending = isWhatsAppConfigured();
  const token = Boolean(getVerifyToken());
  const secret = Boolean(getAppSecret());
  const url = getCallbackUrl();
  logger.info(`WhatsApp: sending=${sending ? 'on' : 'off'}, webhook verify token=${token ? 'set' : 'missing'}, app secret=${secret ? 'set' : 'missing'}, callback URL=${url ?? 'unknown (set API_BASE_URL)'}`);
  if (sending && (!token || !secret)) {
    logger.warn(
      'WhatsApp sending is on but the webhook is incomplete'
      + `${token ? '' : ' (WHATSAPP_VERIFY_TOKEN missing: Meta cannot verify the callback URL)'}`
      + `${secret ? '' : ' (WHATSAPP_APP_SECRET missing: delivery receipts are rejected)'}`
      + '. Messages still send; delivery status will not be tracked.',
    );
  }
}

// ─── 1. Verification handshake ────────────────────────────────────────────────

export type VerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; status: 400 | 403 | 503; reason: string };

const MAX_CHALLENGE_LENGTH = 512;

/** Decides the answer to Meta's GET handshake. `query` is Express's req.query. */
export function evaluateVerification(query: Record<string, unknown>): VerificationResult {
  const expected = getVerifyToken();
  if (!expected) return { ok: false, status: 503, reason: 'WHATSAPP_VERIFY_TOKEN is not set' };

  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (typeof mode !== 'string' || typeof challenge !== 'string' || !challenge) {
    return { ok: false, status: 400, reason: 'missing hub.mode or hub.challenge' };
  }
  if (mode !== 'subscribe') return { ok: false, status: 403, reason: `unexpected hub.mode "${mode.slice(0, 40)}"` };
  if (!safeEqual(token, expected)) return { ok: false, status: 403, reason: 'verify token mismatch' };
  if (challenge.length > MAX_CHALLENGE_LENGTH) return { ok: false, status: 400, reason: 'hub.challenge too long' };
  return { ok: true, challenge };
}

// ─── 2. Signature ─────────────────────────────────────────────────────────────

/** True only when `header` is `sha256=<hex>` and equals HMAC-SHA256(rawBody, secret). Constant-time compare. */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Test/support helper: the header value Meta would send for `rawBody`. */
export function signBody(rawBody: Buffer | string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

// ─── 3. Payload ───────────────────────────────────────────────────────────────

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ParsedStatus {
  messageId: string;
  status: ProviderStatus;
  at: Date | null;
  errorCode: number | null;
  errorTitle: string | null;
}

export interface TemplateOrAccountEvent {
  field: string;
  event: string | null;
  detail: string | null;
}

export interface ParsedWebhook {
  statuses: ParsedStatus[];
  /** Number of inbound user messages (content is deliberately never read or stored). */
  inboundMessages: number;
  events: TemplateOrAccountEvent[];
}

const asRecord = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const STATUS_VALUES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read', 'failed']);

/** Cuts anything that could be abused in a log line or a stored detail. */
function clean(v: unknown, max: number): string | null {
  const s = asString(v);
  if (!s) return null;
  return s.replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

/** Reads whatever shape Meta sent; unknown or malformed parts are skipped, never thrown on. */
export function parseWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { statuses: [], inboundMessages: 0, events: [] };
  const root = asRecord(body);
  if (root.object !== 'whatsapp_business_account') return out;

  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const c = asRecord(change);
      const field = asString(c.field) ?? 'unknown';
      const value = asRecord(c.value);

      if (field === 'messages') {
        for (const s of asArray(value.statuses)) {
          const st = asRecord(s);
          const messageId = asString(st.id);
          const status = asString(st.status);
          if (!messageId || !status || !STATUS_VALUES.has(status)) continue;
          const ts = Number(st.timestamp);
          const firstError = asRecord(asArray(st.errors)[0]);
          const code = Number(firstError.code);
          out.statuses.push({
            messageId,
            status: status as ProviderStatus,
            at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : null,
            errorCode: Number.isFinite(code) ? code : null,
            errorTitle: clean(firstError.title, 120) ?? clean(firstError.message, 120),
          });
        }
        out.inboundMessages += asArray(value.messages).length;
        continue;
      }

      // message_template_status_update, phone_number_quality_update, account_update, …
      out.events.push({
        field: clean(field, 60) ?? 'unknown',
        event: clean(value.event, 60),
        detail: clean(value.message_template_name, 120) ?? clean(value.display_phone_number, 40) ?? clean(value.reason, 120),
      });
    }
  }
  return out;
}

/** Events that mean alerts may stop reaching people and an operator should look. */
const ATTENTION_EVENTS: ReadonlySet<string> = new Set(['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED', 'DOWNGRADE', 'RESTRICTED', 'BANNED']);
export function needsAttention(e: TemplateOrAccountEvent): boolean {
  return e.event !== null && ATTENTION_EVENTS.has(e.event.toUpperCase());
}

// ─── Status ordering ─────────────────────────────────────────────────────────

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/**
 * Meta can deliver receipts out of order or twice. A receipt only moves a message forward
 * (sent → delivered → read); `failed` is final, and cannot overwrite a message already delivered/read.
 */
export function shouldApplyStatus(current: string | null, incoming: ProviderStatus): boolean {
  if (current === incoming) return false;
  if (current === 'failed') return false;
  if (incoming === 'failed') return current !== 'delivered' && current !== 'read';
  return (RANK[incoming] ?? 0) > (current ? RANK[current] ?? 0 : 0);
}

/** One status per message id: the furthest-along receipt of a batch, so a batch is applied in a single write per message. */
export function collapseStatuses(statuses: ParsedStatus[]): ParsedStatus[] {
  const byId = new Map<string, ParsedStatus>();
  for (const s of statuses) {
    const prev = byId.get(s.messageId);
    if (!prev || shouldApplyStatus(prev.status, s.status)) byId.set(s.messageId, s);
  }
  return [...byId.values()];
}
