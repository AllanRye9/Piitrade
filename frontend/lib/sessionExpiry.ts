'use client';

/**
 * sessionExpiry.ts
 *
 * Previously, if an access token expired AND the background refresh call
 * also failed (refresh token itself expired/invalid — normal after 7 days,
 * or if it was revoked), lib/api.ts's response interceptor would
 * immediately clear the session and hard-navigate to /auth/login via
 * `window.location.href`. A full navigation throws away every bit of
 * in-memory React state on the page — including a half-filled "Post a
 * listing" form, in-progress image uploads, anything typed but not yet
 * saved. For an interruption that's often just "your token is a bit old",
 * that's a disproportionately destructive response.
 *
 * This module lets lib/api.ts ask the UI to offer an inline "please sign
 * in again" prompt instead, and wait for the result, rather than deciding
 * unilaterally to navigate away. <SessionExpiredModal> (mounted once,
 * globally, in PublicShell) is the UI half of this: it registers itself as
 * the handler, shows a modal on top of whatever the user was doing, and
 * resolves/rejects the pending promise(s) based on what they do.
 *
 * If the user successfully re-authenticates, the original request(s) that
 * triggered this are retried automatically with the new token — the page
 * itself never unmounts, so all its state survives. If they cancel, or no
 * handler is mounted at all (e.g. very early in app boot), the caller
 * falls back to the old hard-redirect behavior — this is a pure add-on,
 * never a required dependency for staying secure.
 */

type Resolve = (accessToken: string) => void;
type Reject = (reason?: unknown) => void;

let pending: { resolve: Resolve; reject: Reject }[] = [];
let openModal: (() => void) | null = null;

/** Called once by <SessionExpiredModal> on mount to wire itself up as the active handler. */
export function registerSessionExpiredHandler(handler: () => void): void {
  openModal = handler;
}

export function unregisterSessionExpiredHandler(handler: () => void): void {
  if (openModal === handler) openModal = null;
}

/**
 * Called by lib/api.ts when a request 401s and the background refresh also
 * fails. Resolves with a fresh access token if the user re-authenticates
 * inline; rejects if they cancel or nothing is mounted to handle it, in
 * which case the caller should fall back to a hard redirect.
 */
export function requestReauth(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!openModal) {
      reject(new Error('No session-expired handler is mounted'));
      return;
    }
    pending.push({ resolve, reject });
    openModal();
  });
}

/** Called by <SessionExpiredModal> after a successful inline re-login. */
export function resolveReauth(accessToken: string): void {
  const resolvers = pending;
  pending = [];
  resolvers.forEach((p) => p.resolve(accessToken));
}

/** Called by <SessionExpiredModal> if the user cancels / dismisses the prompt. */
export function rejectReauth(reason?: unknown): void {
  const resolvers = pending;
  pending = [];
  resolvers.forEach((p) => p.reject(reason));
}
