import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoRefresh } from '@/lib/useAutoRefresh';

describe('useAutoRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('refreshes on the interval, on focus, and stops when unmounted', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh(fn, 1000));
    vi.advanceTimersByTime(3100);
    expect(fn).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(4);
    unmount();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event('focus'));
    expect(fn).toHaveBeenCalledTimes(4);
  });
  it('does nothing while disabled', () => {
    const fn = vi.fn();
    renderHook(() => useAutoRefresh(fn, 1000, false));
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
