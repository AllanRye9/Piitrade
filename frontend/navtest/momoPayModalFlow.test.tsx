import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { MomoPayModal } from '@/components/payments/MomoPayModal';

const base = { id: 'p1', purpose: 'LISTING_TIER', targetId: 't', amount: 50000, currency: 'UGX', msisdn: '256******456', failureMessage: null, receiptNumber: null, createdAt: new Date().toISOString() };

describe('MomoPayModal full flow', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); post.mockReset(); get.mockReset(); get.mockResolvedValue({ data: { momoEnabled: true, environment: 'sandbox' } }); });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['sandbox', 'sandbox'],
    ['production', 'production'],
  ])('goes form → waiting → done without throwing (%s)', async (_n, env) => {
    get.mockResolvedValue({ data: { momoEnabled: true, environment: env } });
    post.mockImplementation(async (url: string) => {
      if (url === '/payments/momo/initiate') return { data: { payment: { ...base, status: 'PENDING', completed: false }, resumed: false } };
      return { data: { payment: { ...base, status: 'SUCCESSFUL', completed: true, receiptNumber: 'PTR-1' } } };
    });
    const onCompleted = vi.fn();
    render(<MomoPayModal title="Gold" amountLabel="UGX 50,000" defaultPhone="0772123456" buildRequest={async () => ({ purpose: 'LISTING_TIER', listingId: 'l', tier: 'GOLD' })} onCompleted={onCompleted} onClose={() => {}} reloadAfterPayment={false} />);
    await act(async () => { await Promise.resolve(); });
    const input = document.getElementById('momo-phone') as HTMLInputElement;
    fireEvent.change(input, { target: { value: env === 'sandbox' ? '46733123450' : '772123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Pay UGX/ }));
    await waitFor(() => expect(screen.getByText(/Check your phone/)).toBeTruthy());
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    await waitFor(() => expect(screen.getByText(/Payment received/)).toBeTruthy());
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
