import { describe, it, expect, vi, beforeEach } from 'vitest';
const findFirst = vi.hoisted(() => vi.fn());
vi.mock('./prisma', () => ({ prisma: { sellerPackage: { findFirst } } }));
import { getActiveCvPackage } from './cvPackage';

const day = 86_400_000;
describe('getActiveCvPackage window', () => {
  beforeEach(() => findFirst.mockReset());
  it('an old package whose window has passed is not active', async () => {
    findFirst.mockResolvedValue({ id: 'a', createdAt: new Date(Date.now() - 40 * day), activatedAt: null, durationDays: 30 });
    expect(await getActiveCvPackage()).toBeNull();
  });
  it('re-activating it starts a fresh window', async () => {
    findFirst.mockResolvedValue({ id: 'a', createdAt: new Date(Date.now() - 40 * day), activatedAt: new Date(Date.now() - 1 * day), durationDays: 30 });
    expect((await getActiveCvPackage())?.id).toBe('a');
  });
});
