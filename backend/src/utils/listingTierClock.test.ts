/**
 * startPaidTierOnApproval: a Gold/Platinum tier paid while the ad was PENDING gets its FULL paid period from the
 * moment the ad goes live. Real function, database mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ paymentFindMany: vi.fn(), paymentUpdate: vi.fn(), listingFindUnique: vi.fn(), listingUpdate: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    paymentTransaction: { findMany: db.paymentFindMany, update: db.paymentUpdate },
    listing: { findUnique: db.listingFindUnique, update: db.listingUpdate },
  },
}));
vi.mock('./logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { startPaidTierOnApproval } from './listingTierClock';

const NOW = new Date('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const pay = (over: Record<string, unknown> = {}) => ({ id: 'pay1', targetId: 'l1', metadata: { tier: 'GOLD', durationDays: 30, awaitingApproval: true }, ...over });
const live = (over: Record<string, unknown> = {}) => ({ id: 'l1', status: 'ACTIVE', tier: 'GOLD', tierExpiresAt: new Date(NOW.getTime() + 20 * DAY), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  db.paymentFindMany.mockResolvedValue([pay()]);
  db.listingFindUnique.mockResolvedValue(live());
  db.listingUpdate.mockResolvedValue({});
  db.paymentUpdate.mockResolvedValue({});
});

describe('startPaidTierOnApproval', () => {
  it('does nothing (and does not even query) for an empty list', async () => {
    expect(await startPaidTierOnApproval([], NOW)).toBe(0);
    expect(db.paymentFindMany).not.toHaveBeenCalled();
  });

  it('only looks at successful tier payments still marked as awaiting approval, for the given listings', async () => {
    await startPaidTierOnApproval(['l1', 'l2'], NOW);
    expect(db.paymentFindMany.mock.calls[0][0].where).toEqual({
      purpose: 'LISTING_TIER', status: 'SUCCESSFUL', targetId: { in: ['l1', 'l2'] },
      metadata: { path: ['awaitingApproval'], equals: true },
    });
  });

  it('on approval, restarts the window to the FULL paid period from now and consumes the marker', async () => {
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(1);
    expect(db.listingUpdate).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { tierExpiresAt: new Date(NOW.getTime() + 30 * DAY) } });
    expect(db.paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { metadata: { tier: 'GOLD', durationDays: 30, awaitingApproval: false, tierStartedAt: NOW.toISOString() } },
    });
  });

  it('is once-only: with the marker already consumed there is nothing to select, so a later re-approval changes nothing', async () => {
    db.paymentFindMany.mockResolvedValue([]); // the query filter excludes awaitingApproval:false
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
    expect(db.paymentUpdate).not.toHaveBeenCalled();
  });

  it('while the ad is still PENDING it restarts nothing and keeps the marker for the real approval', async () => {
    db.listingFindUnique.mockResolvedValue(live({ status: 'PENDING' }));
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
    expect(db.paymentUpdate).not.toHaveBeenCalled();
  });

  it('never shortens a window: if the running one already ends later, it is left as is (marker still consumed)', async () => {
    db.listingFindUnique.mockResolvedValue(live({ tierExpiresAt: new Date(NOW.getTime() + 45 * DAY) }));
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
    expect(db.paymentUpdate).toHaveBeenCalled();
  });

  it.each(['REJECTED', 'HIDDEN', 'SOLD', 'EXPIRED'])('a %s ad is not restarted, but the marker is cleared so it is never reconsidered', async (status) => {
    db.listingFindUnique.mockResolvedValue(live({ status }));
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
    expect(db.paymentUpdate).toHaveBeenCalled();
  });

  it('a listing that no longer has the paid tier (e.g. a store plan took over) is not touched', async () => {
    db.listingFindUnique.mockResolvedValue(live({ tier: 'FREE', tierExpiresAt: null }));
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
  });

  it('ignores a payment with a nonsensical duration instead of writing a bad date', async () => {
    db.paymentFindMany.mockResolvedValue([pay({ metadata: { awaitingApproval: true, durationDays: 'abc' } })]);
    expect(await startPaidTierOnApproval(['l1'], NOW)).toBe(0);
    expect(db.listingUpdate).not.toHaveBeenCalled();
  });

  it('handles several listings in one approval', async () => {
    db.paymentFindMany.mockResolvedValue([pay(), pay({ id: 'pay2', targetId: 'l2', metadata: { tier: 'PLATINUM', durationDays: 14, awaitingApproval: true } })]);
    // l2 was paid for 14 days and 3 days have passed since, so 11 days are left on its (placeholder) window
    db.listingFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'l2'
      ? live({ id: 'l2', tier: 'PLATINUM', tierExpiresAt: new Date(NOW.getTime() + 11 * DAY) })
      : live());
    expect(await startPaidTierOnApproval(['l1', 'l2'], NOW)).toBe(2);
    expect(db.listingUpdate).toHaveBeenCalledWith({ where: { id: 'l2' }, data: { tierExpiresAt: new Date(NOW.getTime() + 14 * DAY) } });
  });

  it('NEVER throws, whatever the database does: approving an ad must not fail because of this', async () => {
    db.paymentFindMany.mockRejectedValueOnce(new Error('db down'));
    await expect(startPaidTierOnApproval(['l1'], NOW)).resolves.toBe(0);
    db.listingFindUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(startPaidTierOnApproval(['l1'], NOW)).resolves.toBe(0);
  });
});
