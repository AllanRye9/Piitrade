import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({ prisma: {} }));

import { parseSubscription, maskNumber } from './push';

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

describe('parseSubscription', () => {
  it('accepts a well-formed browser subscription', () => {
    expect(parseSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: KEYS })).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...KEYS,
    });
  });
  it('rejects non-https endpoints, bad keys and wrong shapes', () => {
    expect(parseSubscription({ endpoint: 'http://push.example/x', keys: KEYS })).toBeNull();
    expect(parseSubscription({ endpoint: 'not a url', keys: KEYS })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://x.example/' + 'a'.repeat(2100), keys: KEYS })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://x.example/a', keys: { p256dh: 'short', auth: KEYS.auth } })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://x.example/a', keys: { p256dh: KEYS.p256dh, auth: '<script>' } })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://x.example/a' })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription('x')).toBeNull();
    expect(parseSubscription({ endpoint: { $ne: 1 }, keys: KEYS })).toBeNull();
  });
});

describe('maskNumber', () => {
  it('hides the middle of the number', () => {
    expect(maskNumber('+256772123456')).toBe('+256••••••456');
    expect(maskNumber(null)).toBeNull();
    expect(maskNumber('+123')).toBe('•••');
  });
});
