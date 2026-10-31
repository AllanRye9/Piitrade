import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` on an interval, whenever the tab becomes visible again, when the window regains focus and
 * when the browser comes back online — so admin changes (packages, the MoMo switch) show up without a reload.
 * Pass a shorter `intervalMs` while the page is showing a "not available" state. `refresh` should not toggle a
 * loading spinner (this is a background check).
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number, enabled = true) {
  const ref = useRef(refresh);
  useEffect(() => { ref.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const run = () => { if (document.visibilityState !== 'hidden') ref.current(); };
    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
    };
  }, [intervalMs, enabled]);
}
