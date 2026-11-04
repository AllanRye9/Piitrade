import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWhatsAppAlert, sendWhatsAppVerificationCode } from './whatsapp';

const SAVED = { ...process.env };
const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '12345';
});
afterEach(() => { process.env = { ...SAVED }; vi.unstubAllGlobals(); });

describe('WhatsApp sends return the message id Meta assigned', () => {
  it('alert: ok with the wamid from the response (what delivery receipts later refer to)', async () => {
    const fetchMock = vi.fn(async () => json(200, { messaging_product: 'whatsapp', contacts: [{ input: '256772123456', wa_id: '256772123456' }], messages: [{ id: 'wamid.HBgM123' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendWhatsAppAlert('+256772123456', { title: 'T', message: 'M', url: 'https://piitrade.com/x' });
    expect(r).toEqual({ ok: true, messageId: 'wamid.HBgM123' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/12345/messages');
  });
  it('verification code: ok with the wamid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { messages: [{ id: 'wamid.CODE' }] })));
    expect(await sendWhatsAppVerificationCode('+256772123456', '123456')).toEqual({ ok: true, messageId: 'wamid.CODE' });
  });
  it('still a success when the body is empty, not JSON, or has no id (id simply absent)', async () => {
    for (const body of ['', 'OK', '{}', '{"messages":[]}', '{"messages":[{"id":5}]}']) {
      vi.stubGlobal('fetch', vi.fn(async () => json(200, body)));
      const r = await sendWhatsAppAlert('+256772123456', { title: 'T', message: 'M', url: 'u' });
      expect(r.ok).toBe(true);
      expect(r.messageId).toBeUndefined();
    }
  });
  it('failures are unchanged: ok=false, a safe detail, no id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { message: 'Param template name is invalid', code: 100 } })));
    const r = await sendWhatsAppAlert('+256772123456', { title: 'T', message: 'M', url: 'u' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('HTTP 400: Param template name is invalid');
    expect(r.messageId).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('tok');
  });
  it('network errors are unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    expect(await sendWhatsAppAlert('+256772123456', { title: 'T', message: 'M', url: 'u' })).toEqual({ ok: false, error: 'socket hang up' });
  });
});
