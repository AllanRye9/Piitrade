import { describe, it, expect, vi } from 'vitest';
vi.mock('./prisma', () => ({ prisma: {} }));
import { renewalWindowDays } from './storeRentalService';

describe('renewalWindowDays (derived from the package length, no per-plan constants)', () => {
  it('is 10% of the length', () => {
    expect(renewalWindowDays(30)).toBe(3);
    expect(renewalWindowDays(90)).toBe(9);
  });
  it('is at least 1 day and at most 30', () => {
    expect(renewalWindowDays(3)).toBe(1);
    expect(renewalWindowDays(365)).toBe(30);
    expect(renewalWindowDays(1000)).toBe(30);
  });
});
