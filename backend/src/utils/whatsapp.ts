/**
 * whatsapp.ts — WhatsApp delivery through the Meta WhatsApp Cloud API, using pre-approved templates
 * (WhatsApp only allows business-initiated messages outside a 24h customer window as templates).
 *
 * Disabled until WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set. Two templates must exist
 * and be approved in Meta Business Manager (see backend/.env.example for their exact shape):
 *   • WHATSAPP_TEMPLATE_NAME       (UTILITY)        body: 3 variables — title, message, link
 *   • WHATSAPP_AUTH_TEMPLATE_NAME  (AUTHENTICATION) body: 1 variable — the one-time code
 */
import { logger } from './logger';

export interface WhatsAppResult {
  ok: boolean;
  /** Short, safe-to-store description of a failure. Never contains the access token. */
  error?: string;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/**
 * Template variables may not contain newlines, tabs or runs of 4+ spaces (the API rejects them), and
 * long values are cut so the whole message stays within template limits.
 */
export function sanitizeTemplateParam(value: string, max = 300): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return cut || '-';
}

/** The Cloud API wants the recipient as digits only (no "+"). */
export function toRecipient(e164: string): string {
  return e164.replace(/\D/g, '');
}

interface TemplatePayloadInput {
  to: string;
  template: string;
  language: string;
  bodyParams: string[];
  /** Authentication templates with a "copy code" button need the code repeated as the button parameter. */
  copyCodeButton?: string;
}

export function buildTemplatePayload(i: TemplatePayloadInput): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: 'body', parameters: i.bodyParams.map((text) => ({ type: 'text', text })) },
  ];
  if (i.copyCodeButton) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: i.copyCodeButton }] });
  }
  return {
    messaging_product: 'whatsapp',
    to: toRecipient(i.to),
    type: 'template',
    template: { name: i.template, language: { code: i.language }, components },
  };
}

async function post(payload: Record<string, unknown>): Promise<WhatsAppResult> {
  const base = (process.env.WHATSAPP_API_BASE?.trim() || 'https://graph.facebook.com').replace(/\/+$/, '');
  const version = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';
  const url = `${base}/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: number } };
      if (j.error?.message) detail = `${detail}: ${j.error.message}`.slice(0, 300);
    } catch { /* non-JSON error body */ }
    logger.warn(`WhatsApp send failed (${detail})`);
    return { ok: false, error: detail };
  } catch (err) {
    const msg = (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message;
    logger.warn(`WhatsApp send error: ${msg}`);
    return { ok: false, error: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

const lang = () => process.env.WHATSAPP_TEMPLATE_LANG?.trim() || 'en';

/** A notification alert: title, message and a full link, through the UTILITY template. */
export function sendWhatsAppAlert(to: string, a: { title: string; message: string; url: string }): Promise<WhatsAppResult> {
  return post(buildTemplatePayload({
    to,
    template: process.env.WHATSAPP_TEMPLATE_NAME?.trim() || 'piitrade_alert',
    language: lang(),
    bodyParams: [sanitizeTemplateParam(a.title, 100), sanitizeTemplateParam(a.message, 200), sanitizeTemplateParam(a.url, 200)],
  }));
}

/** The one-time code that proves a user owns the number they want alerts on. */
export function sendWhatsAppVerificationCode(to: string, code: string): Promise<WhatsAppResult> {
  return post(buildTemplatePayload({
    to,
    template: process.env.WHATSAPP_AUTH_TEMPLATE_NAME?.trim() || 'piitrade_verification',
    language: lang(),
    bodyParams: [code],
    copyCodeButton: process.env.WHATSAPP_AUTH_TEMPLATE_COPY_CODE?.trim().toLowerCase() === 'false' ? undefined : code,
  }));
}
