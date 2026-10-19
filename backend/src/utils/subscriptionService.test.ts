import { describe, it, expect, vi } from 'vitest';

// Pure-logic tests: the Prisma client (which needs DATABASE_URL) is never touched.
vi.mock('./prisma', () => ({ prisma: {} }));
import {
  isCurrent, effectiveStatus, daysRemaining, canTransition, computeTerm, needsReminder,
  resolveListingEntitlement, DAY_MS, EXPIRY_REMINDER_DAYS,
} from './subscriptionService';

const now = new Date('2026-10-17T12:00:00Z');
const d = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe('isCurrent / effectiveStatus (real-time, date-driven)', () => {
  it('is current only while ACTIVE and inside the term', () => {
    expect(isCurrent({ status: 'ACTIVE', startDate: d(-1), endDate: d(1) }, now)).toBe(true);
    expect(isCurrent({ status: 'ACTIVE', startDate: d(-5), endDate: d(-1) }, now)).toBe(false); // lapsed, sweep hasn't run
    expect(isCurrent({ status: 'ACTIVE', startDate: d(1), endDate: d(30) }, now)).toBe(false);  // chained, not started
    expect(isCurrent({ status: 'EXPIRED', startDate: d(-5), endDate: d(5) }, now)).toBe(false);
    expect(isCurrent({ status: 'PENDING_PAYMENT', startDate: d(-1), endDate: d(5) }, now)).toBe(false);
    expect(isCurrent({ status: 'CANCELLED', startDate: d(-1), endDate: d(5) }, now)).toBe(false);
  });
  it('end date is exclusive: at the exact end the subscription is over', () => {
    expect(isCurrent({ status: 'ACTIVE', startDate: d(-1), endDate: now }, now)).toBe(false);
  });
  it('reports a lapsed ACTIVE row as EXPIRED immediately', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startDate: d(-9), endDate: d(-1) }, now)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'ACTIVE', startDate: d(-1), endDate: d(1) }, now)).toBe('ACTIVE');
    expect(effectiveStatus({ status: 'PENDING_PAYMENT', startDate: d(-1), endDate: d(-0.5) }, now)).toBe('PENDING_PAYMENT');
  });
  it('rounds days remaining up and floors at zero', () => {
    expect(daysRemaining(d(2.1), now)).toBe(3);
    expect(daysRemaining(d(1), now)).toBe(1);
    expect(daysRemaining(d(-4), now)).toBe(0);
  });
});

describe('canTransition', () => {
  it('allows the normal lifecycle', () => {
    expect(canTransition('PENDING_PAYMENT', 'ACTIVE')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransition('ACTIVE', 'EXPIRED')).toBe(true);
    expect(canTransition('ACTIVE', 'CANCELLED')).toBe(true);
  });
  it('treats same-status as a no-op', () => {
    for (const s of ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'] as const) expect(canTransition(s, s)).toBe(true);
  });
  it('blocks resurrecting or regressing for owners', () => {
    expect(canTransition('EXPIRED', 'ACTIVE')).toBe(false);
    expect(canTransition('CANCELLED', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'PENDING_PAYMENT')).toBe(false);
    expect(canTransition('EXPIRED', 'PENDING_PAYMENT')).toBe(false);
  });
  it('lets an admin revive an ended subscription, nothing else', () => {
    expect(canTransition('EXPIRED', 'ACTIVE', true)).toBe(true);
    expect(canTransition('CANCELLED', 'ACTIVE', true)).toBe(true);
    expect(canTransition('ACTIVE', 'PENDING_PAYMENT', true)).toBe(false);
  });
});

describe('computeTerm', () => {
  it('starts now when nothing is running', () => {
    const t = computeTerm(now, 30);
    expect(t.startDate.getTime()).toBe(now.getTime());
    expect(t.endDate.getTime()).toBe(d(30).getTime());
  });
  it('chains after a term that still has time left, so early renewal loses no paid days', () => {
    const t = computeTerm(now, 30, d(10));
    expect(t.startDate.getTime()).toBe(d(10).getTime());
    expect(t.endDate.getTime()).toBe(d(40).getTime());
  });
  it('ignores an already-ended term', () => {
    expect(computeTerm(now, 30, d(-3)).startDate.getTime()).toBe(now.getTime());
  });
});

describe('needsReminder', () => {
  const base = { status: 'ACTIVE', startDate: d(-20), reminderSentAt: null as Date | null };
  it('reminds inside the window, once', () => {
    expect(needsReminder({ ...base, endDate: d(EXPIRY_REMINDER_DAYS) }, { name: 'Gold' }, now)).toBe(true);
    expect(needsReminder({ ...base, endDate: d(10) }, { name: 'Gold' }, now)).toBe(false);
    expect(needsReminder({ ...base, endDate: d(2), reminderSentAt: now }, { name: 'Gold' }, now)).toBe(false);
  });
  it('never reminds for lapsed, inactive or store-owner internal subscriptions', () => {
    expect(needsReminder({ ...base, endDate: d(-1) }, { name: 'Gold' }, now)).toBe(false);
    expect(needsReminder({ ...base, status: 'CANCELLED', endDate: d(2) }, { name: 'Gold' }, now)).toBe(false);
    expect(needsReminder({ ...base, endDate: d(2) }, { name: 'Store Owner — Unlimited Listings' }, now)).toBe(false);
  });
});

describe('resolveListingEntitlement', () => {
  const rental = (over = {}) => ({ status: 'ACTIVE', endDate: d(10), maxListings: 100, ...over });
  const sub = (over = {}) => ({ status: 'ACTIVE', startDate: d(-1), endDate: d(5), package: { name: 'Trial', maxListings: null as number | null }, ...over });

  it('an active web store wins and is capped by the rental', () => {
    expect(resolveListingEntitlement({ rental: rental(), subscription: sub(), ordinaryCap: 10, now }))
      .toMatchObject({ source: 'STORE', maxListings: 100 });
  });
  it('a lapsed rental no longer counts even before the sweep marks it EXPIRED', () => {
    expect(resolveListingEntitlement({ rental: rental({ endDate: d(-1) }), subscription: null, ordinaryCap: 10, now }).source).toBe('ORDINARY');
    expect(resolveListingEntitlement({ rental: rental({ status: 'EXPIRED' }), subscription: null, ordinaryCap: 10, now }).source).toBe('ORDINARY');
  });
  it('a current subscription grants its package cap (null = unlimited)', () => {
    expect(resolveListingEntitlement({ rental: null, subscription: sub(), ordinaryCap: 10, now }))
      .toMatchObject({ source: 'SUBSCRIPTION', maxListings: null });
    expect(resolveListingEntitlement({ rental: null, subscription: sub({ package: { name: 'Basic', maxListings: 25 } }), ordinaryCap: 10, now }).maxListings).toBe(25);
  });
  it('falls back to the ordinary cap when the subscription has lapsed or is unpaid', () => {
    expect(resolveListingEntitlement({ rental: null, subscription: sub({ endDate: d(-1) }), ordinaryCap: 10, now }))
      .toMatchObject({ source: 'ORDINARY', maxListings: 10 });
    expect(resolveListingEntitlement({ rental: null, subscription: sub({ status: 'PENDING_PAYMENT' }), ordinaryCap: 10, now }).source).toBe('ORDINARY');
  });
});
