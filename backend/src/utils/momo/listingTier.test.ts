/**
 * Paying for a Gold/Platinum tier while the ad is still PENDING admin approval.
 * Runs the real resolveListingTier / provisionListingTier with only the database (and unrelated services) mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  listingFindUnique: vi.fn(), listingUpdateMany: vi.fn(),
  storeFindFirst: vi.fn(), siteConfigFindUnique: vi.fn(), notificationCreate: vi.fn(), paymentUpdate: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ Prisma: {}, PaymentPurpose: {}, PaymentStatus: {} }));
vi.mock('../prisma', () => ({
  prisma: {
    listing: { findUnique: db.listingFindUnique, updateMany: db.listingUpdateMany },
    storeRental: { findFirst: db.storeFindFirst },
    siteConfig: { findUnique: db.siteConfigFindUnique },
    notification: { create: db.notificationCreate },
    paymentTransaction: { update: db.paymentUpdate },
  },
}));
vi.mock('../subscriptionService', () => ({ subscribeToPackage: vi.fn(), requestRenewal: vi.fn(), requestUpgrade: vi.fn(), adminUpdateSubscription: vi.fn(), termsOf: vi.fn(), UPGRADE_MODES: [] }));
vi.mock('../storeRentalService', () => ({ confirmPendingRenewal: vi.fn() }));
vi.mock('../email', () => ({ sendSubscriptionActivatedEmail: vi.fn() }));
vi.mock('../categoryCounts', () => ({ invalidateCategoryCounts: vi.fn() }));
vi.mock('./receipt', () => ({ issueReceipt: vi.fn() }));
vi.mock('./client', () => ({ getMomoClient: vi.fn(), MomoApiError: class extends Error {} }));

import { resolveListingTier, provisionListingTier } from './paymentService';

const OWNER = { userId: 'seller-1', role: 'USER' };
const PRICING = { tierPricing: { currency: 'UGX', listingGoldPrice: 20000, listingPlatinumPrice: 50000, listingTierDurationDays: 30 } };
const listing = (over: Record<string, unknown> = {}) => ({ id: 'l1', userId: 'seller-1', title: 'Toyota Harrier', tier: 'FREE', status: 'ACTIVE', ...over });
const paidRow = (over: Record<string, unknown> = {}) => ({ id: 'pay1', targetId: 'l1', userId: 'seller-1', metadata: { tier: 'GOLD', durationDays: 30 }, ...over }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.storeFindFirst.mockResolvedValue(null);
  db.siteConfigFindUnique.mockResolvedValue(PRICING);
  db.listingUpdateMany.mockResolvedValue({ count: 1 });
  db.notificationCreate.mockResolvedValue({});
  db.paymentUpdate.mockResolvedValue({});
});

describe('resolveListingTier — starting the payment', () => {
  it('a PENDING (awaiting approval) ad can be paid for: the payment is resolved at the configured price', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING' }));
    const t = await resolveListingTier(OWNER, 'l1', 'gold');
    expect(t).toMatchObject({ targetId: 'l1', amount: 20000, label: 'Gold listing', metadata: { tier: 'GOLD', durationDays: 30 } });
  });

  it('an ACTIVE ad still works exactly as before', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'ACTIVE' }));
    expect((await resolveListingTier(OWNER, 'l1', 'PLATINUM')).amount).toBe(50000);
  });

  it.each(['REJECTED', 'HIDDEN', 'SOLD', 'EXPIRED'])('a %s ad is still refused with a clear 409', async (status) => {
    db.listingFindUnique.mockResolvedValue(listing({ status }));
    await expect(resolveListingTier(OWNER, 'l1', 'GOLD')).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status.toLowerCase()) });
  });

  it("someone else's ad is still a 404, and an already-upgraded ad a 409, even when pending", async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING', userId: 'someone-else' }));
    await expect(resolveListingTier(OWNER, 'l1', 'GOLD')).rejects.toMatchObject({ statusCode: 404 });
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING', tier: 'PLATINUM' }));
    await expect(resolveListingTier(OWNER, 'l1', 'GOLD')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('provisionListingTier — after the money has been taken', () => {
  it('a PENDING ad receives the tier (it is NOT sent to "needs review"), the payment is marked as awaiting approval, and the seller is told the full period starts on approval', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING' }));
    const r = await provisionListingTier(paidRow(), new Date('2026-10-30T10:00:00Z'));
    expect(r).toEqual({ kind: 'DONE', note: undefined });
    const update = db.listingUpdateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 'l1' });
    expect(update.data).toMatchObject({ tier: 'GOLD', requestedTier: null });
    expect(update.data.tierExpiresAt.getTime()).toBe(new Date('2026-11-29T10:00:00Z').getTime());
    const note = db.notificationCreate.mock.calls[0][0].data;
    expect(note.title).toBe('Gold visibility paid');
    expect(note.message).toMatch(/Payment received/);
    expect(note.message).toMatch(/full paid period as soon as it is approved/);
    // the marker that lets approval restart the window (utils/listingTierClock.ts); existing metadata is preserved
    expect(db.paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { metadata: { tier: 'GOLD', durationDays: 30, awaitingApproval: true } },
    });
  });

  it('a failure to write the marker never fails the payment (the customer already paid)', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING' }));
    db.paymentUpdate.mockRejectedValueOnce(new Error('db hiccup'));
    expect((await provisionListingTier(paidRow(), new Date())).kind).toBe('DONE');
    expect(db.notificationCreate).toHaveBeenCalled();
  });

  it('an ACTIVE ad is unchanged: "activated" notification', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'ACTIVE' }));
    expect((await provisionListingTier(paidRow(), new Date())).kind).toBe('DONE');
    expect(db.notificationCreate.mock.calls[0][0].data.title).toBe('Gold visibility activated');
    expect(db.paymentUpdate).not.toHaveBeenCalled(); // nothing to restart later: the ad was already live
  });

  it.each(['REJECTED', 'HIDDEN', 'SOLD', 'EXPIRED'])('if the ad became %s after the payment started, the money still goes to admin review (never silently lost)', async (status) => {
    db.listingFindUnique.mockResolvedValue(listing({ status }));
    const r = await provisionListingTier(paidRow(), new Date());
    expect(r.kind).toBe('REVIEW');
    expect((r as { note: string }).note).toMatch(new RegExp(status));
    expect(db.listingUpdateMany).not.toHaveBeenCalled();
    expect(db.paymentUpdate).not.toHaveBeenCalled();
  });

  it('still reviews a payment whose ad belongs to a different account, even if pending', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING', userId: 'someone-else' }));
    expect((await provisionListingTier(paidRow(), new Date())).kind).toBe('REVIEW');
  });

  it('never downgrades or double-applies: an ad that already has this tier or higher is just "done"', async () => {
    db.listingFindUnique.mockResolvedValue(listing({ status: 'PENDING', tier: 'PLATINUM' }));
    db.listingUpdateMany.mockResolvedValue({ count: 0 });
    const r = await provisionListingTier(paidRow(), new Date());
    expect(r).toMatchObject({ kind: 'DONE', note: expect.stringMatching(/already had/) });
    expect(db.notificationCreate).not.toHaveBeenCalled();
  });
});
