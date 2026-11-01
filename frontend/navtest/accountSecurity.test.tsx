import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const put = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { put: (...a: unknown[]) => put(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/lib/authStorage', () => ({ setAuthSession: vi.fn() }));
vi.mock('@/lib/sessionRefreshScheduler', () => ({ scheduleProactiveRefresh: vi.fn() }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
const updateUser = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'ann@example.com', username: null, isVerified: true }, updateUser }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/momo', async (orig) => ({ ...(await orig<object>()), useMomoConfig: () => ({ sandbox: false, enabled: true, loading: false }) }));

import { SignInSecurity } from '@/components/account/SignInSecurity';
import { MomoPayModal } from '@/components/payments/MomoPayModal';

beforeEach(() => { put.mockReset(); get.mockReset(); updateUser.mockReset(); });
afterEach(cleanup);

describe('SignInSecurity', () => {
  it('shows the sign-in email', () => {
    render(<SignInSecurity />);
    expect(screen.getByText('ann@example.com')).toBeTruthy();
  });
  it('blocks mismatched passwords without calling the API', () => {
    render(<SignInSecurity />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByText('The two new passwords do not match.')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });
  it('changes the password', async () => {
    put.mockResolvedValue({ data: { message: 'Password updated.', accessToken: 'tok' } });
    render(<SignInSecurity />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/me/password', { currentPassword: 'oldpass123', newPassword: 'newpass1234' }));
    await waitFor(() => expect(screen.getByText('Password updated.')).toBeTruthy());
  });
  it('saves a username with the current password', async () => {
    get.mockResolvedValue({ data: { available: true } });
    put.mockResolvedValue({ data: { username: 'ann.m', message: 'Username saved.' } });
    render(<SignInSecurity />);
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: 'Ann.M' } });
    fireEvent.change(await screen.findByLabelText('Current password (to confirm)'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/me/username', { username: 'Ann.M', password: 'secret123' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ username: 'ann.m' }));
  });
});

describe('MomoPayModal', () => {
  it('opens without crashing when the user has no saved phone (null)', () => {
    render(<MomoPayModal title="Test" defaultPhone={null} buildRequest={async () => ({ purpose: 'LISTING_TIER' } as never)} onCompleted={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Test')).toBeTruthy();
  });
});
