import { describe, it, expect, vi } from 'vitest';

// Pure-logic tests: the Prisma client (which needs DATABASE_URL) is never touched.
vi.mock('./prisma', () => ({ prisma: {} }));
import { planRentalUpdate, RentalSnapshot } from './storeRentalService';

const now = new Date('2026-10-17T12:00:00Z');
const day = 86_400_000;
const base: RentalSnapshot = { status: 'PENDING', endDate: new Date(now.getTime() + 30 * day), tier: 'FREE', fee: 0, maxListings: 100 };
const ok = { now, kycVerified: true };

describe('planRentalUpdate — activation', () => {
  it('activates a pending, KYC-verified rental with a future end date', () => {
    const p = planRentalUpdate(base, { status: 'active' }, ok);
    expect(p).toMatchObject({ ok: true, finalActive: true, activating: true, ending: false });
    if (p.ok) expect(p.data.status).toBe('ACTIVE');
  });
  it('refuses to activate until the applicant passed KYC', () => {
    const p = planRentalUpdate(base, { status: 'ACTIVE' }, { now, kycVerified: false });
    expect(p).toMatchObject({ ok: false, httpStatus: 400 });
  });
  it('refuses to activate with an end date that has already passed (the sweep would undo it)', () => {
    const past = new Date(now.getTime() - day);
    expect(planRentalUpdate({ ...base, endDate: past }, { status: 'ACTIVE' }, ok)).toMatchObject({ ok: false });
    // ...but succeeds once the admin supplies a new future end date in the same request
    const fixed = planRentalUpdate({ ...base, endDate: past }, { status: 'ACTIVE', endDate: new Date(now.getTime() + 10 * day).toISOString() }, ok);
    expect(fixed).toMatchObject({ ok: true, activating: true });
  });
  it('re-activating an already-ACTIVE rental is a repair, not a new activation, and needs no KYC re-check', () => {
    const p = planRentalUpdate({ ...base, status: 'ACTIVE' }, { status: 'ACTIVE' }, { now, kycVerified: false });
    expect(p).toMatchObject({ ok: true, finalActive: true, activating: false, ending: false });
  });
  it('an ACTIVE rental cannot be left with a past end date via an edit', () => {
    const p = planRentalUpdate({ ...base, status: 'ACTIVE' }, { endDate: new Date(now.getTime() - day).toISOString() }, ok);
    expect(p).toMatchObject({ ok: false });
  });
});

describe('planRentalUpdate — ending', () => {
  it.each(['EXPIRED', 'CANCELLED', 'PENDING'])('ACTIVE -> %s freezes the Merchant account', (status) => {
    const p = planRentalUpdate({ ...base, status: 'ACTIVE' }, { status }, ok);
    expect(p).toMatchObject({ ok: true, ending: true, finalActive: false });
  });
  it('a non-active rental changing between non-active states ends nothing', () => {
    expect(planRentalUpdate({ ...base, status: 'EXPIRED' }, { status: 'CANCELLED' }, ok)).toMatchObject({ ok: true, ending: false });
  });
});

describe('planRentalUpdate — validation', () => {
  it('rejects bad values instead of writing NaN / invalid dates', () => {
    for (const input of [
      { status: 'BOGUS' }, { tier: 'DIAMOND' }, { fee: 'abc' }, { fee: -1 }, { fee: Infinity },
      { maxListings: 1.5 }, { maxListings: -3 }, { maxListings: 'x' }, { maxListings: 10_000_000 }, { endDate: 'not a date' },
    ]) {
      expect(planRentalUpdate(base, input, ok)).toMatchObject({ ok: false, httpStatus: 400 });
    }
  });
  it('keeps existing values for omitted fields and normalises case', () => {
    const p = planRentalUpdate(base, { tier: 'gold', fee: '150000', maxListings: '250' }, ok);
    expect(p.ok && p.data).toMatchObject({ status: 'PENDING', tier: 'GOLD', fee: 150000, maxListings: 250 });
  });
  it('ignores null/empty fields rather than treating them as changes', () => {
    const p = planRentalUpdate(base, { status: '', tier: null, fee: undefined }, ok);
    expect(p.ok && p.data).toMatchObject({ status: 'PENDING', tier: 'FREE', fee: 0 });
  });
});
