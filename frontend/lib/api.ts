import axios from 'axios';
import { clearAuthSession, getAccessToken, hasStoredAuthSession, setAuthSession } from '@/lib/authStorage';
import { isCountrySwitching } from '@/lib/countrySwitch';
import { registerProactiveRefresh, scheduleProactiveRefresh, cancelProactiveRefresh } from '@/lib/sessionRefreshScheduler';
import { requestReauth } from '@/lib/sessionExpiry';
import { API_URL } from '@/lib/apiUrl';
import { resolveAdapter, withSharedGets } from '@/lib/sharedGet';

// Re-exported so existing client-side imports (`import { API_URL, api } from
// '@/lib/api'`) keep working unchanged. Server Components should import
// API_URL from '@/lib/apiUrl' directly instead of from here — this module
// pulls in the client-only session-refresh scheduler below, which breaks
// the server build if bundled server-side. See lib/apiUrl.ts for why.
export { API_URL };

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Several components ask for the same public data on one page (category tree, popular searches, stats); share it.
api.defaults.adapter = withSharedGets(resolveAdapter(api.defaults.adapter));

// Attach access token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
//
// The refresh token now lives only in an httpOnly cookie set by the
// backend — it's never readable by this code, so refreshing just means
// calling /auth/refresh with credentials and letting the browser attach the
// cookie automatically.
//
// The refresh token is single-use / rotating on the backend (each call to
// /auth/refresh invalidates the old token and issues a new one). When
// several requests fire around the same time (very common — a page often
// calls several endpoints on mount) and the access token has expired, ALL
// of them get a 401 at once. Without deduping, each one would independently
// call /auth/refresh: the first call wins and rotates the cookie, and any
// other concurrent call that raced it against the old cookie value would
// get rejected as "invalid refresh token" — which cleared the session and
// force-logged the user out, even though they were still active. This was
// the source of the "random" logouts.
//
// Fix: share a single in-flight refresh promise across all callers. Only
// one network call to /auth/refresh ever happens per expiry; every request
// that hit a 401 around the same time waits on that same promise and
// retries with the resulting fresh access token.
let refreshPromise: Promise<{ accessToken: string }> | null = null;

/**
 * True when /auth/refresh answered "this session is over" (no / invalid / banned token). A network hiccup,
 * timeout or 5xx is NOT that: the session is probably still fine, so it must not sign the user out or
 * raise the "session expired" prompt.
 */
function isDefinitiveAuthFailure(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 400 || status === 401 || status === 403;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One refresh call, retried a couple of times on transient failures (offline blip, 5xx, cold-starting server). */
async function refreshWithRetry(): Promise<{ accessToken: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data } = await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true, timeout: 15000 });
      return data;
    } catch (err) {
      lastErr = err;
      if (isDefinitiveAuthFailure(err)) throw err;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

function refreshAccessToken(): Promise<{ accessToken: string }> {
  if (!refreshPromise) {
    refreshPromise = refreshWithRetry()
      .then((data) => {
        setAuthSession(data.accessToken);
        // Re-arm the silent background refresh against this new token's
        // real expiry — see sessionRefreshScheduler.ts.
        scheduleProactiveRefresh(data.accessToken);
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Let sessionRefreshScheduler.ts trigger a silent refresh ahead of expiry
// without importing this file directly (it's imported the other way
// around, above) — see that module for why.
registerProactiveRefresh(refreshAccessToken);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      // Captured before the refresh attempt: were we actually in a logged-in
      // session, or was this 401 just "you're not logged in" for an
      // anonymous request? Only the former is a genuine session EXPIRY
      // worth interrupting the user about — the latter should just surface
      // as a normal error to whatever called it.
      const hadActiveSession = hasStoredAuthSession();
      try {
        const data = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        // Transient failure (offline, timeout, server restarting): keep the session and let the caller see the
        // original error. Only a definitive "your session is over" answer continues to the prompt below.
        if (!isDefinitiveAuthFailure(refreshErr)) return Promise.reject(error);
        // Admin pages keep the original, simpler hard-redirect-only
        // behavior (separate login portal, separate trust boundary) —
        // everywhere else, offer to sign back in inline first so an
        // in-progress form (e.g. "Post a listing") isn't wiped out by a
        // full navigation over what's very often just a stale token.
        const isAdminPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
        // A country switch can cause its own transient 401s unrelated to
        // real session expiry (requests in flight against the old country
        // context) — don't pop a false "session expired" prompt for those;
        // fall straight through to the same silent-clear behavior as before.
        const duringCountrySwitch = typeof window !== 'undefined' && isCountrySwitching();
        if (hadActiveSession && !isAdminPage && !duringCountrySwitch) {
          try {
            const accessToken = await requestReauth();
            original.headers.Authorization = `Bearer ${accessToken}`;
            return api(original);
          } catch {
            // Declined, or no modal mounted — fall through to the hard
            // redirect below, same as before this change.
          }
        }

        clearAuthSession();
        cancelProactiveRefresh();
        // Don't force-redirect during a country switch — transient 401s are expected
        if (typeof window !== 'undefined' && !duringCountrySwitch) {
          // Admin pages redirect to the admin login portal, not the public login
          window.location.href = isAdminPage ? '/admin/auth/login' : '/auth/login';
        }
      }
    }
    return Promise.reject(error);
  }
);
