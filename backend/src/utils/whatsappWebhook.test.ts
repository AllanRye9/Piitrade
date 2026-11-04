import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));

import {
  evaluateVerification, verifySignature, signBody, parseWebhook, shouldApplyStatus, collapseStatuses,
  needsAttention, getCallbackUrl, WEBHOOK_PATH, type ParsedStatus,
} from './whatsappWebhook';

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.API_BASE_URL;
});
afterEach(() => { process.env = { ...SAVED }; });

describe('evaluateVerification (Meta GET handshake)', () => {
  const q = (o: Record<string, unknown>) => ({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok-123', 'hub.challenge': '1158201444', ...o });

  it('returns the challenge when mode and token are right', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'tok-123';
    expect(evaluateVerification(q({}))).toEqual({ ok: true, challenge: '1158201444' });
  });
  it('trims whitespace around the configured token (a common copy/paste slip in env panels)', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = '  tok-123 \n';
    expect(evaluateVerification(q({})).ok).toBe(true);
  });
  it('is 503 when no token is configured, even if the caller sends one', () => {
    expect(evaluateVerification(q({}))).toMatchObject({ ok: false, status: 503 });
  });
  it('is 403 on a wrong or missing token, and on a different token of the same length', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'tok-123';
    expect(evaluateVerification(q({ 'hub.verify_token': 'tok-124' }))).toMatchObject({ ok: false, status: 403 });
    expect(evaluateVerification(q({ 'hub.verify_token': 'nope' }))).toMatchObject({ ok: false, status: 403 });
    expect(evaluateVerification(q({ 'hub.verify_token': undefined }))).toMatchObject({ ok: false, status: 403 });
  });
  it('is 403 when the mode is not "subscribe"', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'tok-123';
    expect(evaluateVerification(q({ 'hub.mode': 'unsubscribe' }))).toMatchObject({ ok: false, status: 403 });
  });
  it('is 400 when there is no challenge, or it is not a plain string (?hub.challenge[]=x)', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'tok-123';
    expect(evaluateVerification(q({ 'hub.challenge': undefined }))).toMatchObject({ ok: false, status: 400 });
    expect(evaluateVerification(q({ 'hub.challenge': '' }))).toMatchObject({ ok: false, status: 400 });
    expect(evaluateVerification(q({ 'hub.challenge': ['a', 'b'] }))).toMatchObject({ ok: false, status: 400 });
    expect(evaluateVerification(q({ 'hub.challenge': 'x'.repeat(600) }))).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects a non-string token (array/object query injection)', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'tok-123';
    expect(evaluateVerification(q({ 'hub.verify_token': ['tok-123'] }))).toMatchObject({ ok: false, status: 403 });
  });
});

describe('verifySignature', () => {
  const secret = 'app-secret-xyz';
  const body = Buffer.from('{"object":"whatsapp_business_account","note":"caf\\u00e9"}');

  it('accepts the exact HMAC-SHA256 of the raw bytes', () => {
    expect(verifySignature(body, signBody(body, secret), secret)).toBe(true);
  });
  it('is case-insensitive about the hex digits and tolerant of surrounding whitespace', () => {
    const h = signBody(body, secret);
    expect(verifySignature(body, ` ${h.toUpperCase().replace('SHA256=', 'sha256=')} `, secret)).toBe(true);
  });
  it('rejects a changed body, a wrong secret, a missing/garbled header and the wrong algorithm', () => {
    const good = signBody(body, secret);
    expect(verifySignature(Buffer.from(body.toString() + ' '), good, secret)).toBe(false);
    expect(verifySignature(body, good, 'other-secret')).toBe(false);
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, '', secret)).toBe(false);
    expect(verifySignature(body, 'sha256=zz', secret)).toBe(false);
    expect(verifySignature(body, good.replace('sha256=', 'sha1='), secret)).toBe(false);
    expect(verifySignature(body, good.slice(0, -2), secret)).toBe(false);
  });
});

describe('getCallbackUrl', () => {
  it('is the backend origin plus the webhook path, whatever trailing slash or path API_BASE_URL has', () => {
    process.env.API_BASE_URL = 'https://api.piitrade.com/';
    expect(getCallbackUrl()).toBe(`https://api.piitrade.com${WEBHOOK_PATH}`);
    process.env.API_BASE_URL = 'https://api.piitrade.com/some/path';
    expect(getCallbackUrl()).toBe(`https://api.piitrade.com${WEBHOOK_PATH}`);
  });
  it('is null when unset or not a URL', () => {
    expect(getCallbackUrl()).toBeNull();
    process.env.API_BASE_URL = 'not a url';
    expect(getCallbackUrl()).toBeNull();
    process.env.API_BASE_URL = 'ftp://x.example';
    expect(getCallbackUrl()).toBeNull();
  });
});

const wrap = (value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field, value }] }],
});

describe('parseWebhook', () => {
  it('reads delivery receipts, including the failure reason', () => {
    const p = parseWebhook(wrap({
      messaging_product: 'whatsapp',
      statuses: [
        { id: 'wamid.A', status: 'delivered', timestamp: '1730000000', recipient_id: '256772123456' },
        { id: 'wamid.B', status: 'failed', timestamp: '1730000100', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      ],
    }));
    expect(p.statuses).toEqual([
      { messageId: 'wamid.A', status: 'delivered', at: new Date(1730000000 * 1000), errorCode: null, errorTitle: null },
      { messageId: 'wamid.B', status: 'failed', at: new Date(1730000100 * 1000), errorCode: 131026, errorTitle: 'Message undeliverable' },
    ]);
    expect(p.inboundMessages).toBe(0);
  });
  it('counts inbound messages without reading their content', () => {
    const p = parseWebhook(wrap({ messages: [{ from: '256772123456', id: 'wamid.X', type: 'text', text: { body: 'secret chat' } }] }));
    expect(p.inboundMessages).toBe(1);
    expect(JSON.stringify(p)).not.toContain('secret chat');
  });
  it('reports template / account events', () => {
    const p = parseWebhook(wrap({ event: 'REJECTED', message_template_name: 'piitrade_alert', reason: 'INVALID_FORMAT' }, 'message_template_status_update'));
    expect(p.events).toEqual([{ field: 'message_template_status_update', event: 'REJECTED', detail: 'piitrade_alert' }]);
    expect(needsAttention(p.events[0])).toBe(true);
    expect(needsAttention({ field: 'f', event: 'APPROVED', detail: null })).toBe(false);
    expect(needsAttention({ field: 'f', event: null, detail: null })).toBe(false);
  });
  it('skips malformed entries instead of throwing, and ignores other objects entirely', () => {
    const p = parseWebhook(wrap({ statuses: [null, 5, {}, { id: 'a' }, { id: 'b', status: 'weird' }, { id: 'ok', status: 'sent' }] }));
    expect(p.statuses.map((s) => s.messageId)).toEqual(['ok']);
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual({ statuses: [], inboundMessages: 0, events: [] });
    for (const junk of [null, undefined, 'x', 42, [], { entry: 'x' }, { object: 'whatsapp_business_account', entry: [null, { changes: 'x' }] }]) {
      expect(() => parseWebhook(junk)).not.toThrow();
    }
  });
  it('strips control characters and bounds the length of text that is later logged or stored', () => {
    const p = parseWebhook(wrap({ statuses: [{ id: 'f', status: 'failed', errors: [{ code: 1, title: `bad\nline\t${'y'.repeat(500)}` }] }] }));
    expect(p.statuses[0].errorTitle).not.toMatch(/[\r\n\t]/);
    expect(p.statuses[0].errorTitle!.length).toBe(120);
  });
});

describe('shouldApplyStatus (receipts can repeat or arrive out of order)', () => {
  it('moves forward only', () => {
    expect(shouldApplyStatus(null, 'sent')).toBe(true);
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyStatus('delivered', 'read')).toBe(true);
    expect(shouldApplyStatus(null, 'read')).toBe(true);
    expect(shouldApplyStatus('read', 'delivered')).toBe(false);
    expect(shouldApplyStatus('delivered', 'sent')).toBe(false);
    expect(shouldApplyStatus('sent', 'sent')).toBe(false);
  });
  it('failed is final and cannot overwrite a delivered/read message', () => {
    expect(shouldApplyStatus('sent', 'failed')).toBe(true);
    expect(shouldApplyStatus(null, 'failed')).toBe(true);
    expect(shouldApplyStatus('delivered', 'failed')).toBe(false);
    expect(shouldApplyStatus('read', 'failed')).toBe(false);
    expect(shouldApplyStatus('failed', 'delivered')).toBe(false);
    expect(shouldApplyStatus('failed', 'failed')).toBe(false);
  });
});

describe('collapseStatuses', () => {
  const s = (messageId: string, status: ParsedStatus['status']): ParsedStatus => ({ messageId, status, at: null, errorCode: null, errorTitle: null });
  it('keeps the furthest-along receipt per message regardless of arrival order', () => {
    const out = collapseStatuses([s('a', 'read'), s('a', 'sent'), s('b', 'sent'), s('b', 'delivered'), s('a', 'delivered')]);
    expect(Object.fromEntries(out.map((x) => [x.messageId, x.status]))).toEqual({ a: 'read', b: 'delivered' });
  });
  it('keeps failed over later non-failed receipts', () => {
    expect(collapseStatuses([s('a', 'failed'), s('a', 'delivered')])).toEqual([s('a', 'failed')]);
  });
});
