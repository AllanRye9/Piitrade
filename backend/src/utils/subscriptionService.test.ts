import { describe, it, expect, vi } from 'vitest';

// Pure-logic tests: the Prisma client (which needs DATABASE_URL) is never touched.
vi.mock('./prisma', () => ({ prisma: {} }));
import {
  isCurrent, effectiveStatus, daysRemaining, canTransition, computeTerm, needsReminder,
  resolveListingEntitlement, DAY_MS, EXPIRY_REMINDER_DAYS,
  startsActiveImmediately, packageSnapshot, termsOf, isUpgrade, computeUpgradeTerm, reviewMismatches, toSubscriptionView,
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

  it('an active merchant wins and is capped by the rental', () => {
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


// ─── Package snapshots, upgrades, approval review ────────────────────────────────

const pkg = (over: Partial<{ name: string; price: number; currency: string; durationDays: number; maxListings: number | null }> = {}) => ({
  name: 'Monthly', price: 50000, currency: 'UGX', durationDays: 30, maxListings: 20, ...over,
});

describe('packageSnapshot / termsOf', () => {
  it('records the package terms at request time', () => {
    const snap = packageSnapshot(pkg(), now);
    expect(snap).toMatchObject({ snapshotAt: now, packageName: 'Monthly', pricePaid: 50000, currency: 'UGX', durationDays: 30, maxListings: 20 });
  });
  it('keeps an unlimited cap as null (not "unset")', () => {
    expect(packageSnapshot(pkg({ maxListings: null }), now).maxListings).toBeNull();
  });
  it('uses the snapshot, so a later package edit does not change a running subscription', () => {
    const sub = { ...packageSnapshot(pkg(), now), package: pkg({ price: 99999, durationDays: 7, maxListings: 1, name: 'Renamed' }) };
    expect(termsOf(sub)).toEqual({ packageName: 'Monthly', price: 50000, currency: 'UGX', durationDays: 30, maxListings: 20 });
  });
  it('an unlimited snapshot stays unlimited even if the package is later capped', () => {
    const sub = { ...packageSnapshot(pkg({ maxListings: null }), now), package: pkg({ maxListings: 5 }) };
    expect(termsOf(sub).maxListings).toBeNull();
  });
  it('falls back to the package for legacy rows with no snapshot', () => {
    const t = termsOf({ package: pkg({ name: 'Legacy', maxListings: 3 }) });
    expect(t).toMatchObject({ packageName: 'Legacy', maxListings: 3, durationDays: 30 });
  });
  it('the listing cap used for entitlement comes from the snapshot', () => {
    const sub = { status: 'ACTIVE', startDate: d(-1), endDate: d(29), ...packageSnapshot(pkg({ maxListings: 20 }), now), package: pkg({ maxListings: 1 }) };
    const e = resolveListingEntitlement({ rental: null, subscription: sub, ordinaryCap: 10, now });
    expect(e).toMatchObject({ source: 'SUBSCRIPTION', maxListings: 20, label: 'Monthly' });
  });
});

describe('isUpgrade', () => {
  const week = { durationDays: 7, maxListings: 10, price: 0 };
  const month = { durationDays: 30, maxListings: 10, price: 50000 };
  const year = { durationDays: 365, maxListings: 10, price: 400000 };
  it('7 days -> 30 days, 7 days -> 1 year and 30 days -> 1 year are upgrades', () => {
    expect(isUpgrade(week, month)).toBe(true);
    expect(isUpgrade(week, year)).toBe(true);
    expect(isUpgrade(month, year)).toBe(true);
  });
  it('going shorter, or to the same package, is not an upgrade', () => {
    expect(isUpgrade(year, month)).toBe(false);
    expect(isUpgrade(month, week)).toBe(false);
    expect(isUpgrade(month, month)).toBe(false);
  });
  it('a free package is never an upgrade', () => {
    expect(isUpgrade(week, { ...year, isFree: true })).toBe(false);
  });
  it('same duration counts when the allowance or price is higher', () => {
    expect(isUpgrade(month, { ...month, maxListings: 50 })).toBe(true);
    expect(isUpgrade(month, { ...month, maxListings: null })).toBe(true);   // unlimited beats any cap
    expect(isUpgrade({ ...month, maxListings: null }, { ...month, maxListings: 50 })).toBe(false);
    expect(isUpgrade(month, { ...month, price: 60000 })).toBe(true);
  });
});

describe('computeUpgradeTerm', () => {
  it('AFTER_EXPIRY chains onto the current end so no paid days are lost', () => {
    const end = d(10);
    const t = computeUpgradeTerm(now, 'AFTER_EXPIRY', 30, end);
    expect(t.startDate.getTime()).toBe(end.getTime());
    expect(t.endDate.getTime()).toBe(end.getTime() + 30 * DAY_MS);
  });
  it('AFTER_EXPIRY with nothing running (already lapsed) starts now', () => {
    expect(computeUpgradeTerm(now, 'AFTER_EXPIRY', 30, d(-2)).startDate.getTime()).toBe(now.getTime());
  });
  it('IMMEDIATE starts now regardless of the current term', () => {
    const t = computeUpgradeTerm(now, 'IMMEDIATE', 365, d(10));
    expect(t.startDate.getTime()).toBe(now.getTime());
    expect(t.endDate.getTime()).toBe(now.getTime() + 365 * DAY_MS);
  });
});

describe('reviewMismatches (admin approval must carry the package details)', () => {
  const snap = { packageId: 'p1', packageName: 'Monthly', price: 50000, currency: 'UGX', durationDays: 30, maxListings: 20 };
  const ok = { packageId: 'p1', price: 50000, currency: 'UGX', durationDays: 30, maxListings: 20 };
  it('accepts details that match the request', () => {
    expect(reviewMismatches(snap, ok)).toEqual([]);
    expect(reviewMismatches({ ...snap, maxListings: null }, { ...ok, maxListings: null })).toEqual([]);
  });
  it('reports every field that differs', () => {
    expect(reviewMismatches(snap, { ...ok, price: 1, durationDays: 7, packageId: 'other' }).sort()).toEqual(['duration', 'package', 'price']);
    expect(reviewMismatches(snap, { ...ok, maxListings: null })).toEqual(['listing limit']);
  });
  it('rejects missing details', () => {
    expect(reviewMismatches(snap, {}).length).toBeGreaterThan(0);
  });
});

describe('toSubscriptionView', () => {
  it('flags an approved-but-not-started upgrade as scheduled and exposes the agreed terms', () => {
    const sub = { id: 's', status: 'ACTIVE', startDate: d(5), endDate: d(35), paymentRef: 'X', changeKind: 'UPGRADE', upgradeMode: 'AFTER_EXPIRY', ...packageSnapshot(pkg(), now), package: pkg() };
    const v = toSubscriptionView(sub, now);
    expect(v).toMatchObject({ isScheduled: true, isCurrent: false, daysRemaining: 0, changeKind: 'UPGRADE', upgradeMode: 'AFTER_EXPIRY' });
    expect(v.terms.price).toBe(50000);
  });
});


describe('startsActiveImmediately (free ticked AND price 0 — nothing else, CV included)', () => {
  it('only a free, zero-price package starts active', () => {
    expect(startsActiveImmediately({ isFree: true, price: 0 })).toBe(true);
  });
  it('a paid package waits for admin approval', () => {
    expect(startsActiveImmediately({ isFree: false, price: 50000 })).toBe(false);
  });
  it('"free" with a price, or a zero price without the Free tick, does not auto-activate', () => {
    expect(startsActiveImmediately({ isFree: true, price: 100 })).toBe(false);
    expect(startsActiveImmediately({ isFree: false, price: 0 })).toBe(false);
  });
});
