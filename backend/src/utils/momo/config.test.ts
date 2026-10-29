import { describe, it, expect, afterEach } from 'vitest';
import { describeMomoConfigProblems, isMomoEnabled, isMomoSwitchedOn, momoSwitchSource, canSettleMomo, loadMomoConfig, normalizeCallbackUrl, getMomoConfig, getMomoSettlementConfig } from './config';
import { setMomoAdminSwitch } from './adminSwitch';

const GOOD_SANDBOX = {
  MTN_ENABLED: 'true',
  MTN_ENVIRONMENT: 'sandbox',
  MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef',
  MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab',
  API_BASE_URL: 'https://api.piitrade.test',
  MTN_CALLBACK_SECRET: 'c'.repeat(40),
} as Record<string, string | undefined>;

const GOOD_PROD = {
  ...GOOD_SANDBOX,
  MTN_ENVIRONMENT: 'production',
  MTN_TARGET_ENVIRONMENT: 'mtnuganda',
  MTN_BASE_URL: 'https://proxy.momoapi.mtn.com',
} as Record<string, string | undefined>;

describe('momo config', () => {
  it('accepts a complete sandbox configuration and defaults the currency to EUR there', () => {
    expect(describeMomoConfigProblems(GOOD_SANDBOX)).toEqual([]);
    expect(isMomoEnabled(GOOD_SANDBOX)).toBe(true);
    const cfg = loadMomoConfig(GOOD_SANDBOX);
    expect(cfg.currency).toBe('EUR');
    expect(cfg.callbackUrl).toBe('https://api.piitrade.test/api/payments/momo/callback');
  });

  it('accepts a complete production configuration and defaults the currency to UGX', () => {
    expect(describeMomoConfigProblems(GOOD_PROD)).toEqual([]);
    expect(loadMomoConfig(GOOD_PROD).currency).toBe('UGX');
  });

  it('is off unless MTN_ENABLED=true, even with a perfect configuration', () => {
    expect(isMomoEnabled({ ...GOOD_SANDBOX, MTN_ENABLED: undefined })).toBe(false);
    expect(isMomoEnabled({ ...GOOD_SANDBOX, MTN_ENABLED: 'false' })).toBe(false);
    expect(() => getMomoConfig({ ...GOOD_SANDBOX, MTN_ENABLED: 'false' })).toThrow(/not available/);
  });

  it('refuses the placeholder values from .env.example', () => {
    const p = describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_API_KEY: 'your_generated_secret_api_key_here', MTN_SUBSCRIPTION_KEY: '1a2b3c4d5e6f7g8h9i0j_your_primary_key' });
    expect(p.join('|')).toMatch(/MTN_API_KEY still contains a placeholder/);
    expect(p.join('|')).toMatch(/MTN_SUBSCRIPTION_KEY still contains a placeholder/);
  });

  it('refuses to mix sandbox and production', () => {
    expect(describeMomoConfigProblems({ ...GOOD_PROD, MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com' }).join('|')).toMatch(/point at the sandbox/);
    expect(describeMomoConfigProblems({ ...GOOD_PROD, MTN_TARGET_ENVIRONMENT: 'sandbox' }).join('|')).toMatch(/point at the sandbox/);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_TARGET_ENVIRONMENT: 'mtnuganda' }).join('|')).toMatch(/requires MTN_TARGET_ENVIRONMENT=sandbox/);
    expect(describeMomoConfigProblems({ ...GOOD_PROD, MTN_CURRENCY: 'EUR' }).join('|')).toMatch(/must be UGX in production/);
  });

  it('flags missing / malformed values', () => {
    expect(describeMomoConfigProblems({ MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox' }).length).toBeGreaterThanOrEqual(3);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_API_USER: 'not-a-uuid' }).join('|')).toMatch(/MTN_API_USER must be a UUID/);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_BASE_URL: 'http://insecure.example.net' }).join('|')).toMatch(/https/);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_ENVIRONMENT: 'staging' }).join('|')).toMatch(/must be "sandbox" or "production"/);
  });

  it('allows plain http only for a loopback host in sandbox mode', () => {
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_BASE_URL: 'http://127.0.0.1:4010' })).toEqual([]);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_BASE_URL: 'http://localhost:4010' })).toEqual([]);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_BASE_URL: 'http://sandbox.momodeveloper.mtn.com' }).join('|')).toMatch(/https/);
    expect(describeMomoConfigProblems({ ...GOOD_PROD, MTN_BASE_URL: 'http://127.0.0.1:4010' }).join('|')).toMatch(/https/);
  });

  it('requires a long callback secret whenever a callback URL is in play and https in production', () => {
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_CALLBACK_SECRET: undefined }).join('|')).toMatch(/MTN_CALLBACK_SECRET is required/);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_CALLBACK_SECRET: 'short' }).join('|')).toMatch(/at least 32/);
    expect(describeMomoConfigProblems({ ...GOOD_PROD, API_BASE_URL: 'http://api.piitrade.test' }).join('|')).toMatch(/must be https in production/);
    // no callback at all (no API_BASE_URL, no MTN_CALLBACK_URL) => polling only, secret not needed
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, API_BASE_URL: undefined, MTN_CALLBACK_SECRET: undefined })).toEqual([]);
    // ...and a callback secret is derived from JWT_SECRET when none is set (an explicit one still wins)
    const jwt = 'j'.repeat(48);
    const derived = loadMomoConfig({ ...GOOD_SANDBOX, MTN_CALLBACK_SECRET: undefined, JWT_SECRET: jwt }).callbackSecret;
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_CALLBACK_SECRET: undefined, JWT_SECRET: jwt })).toEqual([]);
    expect(loadMomoConfig({ ...GOOD_SANDBOX, JWT_SECRET: jwt }).callbackSecret).toBe('c'.repeat(40));
  });

  it('never echoes secret values in problem messages', () => {
    const msgs = describeMomoConfigProblems({ ...GOOD_SANDBOX, MTN_API_KEY: 'your_secret_key_SENTINEL', MTN_CALLBACK_SECRET: 'SENTINEL' }).join('|');
    expect(msgs).not.toMatch(/SENTINEL/);
  });

  it('appends the callback path to a bare origin (as in .env.example) and keeps an explicit path', () => {
    expect(normalizeCallbackUrl('https://api.example.com')).toBe('https://api.example.com/api/payments/momo/callback');
    expect(normalizeCallbackUrl('https://api.example.com/')).toBe('https://api.example.com/api/payments/momo/callback');
    expect(normalizeCallbackUrl('https://api.example.com/hooks/momo')).toBe('https://api.example.com/hooks/momo');
    expect(normalizeCallbackUrl('not a url')).toBeNull();
    expect(normalizeCallbackUrl('')).toBeNull();
  });
});

// The admin's on/off switch (Admin → MoMo Payments / Settings). null = never chosen: MTN_ENABLED decides.
describe('momo admin switch', () => {
  afterEach(() => setMomoAdminSwitch(null));

  it('with no admin choice, MTN_ENABLED decides exactly as before', () => {
    expect(momoSwitchSource()).toBe('env');
    expect(isMomoSwitchedOn({ ...GOOD_SANDBOX, MTN_ENABLED: 'true' })).toBe(true);
    expect(isMomoSwitchedOn({ ...GOOD_SANDBOX, MTN_ENABLED: undefined })).toBe(false);
  });

  it('an admin OFF beats MTN_ENABLED=true: new payments are refused', () => {
    setMomoAdminSwitch(false);
    expect(momoSwitchSource()).toBe('admin');
    expect(isMomoEnabled(GOOD_SANDBOX)).toBe(false);
    expect(() => getMomoConfig(GOOD_SANDBOX)).toThrow(/not available/);
  });

  it('an admin ON beats a missing MTN_ENABLED (no server redeploy needed)', () => {
    setMomoAdminSwitch(true);
    expect(isMomoEnabled({ ...GOOD_SANDBOX, MTN_ENABLED: undefined })).toBe(true);
    expect(loadMomoConfig({ ...GOOD_SANDBOX, MTN_ENABLED: undefined }).enabled).toBe(true);
  });

  it('an admin ON never makes a broken configuration usable (fail closed)', () => {
    setMomoAdminSwitch(true);
    const broken = { ...GOOD_SANDBOX, MTN_API_KEY: undefined };
    expect(isMomoEnabled(broken)).toBe(false);
    expect(canSettleMomo(broken)).toBe(false);
  });

  it('after an admin OFF, payments already in flight can still be settled', () => {
    setMomoAdminSwitch(false);
    expect(isMomoEnabled(GOOD_SANDBOX)).toBe(false);          // no NEW payments
    expect(canSettleMomo(GOOD_SANDBOX)).toBe(true);           // but callbacks / polling / reconciler keep working
    expect(getMomoSettlementConfig(GOOD_SANDBOX).apiUser).toBe(GOOD_SANDBOX.MTN_API_USER);
  });

  it('with MoMo never switched on at all, nothing is settled or started (original behaviour)', () => {
    const off = { ...GOOD_SANDBOX, MTN_ENABLED: 'false' };
    expect(canSettleMomo(off)).toBe(false);
    expect(() => getMomoSettlementConfig(off)).toThrow(/not available/);
  });
});
