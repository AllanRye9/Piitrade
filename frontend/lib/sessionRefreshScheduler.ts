'use client';

/**
 * sessionRefreshScheduler.ts
 *
 * The access token is short-lived (12h by default — see backend
 * JWT_EXPIRES_IN). Until now, refreshing it only ever happened reactively:
 * a request would fail with 401, and lib/api.ts's response interceptor
 * would refresh and retry. That's fine for a quick click, but it means
 * someone who's been quietly filling out a long form (e.g. "Post a
 * listing", with photos) for the better part of an hour hits their FIRST
 * 401 exactly when they finally click Submit — the worst possible moment
 * for a refresh to fail.
 *
 * This module schedules a silent refresh a few minutes BEFORE the current
 * access token actually expires, while the user is still active, so the
 * reactive 401 path is rarely needed at all during normal use. It's purely
 * an optimization — if a scheduled refresh is missed or fails (tab was
 * asleep, brief network blip), the reactive refresh-on-401 flow in
 * lib/api.ts still catches it on the next real request, so nothing here is
 * relied on for actually keeping the session valid.
 */

// Refresh this long before the token's real expiry — comfortably longer
// than any single request/retry round trip, so a scheduled refresh always
// lands well before the token could actually be rejected.
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const MIN_DELAY_MS = 5_000;
// setTimeout overflows (fires immediately) above 2^31-1 ms (~24.8 days); with 70-day access tokens, cap the wait and reschedule.
const MAX_DELAY_MS = 12 * 60 * 60 * 1000;

let refreshFn: (() => Promise<unknown>) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Decodes a JWT's `exp` claim without verifying the signature — only used to time a background refresh; the server remains the sole authority on whether a token is actually valid. */
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Wires up the actual refresh call. Called once from lib/api.ts, which owns
 * the real refreshAccessToken() implementation — kept separate to avoid a
 * circular import (api.ts already imports authStorage.ts, and this module
 * needs to stay import-free of api.ts).
 */
export function registerProactiveRefresh(fn: () => Promise<unknown>): void {
  refreshFn = fn;
}

/** Schedules (or reschedules) a silent refresh based on the given access token's real expiry. Call this any time a fresh token is set — on login and after every refresh. */
export function scheduleProactiveRefresh(accessToken: string): void {
  if (typeof window === 'undefined') return;
  cancelProactiveRefresh();

  const expiryMs = decodeJwtExpiryMs(accessToken);
  if (!expiryMs) return;

  const delay = Math.min(Math.max(expiryMs - Date.now() - REFRESH_BUFFER_MS, MIN_DELAY_MS), MAX_DELAY_MS);
  timer = setTimeout(() => {
    timer = null;
    refreshFn?.().catch(() => {
      // Swallow — the reactive 401-refresh-retry path in lib/api.ts (and,
      // as a last resort, the inline "session expired" prompt) still
      // handles genuine expiry on the next real request.
    });
  }, delay);
}

export function cancelProactiveRefresh(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
