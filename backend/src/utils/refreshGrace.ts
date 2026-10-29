/**
 * refreshGrace.ts
 *
 * Refresh tokens rotate on every use: POST /auth/refresh issues a brand new
 * refresh token and immediately invalidates the old one (single active
 * token per user, stored on User.refreshToken). That's the right call
 * security-wise, but it has a well-known failure mode with a browser that
 * has multiple tabs open on the same account: if two tabs both hold an
 * access token that expires around the same moment, each independently
 * calls /auth/refresh using whatever refresh-token cookie value it read at
 * the time. Whichever request reaches the server first wins and rotates
 * the token; the second one — already in flight with the now-superseded
 * cookie value — gets rejected as "invalid refresh token", which used to
 * force-clear that tab's session and bounce the user to the login page even
 * though they were actively using it (e.g. mid-way through filling out a
 * "Post a listing" form in one tab while another tab sat open).
 *
 * The frontend already de-dupes concurrent refresh calls *within* a single
 * tab (see frontend/lib/api.ts), but that can't help across tabs — each tab
 * runs its own JS heap. This module closes that gap on the server side
 * instead: for a few seconds after a refresh token is rotated away, the
 * OLD token is still remembered here. If a request shows up using that
 * exact just-superseded token within the grace window, it's replayed the
 * same {accessToken, refreshToken} pair that the winning request already
 * got, rather than being told it's invalid. Outside the grace window (or
 * for any token that was never the immediately-previous one), normal
 * rotation/invalidation rules apply unchanged.
 *
 * This is an in-memory, single-process cache — it doesn't survive a
 * restart and isn't shared across horizontally-scaled instances. That's an
 * acceptable trade-off here: the window is only a few seconds, and a miss
 * just falls back to today's existing behavior (refresh fails, frontend
 * offers the user an inline re-login rather than silently losing work).
 */

interface GraceEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const GRACE_WINDOW_MS = 60_000;

const graceEntries = new Map<string, GraceEntry>();

/** Remembers the result of a token rotation, keyed by the OLD (now-superseded) refresh token. */
export function rememberRotatedRefresh(oldRefreshToken: string, accessToken: string, newRefreshToken: string): void {
  graceEntries.set(oldRefreshToken, {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: Date.now() + GRACE_WINDOW_MS,
  });

  // Best-effort cleanup so this map never grows unbounded; a miss/expired
  // entry is treated as "not found" anyway (see getRotatedRefresh below),
  // so a missed cleanup is harmless, just a little extra memory briefly.
  setTimeout(() => graceEntries.delete(oldRefreshToken), GRACE_WINDOW_MS + 1_000).unref?.();
}

/** Looks up a just-superseded refresh token. Returns null if it was never rotated, or the grace window has passed. */
export function getRotatedRefresh(oldRefreshToken: string): { accessToken: string; refreshToken: string } | null {
  const entry = graceEntries.get(oldRefreshToken);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    graceEntries.delete(oldRefreshToken);
    return null;
  }
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
}
