import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const get = vi.fn(); const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
const push = vi.hoisted(() => ({ enablePush: vi.fn(), getCurrentSubscription: vi.fn() }));
vi.mock('@/lib/push', async () => {
  const real = await vi.importActual<typeof import('@/lib/push')>('@/lib/push');
  return { ...real, isPushSupported: () => true, enablePush: push.enablePush, getCurrentSubscription: push.getCurrentSubscription, resyncSubscription: vi.fn(), disablePush: vi.fn() };
});
import { NotificationSettings } from '@/components/notifications/NotificationSettings';

function setPermission(p: NotificationPermission) { (globalThis as unknown as { Notification: unknown }).Notification = { permission: p }; }

describe('blocked browser notifications', () => {
  beforeEach(() => {
    get.mockResolvedValue({ data: { push: { available: true, publicKey: 'k', devices: 0 }, whatsapp: { available: true, verified: false, number: null, pendingVerification: false }, notifyMessages: true } });
    push.getCurrentSubscription.mockResolvedValue(null);
    push.enablePush.mockResolvedValue('enabled');
    setPermission('denied');
  });
  it('explains how to unblock, and switches alerts on by itself once allowed', async () => {
    render(<NotificationSettings />);
    expect(await screen.findByTestId('unblock-help')).toBeTruthy();
    expect(screen.getByText(/I allowed it/)).toBeTruthy();
    setPermission('granted');
    await act(async () => { fireEvent.click(screen.getByText(/I allowed it/)); });
    await act(async () => { await Promise.resolve(); });
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('unblock-help')).toBeNull();
    expect(screen.getByText('On for this device.')).toBeTruthy();
  });
});
