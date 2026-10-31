import { describe, it, expect, vi } from 'vitest';
vi.mock('@prisma/client', () => ({ Prisma: {}, PaymentPurpose: {}, PaymentStatus: {} }));
vi.mock('../prisma', () => ({ prisma: {} }));
vi.mock('../subscriptionService', () => ({ subscribeToPackage: vi.fn(), requestRenewal: vi.fn(), requestUpgrade: vi.fn(), adminUpdateSubscription: vi.fn() }));
vi.mock('../storeRentalService', () => ({ confirmPendingRenewal: vi.fn() }));
vi.mock('../email', () => ({ sendSubscriptionActivatedEmail: vi.fn() }));
vi.mock('../categoryCounts', () => ({ invalidateCategoryCounts: vi.fn() }));
vi.mock('./receipt', () => ({ issueReceipt: vi.fn() }));
import { MomoApiError } from './client';
import { explainRequestRejection } from './paymentService';

describe('explainRequestRejection', () => {
  it('tells payers what to fix when it is about them', () => {
    expect(explainRequestRejection(new MomoApiError('x', 400, false, 'NOT_ENOUGH_FUNDS')).message).toMatch(/balance/i);
    expect(explainRequestRejection(new MomoApiError('x', 400, false, 'PAYER_NOT_FOUND')).message).toMatch(/not an active/i);
    expect(explainRequestRejection(new MomoApiError('x', 400, false, null))).toMatchObject({ status: 400, ours: false });
  });
  it('treats credential / environment / outage failures as ours, not the number', () => {
    for (const http of [401, 403, 404, 500, 503, 429]) {
      const r = explainRequestRejection(new MomoApiError('x', http, http >= 500 || http === 429));
      expect(r).toMatchObject({ status: 503, ours: true });
      expect(r.message).not.toMatch(/check the number/i);
    }
    expect(explainRequestRejection(new MomoApiError('x', 400, false, 'INVALID_CURRENCY')).ours).toBe(true);
  });
});
