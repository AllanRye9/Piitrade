import { describe, it, expect } from 'vitest';
import {
  resolveDeadlineMinutes, computeDueAt, normalizeTransactionId, normalizePhone,
  validateProofInput, checkAmountReceived, resolvePaymentMethod,
  isExpiredUnpaid, withinLateProofWindow, LATE_PROOF_GRACE_DAYS,
  DEFAULT_PAYMENT_DEADLINE_MINUTES,
} from './paymentProof';

describe('resolveDeadlineMinutes (admin setting, untrusted)', () => {
  it('uses the admin value, rounded and clamped to 5 min – 24 h', () => {
    expect(resolveDeadlineMinutes(45)).toBe(45);
    expect(resolveDeadlineMinutes('20')).toBe(20);
    expect(resolveDeadlineMinutes(12.6)).toBe(13);
    expect(resolveDeadlineMinutes(1)).toBe(5);
    expect(resolveDeadlineMinutes(99999)).toBe(1440);
  });
  it('falls back to 30 for anything invalid or missing', () => {
    for (const bad of [undefined, null, '', '   ', 'abc', NaN, Infinity, {}, [], true]) {
      expect(resolveDeadlineMinutes(bad)).toBe(DEFAULT_PAYMENT_DEADLINE_MINUTES);
    }
    expect(DEFAULT_PAYMENT_DEADLINE_MINUTES).toBe(30);
  });
  it('computeDueAt adds the minutes', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    expect(computeDueAt(now, 30).toISOString()).toBe('2026-10-10T10:30:00.000Z');
    expect(computeDueAt(now, 'x' as unknown as number).toISOString()).toBe('2026-10-10T10:30:00.000Z');
  });
});

describe('normalizeTransactionId / normalizePhone', () => {
  it('cleans and upper-cases transaction IDs; rejects junk', () => {
    expect(normalizeTransactionId(' abc 123-456 ')).toBe('ABC123456');
    expect(normalizeTransactionId(12345678901)).toBe('12345678901');
    for (const bad of ['', '12345', 'ab!cd#ef', 'x'.repeat(33), null, undefined, {}]) {
      expect(normalizeTransactionId(bad)).toBeNull();
    }
  });
  it('keeps digits and an optional +, 9–15 digits', () => {
    expect(normalizePhone('0772 123 456')).toBe('0772123456');
    expect(normalizePhone('+256 772 123456')).toBe('+256772123456');
    for (const bad of ['', '12345', 'abc', '1'.repeat(16), null, undefined]) expect(normalizePhone(bad)).toBeNull();
  });
});

describe('validateProofInput', () => {
  const good = { transactionId: 'mp1234567', senderPhone: '0772123456', amount: '150,000' };
  it('accepts and normalises good input (amount with commas)', () => {
    expect(validateProofInput(good)).toEqual({
      ok: true, value: { transactionId: 'MP1234567', senderPhone: '0772123456', amountClaimed: 150000 },
    });
  });
  it('rejects each missing/invalid field with a specific message', () => {
    for (const bad of [{ ...good, transactionId: 'x' }, { ...good, senderPhone: '1' }, { ...good, amount: 0 }, { ...good, amount: -5 }, { ...good, amount: 'lots' }, {}]) {
      const r = validateProofInput(bad as any);
      expect(r.ok).toBe(false);
    }
  });
});

describe('checkAmountReceived', () => {
  it('exact and over payments are fine; under payments never', () => {
    expect(checkAmountReceived(100000, 100000)).toEqual({ ok: true, overpaidBy: 0 });
    expect(checkAmountReceived(100000, 105000)).toEqual({ ok: true, overpaidBy: 5000 });
    expect(checkAmountReceived(100000, 99999)).toEqual({ ok: false, shortBy: 1 });
    expect(checkAmountReceived(100000, 0)).toEqual({ ok: false, shortBy: 100000 });
    expect(checkAmountReceived(100000, NaN).ok).toBe(false);
    expect(checkAmountReceived(100000, -1).ok).toBe(false);
  });
});

describe('resolvePaymentMethod', () => {
  const on = { mobileMoneyEnabled: true, codEnabled: true };
  it('web-store (non-admin) sellers: mobile money only', () => {
    expect(resolvePaymentMethod({ ...on, requested: 'MOBILE_MONEY', sellerIsAdmin: false })).toEqual({ ok: true, method: 'MOBILE_MONEY' });
    expect(resolvePaymentMethod({ ...on, requested: 'CASH_ON_DELIVERY', sellerIsAdmin: false }).ok).toBe(false);
    expect(resolvePaymentMethod({ ...on, requested: undefined, sellerIsAdmin: false }).ok).toBe(false);
  });
  it('admin sellers: mobile money or cash on delivery', () => {
    expect(resolvePaymentMethod({ ...on, requested: 'CASH_ON_DELIVERY', sellerIsAdmin: true })).toEqual({ ok: true, method: 'CASH_ON_DELIVERY' });
    expect(resolvePaymentMethod({ ...on, requested: undefined, sellerIsAdmin: true })).toEqual({ ok: true, method: 'CASH_ON_DELIVERY' });
  });
  it('respects the admin on/off switches', () => {
    expect(resolvePaymentMethod({ mobileMoneyEnabled: false, codEnabled: true, requested: 'MOBILE_MONEY', sellerIsAdmin: true }).ok).toBe(false);
    expect(resolvePaymentMethod({ mobileMoneyEnabled: true, codEnabled: false, requested: 'CASH_ON_DELIVERY', sellerIsAdmin: true }).ok).toBe(false);
  });
  it('REGRESSION: card / bank / wallet / junk are refused (they can never be paid but would still pay the seller)', () => {
    for (const requested of ['CARD', 'BANK_TRANSFER', 'WALLET', 'bitcoin', 42, {}]) {
      expect(resolvePaymentMethod({ ...on, requested, sellerIsAdmin: true }).ok).toBe(false);
    }
  });
});

describe('late payments', () => {
  const mm = { method: 'MOBILE_MONEY', status: 'FAILED' };
  it('only an order the expiry sweep cancelled (CANCELLED + payment FAILED + mobile money) is eligible', () => {
    expect(isExpiredUnpaid({ status: 'CANCELLED' }, mm)).toBe(true);
    // cancelled by the buyer or an admin: the payment was left PENDING
    expect(isExpiredUnpaid({ status: 'CANCELLED' }, { method: 'MOBILE_MONEY', status: 'PENDING' })).toBe(false);
    expect(isExpiredUnpaid({ status: 'CANCELLED' }, { method: 'MOBILE_MONEY', status: 'COMPLETED' })).toBe(false);
    expect(isExpiredUnpaid({ status: 'CANCELLED' }, { method: 'CASH_ON_DELIVERY', status: 'FAILED' })).toBe(false);
    expect(isExpiredUnpaid({ status: 'PENDING' }, mm)).toBe(false);
    expect(isExpiredUnpaid({ status: 'REFUNDED' }, mm)).toBe(false);
    expect(isExpiredUnpaid(null, mm)).toBe(false);
    expect(isExpiredUnpaid({ status: 'CANCELLED' }, undefined)).toBe(false);
  });
  it('the grace period is 7 days from cancellation (inclusive), and bad dates never qualify', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(LATE_PROOF_GRACE_DAYS).toBe(7);
    expect(withinLateProofWindow(ago(1), now)).toBe(true);
    expect(withinLateProofWindow(ago(7), now)).toBe(true);
    expect(withinLateProofWindow(new Date(ago(7).getTime() - 1), now)).toBe(false);
    for (const bad of [null, undefined, '', 'garbage']) expect(withinLateProofWindow(bad, now)).toBe(false);
  });
});

