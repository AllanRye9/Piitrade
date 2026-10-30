import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
const put = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));

import { MomoSwitchCard, type MomoAdminStatus } from '@/components/admin/MomoSwitchCard';

const LIVE: MomoAdminStatus = { enabled: true, switchedOn: true, switchSource: 'admin', environment: 'sandbox', problems: [] };
const OFF: MomoAdminStatus = { enabled: false, switchedOn: false, switchSource: 'admin', environment: 'sandbox', problems: [] };
const OFF_BROKEN: MomoAdminStatus = { ...OFF, problems: ['MTN_API_KEY is not set', 'MTN_API_USER is not set'] };

beforeEach(() => { get.mockReset(); put.mockReset(); });
afterEach(cleanup);

const switchEl = () => screen.getByRole('switch', { name: 'MTN MoMo payments' });

describe('Admin → MoMo switch card', () => {
  it('shows LIVE and the environment, with the switch on', async () => {
    get.mockResolvedValue({ data: LIVE });
    render(<MomoSwitchCard />);
    expect(await screen.findByText('LIVE')).toBeTruthy();
    expect(screen.getByText('sandbox')).toBeTruthy();
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/no real money moves/i)).toBeTruthy();
  });

  it('turning OFF asks for confirmation first; Cancel changes nothing', async () => {
    get.mockResolvedValue({ data: LIVE });
    render(<MomoSwitchCard />);
    await screen.findByText('LIVE');
    fireEvent.click(switchEl());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
  });

  it('confirming OFF sends { enabled: false } and shows OFF', async () => {
    get.mockResolvedValue({ data: LIVE });
    put.mockResolvedValue({ data: OFF });
    render(<MomoSwitchCard />);
    await screen.findByText('LIVE');
    fireEvent.click(switchEl());
    fireEvent.click(screen.getByRole('button', { name: 'Turn off MoMo' }));
    await screen.findByText('OFF');
    expect(put).toHaveBeenCalledWith('/payments/admin/switch', { enabled: false });
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('turning ON (credentials complete) needs no confirmation and sends { enabled: true }', async () => {
    get.mockResolvedValue({ data: OFF });
    put.mockResolvedValue({ data: LIVE });
    render(<MomoSwitchCard />);
    await screen.findByText('OFF');
    fireEvent.click(switchEl());
    await screen.findByText('LIVE');
    expect(put).toHaveBeenCalledWith('/payments/admin/switch', { enabled: true });
  });

  it('cannot be turned on while credentials are incomplete: switch disabled, problems listed, nothing sent', async () => {
    get.mockResolvedValue({ data: OFF_BROKEN });
    render(<MomoSwitchCard />);
    await screen.findByText('OFF');
    expect((switchEl() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('MTN_API_KEY is not set')).toBeTruthy();
    expect(screen.getByText('MTN_API_USER is not set')).toBeTruthy();
    fireEvent.click(switchEl());
    expect(put).not.toHaveBeenCalled();
  });

  it('a server refusal (409) shows its message and the problems, and the switch stays off', async () => {
    get.mockResolvedValue({ data: OFF });
    put.mockRejectedValue({ response: { status: 409, data: { message: 'MTN MoMo cannot be switched on until its configuration is complete.', ...OFF_BROKEN } } });
    render(<MomoSwitchCard />);
    await screen.findByText('OFF');
    fireEvent.click(switchEl());
    expect(await screen.findByText(/cannot be switched on/)).toBeTruthy();
    expect(screen.getByText('MTN_API_KEY is not set')).toBeTruthy();
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
  });

  it('switch ON but credentials broken reads "ON · NOT WORKING" and tells the admin what to fix', async () => {
    get.mockResolvedValue({ data: { enabled: false, switchedOn: true, switchSource: 'admin', environment: 'production', problems: ['MTN_CALLBACK_URL is not a valid URL'] } });
    render(<MomoSwitchCard />);
    expect(await screen.findByText('ON · NOT WORKING')).toBeTruthy();
    expect(screen.getByText(/Fix these to make MoMo work/)).toBeTruthy();
    expect(screen.getByText('MTN_CALLBACK_URL is not a valid URL')).toBeTruthy();
    expect((switchEl() as HTMLButtonElement).disabled).toBe(false); // turning it OFF must always be possible
  });

  it('explains when the MTN_ENABLED variable (not an admin) is still deciding', async () => {
    get.mockResolvedValue({ data: { ...LIVE, switchSource: 'env' } });
    render(<MomoSwitchCard />);
    expect(await screen.findByText(/MTN_ENABLED server variable is deciding/)).toBeTruthy();
  });

  it('a failed load shows an error with Try again, which recovers', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    get.mockResolvedValueOnce({ data: LIVE });
    render(<MomoSwitchCard />);
    expect(await screen.findByText(/Couldn't load the MoMo switch/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('LIVE')).toBeTruthy());
  });
});
