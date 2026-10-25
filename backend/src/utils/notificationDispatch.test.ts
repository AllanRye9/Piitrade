import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));

import {
  notificationUrl, notificationTag, absoluteUrl, decideWhatsApp, WHATSAPP_DAILY_CAP,
  WHATSAPP_MESSAGE_GAP_MS, WHATSAPP_ONLINE_WINDOW_MS, WHATSAPP_TYPES, WhatsAppDecisionInput,
} from './notificationDispatch';

describe('notificationUrl', () => {
  it('prefers a safe site-relative href', () => {
    expect(notificationUrl('OFFER_RECEIVED', { href: '/messages?with=u1&listing=l1' })).toBe('/messages?with=u1&listing=l1');
  });
  it('never returns external or protocol-relative links', () => {
    expect(notificationUrl('SYSTEM', { href: 'https://evil.example/x' })).toBe('/notifications');
    expect(notificationUrl('SYSTEM', { href: '//evil.example/x' })).toBe('/notifications');
    expect(notificationUrl('SYSTEM', { href: 'javascript:alert(1)' })).toBe('/notifications');
  });
  it('builds the chat link for messages', () => {
    expect(notificationUrl('MESSAGE_RECEIVED', { senderId: 'u 1', listingId: 'l1' })).toBe('/messages?with=u%201&listing=l1');
    expect(notificationUrl('MESSAGE_RECEIVED', { senderId: 'u1', listingId: null })).toBe('/messages?with=u1&listing=none');
    expect(notificationUrl('MESSAGE_RECEIVED', {})).toBe('/messages');
  });
  it('falls back to the notifications page for anything else, including odd data', () => {
    expect(notificationUrl('LISTING_APPROVED', null)).toBe('/notifications');
    expect(notificationUrl('LISTING_APPROVED', 'x')).toBe('/notifications');
    expect(notificationUrl('LISTING_APPROVED', [1])).toBe('/notifications');
  });
});

describe('notificationTag', () => {
  it('collapses per chat partner and per offer, otherwise unique per notification', () => {
    expect(notificationTag({ id: 'n1', type: 'MESSAGE_RECEIVED', data: { senderId: 'u1' } })).toBe('msg-u1');
    expect(notificationTag({ id: 'n2', type: 'OFFER_COUNTERED', data: { offerId: 'o9' } })).toBe('offer-o9');
    expect(notificationTag({ id: 'n3', type: 'SYSTEM', data: null })).toBe('n3');
  });
});

describe('absoluteUrl', () => {
  it('joins the frontend origin without doubling slashes', () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://shop.example.com/';
    expect(absoluteUrl('/messages')).toBe('https://shop.example.com/messages');
    delete process.env.FRONTEND_URL;
    expect(absoluteUrl('/messages')).toBe('https://piitrade.com/messages');
    if (prev !== undefined) process.env.FRONTEND_URL = prev;
  });
});

describe('decideWhatsApp', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const base: WhatsAppDecisionInput = {
    type: 'OFFER_RECEIVED', notifyMessages: true, verified: true,
    lastActiveAt: new Date(now.getTime() - 60 * 60 * 1000), now, sentLast24h: 0, lastMessageAlertAt: null,
  };
  const reason = (o: Partial<WhatsAppDecisionInput>) => {
    const d = decideWhatsApp({ ...base, ...o });
    return d.send ? 'SEND' : d.reason;
  };

  it('sends an eligible alert to a verified, offline user', () => {
    expect(reason({})).toBe('SEND');
  });
  it('skips ineligible types and unverified numbers', () => {
    expect(reason({ type: 'SYSTEM' })).toBe('type-not-eligible');
    expect(reason({ type: 'KYC_APPROVED' })).toBe('type-not-eligible');
    expect(reason({ verified: false })).toBe('number-not-verified');
  });
  it('mutes chat messages only when the user turned them off', () => {
    expect(reason({ type: 'MESSAGE_RECEIVED', notifyMessages: false })).toBe('messages-muted');
    expect(reason({ type: 'OFFER_RECEIVED', notifyMessages: false })).toBe('SEND');
  });
  it('skips users who are active on the site right now', () => {
    expect(reason({ lastActiveAt: new Date(now.getTime() - WHATSAPP_ONLINE_WINDOW_MS + 1000) })).toBe('user-online');
    expect(reason({ lastActiveAt: new Date(now.getTime() - WHATSAPP_ONLINE_WINDOW_MS) })).toBe('SEND');
    expect(reason({ lastActiveAt: null })).toBe('SEND');
  });
  it('enforces the daily cap', () => {
    expect(reason({ sentLast24h: WHATSAPP_DAILY_CAP - 1 })).toBe('SEND');
    expect(reason({ sentLast24h: WHATSAPP_DAILY_CAP })).toBe('daily-cap');
  });
  it('rate-limits chat-message alerts but not offers', () => {
    const recent = new Date(now.getTime() - WHATSAPP_MESSAGE_GAP_MS + 1000);
    expect(reason({ type: 'MESSAGE_RECEIVED', lastMessageAlertAt: recent })).toBe('message-gap');
    expect(reason({ type: 'MESSAGE_RECEIVED', lastMessageAlertAt: new Date(now.getTime() - WHATSAPP_MESSAGE_GAP_MS) })).toBe('SEND');
    expect(reason({ type: 'OFFER_RECEIVED', lastMessageAlertAt: recent })).toBe('SEND');
  });
  it('only lists notification types that exist in the schema', () => {
    for (const t of WHATSAPP_TYPES) expect(t).toMatch(/^[A-Z_]+$/);
  });
});
