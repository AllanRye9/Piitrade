import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const updateMany = vi.fn();
const notificationCreate = vi.fn();
const sendEmail = vi.fn();
vi.mock('./prisma', () => ({ prisma: { listing: { findMany: (...a: unknown[]) => findMany(...a), updateMany: (...a: unknown[]) => updateMany(...a) }, notification: { create: (...a: unknown[]) => notificationCreate(...a) } } }));
vi.mock('./email', () => ({ sendUnpaidListingReminderEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { sendUnpaidListingReminders } from './unpaidListings';

const row = { id: 'l1', title: 'iPhone', requestedTier: 'GOLD', userId: 'u1', user: { email: 'a@b.co', name: 'Ann' } };

describe('sendUnpaidListingReminders', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('emails + notifies once per unpaid listing', async () => {
    findMany.mockResolvedValue([row]);
    updateMany.mockResolvedValue({ count: 1 });
    expect(await sendUnpaidListingReminders()).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith('a@b.co', 'Ann', 'iPhone', 'GOLD', 'l1');
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });
  it('skips when another sweep already claimed it', async () => {
    findMany.mockResolvedValue([row]);
    updateMany.mockResolvedValue({ count: 0 });
    expect(await sendUnpaidListingReminders()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
