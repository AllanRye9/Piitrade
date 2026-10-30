import { describe, it, expect } from 'vitest';
import {
  mapProviderStatus, normalizeMsisdn, maskMsisdn, formatProviderAmount, checkDelayMs, isDueForCheck,
  signCallback, verifyCallbackSignature, paymentNote, canBuyListingTier,
} from './rules';

describe('mapProviderStatus', () => {
  it('maps the three MTN states and treats anything unknown as still pending (never paid)', () => {
    expect(mapProviderStatus('SUCCESSFUL')).toBe('SUCCESSFUL');
    expect(mapProviderStatus('successful')).toBe('SUCCESSFUL');
    expect(mapProviderStatus('FAILED')).toBe('FAILED');
    expect(mapProviderStatus('REJECTED')).toBe('FAILED');
    expect(mapProviderStatus('PENDING')).toBe('PENDING');
    expect(mapProviderStatus('ONGOING')).toBe('PENDING');
    expect(mapProviderStatus(undefined)).toBe('PENDING');
    expect(mapProviderStatus(42)).toBe('PENDING');
    expect(mapProviderStatus('')).toBe('PENDING');
  });
});

describe('normalizeMsisdn', () => {
  it('normalises the usual Ugandan formats', () => {
    for (const raw of ['0772123456', '+256772123456', '256772123456', '772123456', '0772 123 456', '+256-772-123-456']) {
      expect(normalizeMsisdn(raw)).toBe('256772123456');
    }
  });
  it('rejects junk', () => {
    for (const raw of ['', 'abc', '12345', '07721234', '+2567721234567', null, undefined, 772123456, '0772123456; DROP']) {
      expect(normalizeMsisdn(raw as unknown)).toBeNull();
    }
  });
  it('accepts international sandbox test numbers only when lenient', () => {
    expect(normalizeMsisdn('46733123450')).toBeNull();
    expect(normalizeMsisdn('46733123450', { lenient: true })).toBe('46733123450');
    expect(normalizeMsisdn('12', { lenient: true })).toBeNull();
  });
});

describe('maskMsisdn', () => {
  it('keeps only the country code and the last 3 digits', () => {
    expect(maskMsisdn('256772123456')).toBe('256******456');
    expect(maskMsisdn('12345')).toBe('***');
  });
});

describe('formatProviderAmount', () => {
  it('produces whole-number strings and refuses non-positive / non-finite amounts', () => {
    expect(formatProviderAmount(60000)).toBe('60000');
    expect(formatProviderAmount(1500.4)).toBe('1500');
    expect(formatProviderAmount(1500.5)).toBe('1501');
    expect(() => formatProviderAmount(0)).toThrow();
    expect(() => formatProviderAmount(-5)).toThrow();
    expect(() => formatProviderAmount(NaN)).toThrow();
    expect(() => formatProviderAmount(0.2)).toThrow();
  });
});

describe('check schedule', () => {
  it('starts quick, relaxes, and caps', () => {
    expect(checkDelayMs(0)).toBe(5000);
    expect(checkDelayMs(4)).toBe(15000);
    expect(checkDelayMs(7)).toBe(30000);
    expect(checkDelayMs(8)).toBe(60000);
    expect(checkDelayMs(500)).toBe(60000);
    expect(checkDelayMs(-3)).toBe(5000);
  });
  it('is due when never checked or when the gap has passed', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(isDueForCheck({ lastCheckedAt: null, checkCount: 0 }, now)).toBe(true);
    expect(isDueForCheck({ lastCheckedAt: new Date(now.getTime() - 4000), checkCount: 0 }, now)).toBe(false);
    expect(isDueForCheck({ lastCheckedAt: new Date(now.getTime() - 5000), checkCount: 0 }, now)).toBe(true);
    expect(isDueForCheck({ lastCheckedAt: new Date(now.getTime() - 59000), checkCount: 20 }, now)).toBe(false);
  });
});

describe('callback signing', () => {
  const secret = 's'.repeat(40);
  it('accepts the right signature and rejects anything else', () => {
    const sig = signCallback('ref-1', secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCallbackSignature('ref-1', sig, secret)).toBe(true);
    expect(verifyCallbackSignature('ref-2', sig, secret)).toBe(false);
    expect(verifyCallbackSignature('ref-1', sig, 'x'.repeat(40))).toBe(false);
    expect(verifyCallbackSignature('ref-1', undefined, secret)).toBe(false);
    expect(verifyCallbackSignature('ref-1', sig.slice(0, 10), secret)).toBe(false);
    expect(verifyCallbackSignature('ref-1', ['a'], secret)).toBe(false);
  });
});

describe('paymentNote', () => {
  it('is short plain ASCII', () => {
    expect(paymentNote('Gold listing')).toBe('Piitrade Gold listing');
    expect(paymentNote('Café ☕ plan')).toBe('Piitrade Caf  plan');
    expect(paymentNote('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('MTN Uganda numbers and failure wording', () => {
  it('accepts only MTN ranges (076/077/078/039) outside the sandbox', () => {
    for (const n of ['0772123456', '0782123456', '0762123456', '0392123456']) expect(normalizeMsisdn(n)).not.toBeNull();
    for (const n of ['0752123456', '0702123456', '0742123456', '0412123456']) expect(normalizeMsisdn(n)).toBeNull();
    expect(normalizeMsisdn('0752123456', { lenient: true })).toBe('256752123456'); // sandbox only
  });
  it('words every MTN failure code the payer can hit', async () => {
    const { friendlyFailure } = await import('./rules');
    expect(friendlyFailure('NOT_ENOUGH_FUNDS')).toMatch(/balance/);
    expect(friendlyFailure('PAYER_LIMIT_REACHED')).toMatch(/limit/);
    for (const c of ['APPROVAL_REJECTED', 'PAYMENT_NOT_APPROVED', 'TRANSACTION_CANCELED']) expect(friendlyFailure(c)).toMatch(/declined/);
    expect(friendlyFailure('EXPIRED')).toMatch(/timed out/);
    expect(friendlyFailure('PAYER_NOT_FOUND')).toMatch(/active MTN/);
    expect(friendlyFailure('SERVICE_UNAVAILABLE')).toMatch(/temporarily unavailable/);
    expect(friendlyFailure(null)).toMatch(/not been charged/);
  });
});

describe('canBuyListingTier', () => {
  it('lets a seller pay while the ad is still awaiting admin approval (payment never waits for moderation)', () => {
    expect(canBuyListingTier('PENDING')).toBe(true);
    expect(canBuyListingTier('ACTIVE')).toBe(true);
  });
  it('refuses ads that can never (or no longer) go live', () => {
    for (const status of ['SOLD', 'EXPIRED', 'HIDDEN', 'REJECTED', '', 'active', 'anything-else']) {
      expect(canBuyListingTier(status)).toBe(false);
    }
  });
});

