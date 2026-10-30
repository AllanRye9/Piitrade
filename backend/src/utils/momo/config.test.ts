import { describe, it, expect } from 'vitest';
import { describeMomoConfigProblems, isMomoEnabled, loadMomoConfig, normalizeCallbackUrl, getMomoConfig, getMomoStatus, momoSwitchedOn, setMomoAdminSwitch, getMomoAdminSwitch, canSettleMomo, getMomoSettlementConfig } from './config';

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

describe('momo admin switch', () => {
  const ENV_OFF = { ...GOOD_SANDBOX, MTN_ENABLED: undefined };

  it('the admin switch ON enables MoMo with no MTN_ENABLED variable at all', () => {
    expect(isMomoEnabled(ENV_OFF, null)).toBe(false); // never set + env off => off (unchanged behaviour)
    expect(isMomoEnabled(ENV_OFF, true)).toBe(true);
  });

  it('the admin switch OFF wins over MTN_ENABLED=true', () => {
    expect(isMomoEnabled(GOOD_SANDBOX, null)).toBe(true); // never set => env decides (unchanged behaviour)
    expect(isMomoEnabled(GOOD_SANDBOX, false)).toBe(false);
    expect(() => getMomoConfig({ ...GOOD_SANDBOX })).not.toThrow();
  });

  it('is fail-closed: switch ON with an incomplete configuration is still off', () => {
    expect(isMomoEnabled({ ...ENV_OFF, MTN_API_KEY: undefined }, true)).toBe(false);
    expect(isMomoEnabled({ ...ENV_OFF, MTN_ENVIRONMENT: 'production' }, true)).toBe(false); // sandbox URL in production
  });

  it('momoSwitchedOn reflects the switch alone, ignoring the credentials', () => {
    expect(momoSwitchedOn({}, true)).toBe(true);
    expect(momoSwitchedOn({ MTN_ENABLED: 'true' }, false)).toBe(false);
    expect(momoSwitchedOn({ MTN_ENABLED: 'true' }, null)).toBe(true);
    expect(momoSwitchedOn({}, null)).toBe(false);
  });

  it('getMomoStatus says who set the switch and lists problems by name only', () => {
    const live = getMomoStatus(ENV_OFF, true);
    expect(live).toMatchObject({ enabled: true, switchedOn: true, switchSource: 'admin', environment: 'sandbox', problems: [] });

    const envDefault = getMomoStatus(GOOD_SANDBOX, null);
    expect(envDefault).toMatchObject({ enabled: true, switchSource: 'env' });

    const broken = getMomoStatus({ ...ENV_OFF, MTN_API_KEY: undefined }, true);
    expect(broken.enabled).toBe(false);
    expect(broken.switchedOn).toBe(true);
    expect(broken.problems).toEqual(['MTN_API_KEY is not set']);
    expect(JSON.stringify(live)).not.toContain(GOOD_SANDBOX.MTN_API_KEY as string);
  });

  it('the in-memory switch feeds the default arguments and can be cleared', () => {
    try {
      setMomoAdminSwitch(false);
      expect(getMomoAdminSwitch()).toBe(false);
      expect(isMomoEnabled(GOOD_SANDBOX)).toBe(false);
      expect(() => getMomoConfig(GOOD_SANDBOX)).toThrow(/not available/);
      setMomoAdminSwitch(true);
      expect(isMomoEnabled(ENV_OFF)).toBe(true);
      expect(loadMomoConfig(ENV_OFF).enabled).toBe(true);
    } finally {
      setMomoAdminSwitch(null);
    }
    expect(getMomoAdminSwitch()).toBeNull();
    expect(isMomoEnabled(GOOD_SANDBOX)).toBe(true); // back to the env default
  });
});

// Turning MoMo OFF stops NEW payments only: one the customer already approved on their phone must still be credited.
describe('settling payments that are already in flight', () => {
  const ENV = { ...GOOD_SANDBOX, MTN_ENABLED: 'true' };
  const sw = (v: boolean | null) => () => setMomoAdminSwitch(v);

  it('is allowed while MoMo is on', () => {
    expect(canSettleMomo(ENV, null)).toBe(true);
    expect(canSettleMomo({ ...ENV, MTN_ENABLED: 'false' }, true)).toBe(true);
  });

  it('is still allowed after an admin switches OFF (valid credentials), while new payments are refused', () => {
    expect(isMomoEnabled(ENV, false)).toBe(false);
    expect(canSettleMomo(ENV, false)).toBe(true);
    try {
      sw(false)();
      expect(() => getMomoConfig(ENV)).toThrow(/not available/);        // no NEW payments
      expect(getMomoSettlementConfig(ENV).apiUser).toBe(ENV.MTN_API_USER); // but in-flight ones settle
    } finally { sw(null)(); }
  });

  it('never runs when MoMo was never switched on (original behaviour: nothing was started)', () => {
    expect(canSettleMomo({ ...ENV, MTN_ENABLED: 'false' }, null)).toBe(false);
    expect(canSettleMomo({ ...ENV, MTN_ENABLED: undefined }, null)).toBe(false);
  });

  it('never runs on a broken configuration, whatever the switch says', () => {
    const broken = { ...ENV, MTN_API_KEY: undefined };
    expect(canSettleMomo(broken, true)).toBe(false);
    expect(canSettleMomo(broken, false)).toBe(false);
  });
});

