import { describe, it, expect, vi, afterEach } from 'vitest';
import { scheduleProactiveRefresh, cancelProactiveRefresh, registerProactiveRefresh } from '@/lib/sessionRefreshScheduler';

function tokenExpiringIn(ms: number) {
  const b = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b({ alg: 'HS256' })}.${b({ exp: Math.floor((Date.now() + ms) / 1000) })}.sig`;
}

describe('proactive refresh scheduler', () => {
  afterEach(() => { cancelProactiveRefresh(); vi.useRealTimers(); });
  it('does not fire immediately for a 70-day access token (setTimeout overflow)', () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue(undefined);
    registerProactiveRefresh(fn);
    scheduleProactiveRefresh(tokenExpiringIn(70 * 24 * 3600 * 1000));
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });
});
