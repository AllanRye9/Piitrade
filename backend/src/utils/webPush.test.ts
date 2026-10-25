import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));

import { buildPushBody, isGoneStatus, isPushConfigured } from './webPush';

describe('buildPushBody', () => {
  it('produces the JSON the service worker reads and clips long text', () => {
    const body = JSON.parse(buildPushBody({ title: 't'.repeat(200), body: 'b'.repeat(500), url: '/messages', tag: 'x' }));
    expect(body.title).toHaveLength(80);
    expect(body.body).toHaveLength(160);
    expect(body.url).toBe('/messages');
    expect(body.tag).toBe('x');
  });
  it('refuses to put a non-relative URL in the payload', () => {
    expect(JSON.parse(buildPushBody({ title: 'a', body: 'b', url: 'https://evil.example' })).url).toBe('/notifications');
  });
});

describe('isGoneStatus', () => {
  it('prunes only permanently dead subscriptions', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(undefined)).toBe(false);
  });
});

describe('isPushConfigured', () => {
  it('needs both VAPID keys', () => {
    const pub = process.env.VAPID_PUBLIC_KEY; const priv = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    expect(isPushConfigured()).toBe(false);
    process.env.VAPID_PUBLIC_KEY = 'a';
    expect(isPushConfigured()).toBe(false);
    process.env.VAPID_PRIVATE_KEY = 'b';
    expect(isPushConfigured()).toBe(true);
    if (pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = pub;
    if (priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = priv;
  });
});
