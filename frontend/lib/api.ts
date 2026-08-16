import axios from 'axios';
import { clearAuthSession, getAccessToken, hasStoredAuthSession, setAuthSession } from '@/lib/authStorage';
import { isCountrySwitching } from '@/lib/countrySwitch';
import { registerProactiveRefresh, scheduleProactiveRefresh, cancelProactiveRefresh } from '@/lib/sessionRefreshScheduler';
import { requestReauth } from '@/lib/sessionExpiry';

// Strip trailing slashes so that template literals like `${API_URL}/api`
// never produce a double-slash (e.g. "https://example.com//api").
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || '';
const normalizedConfiguredApiUrl = configuredApiUrl.replace(/\/+$/, '');

function resolveApiUrl(): string {
  if (normalizedConfiguredApiUrl) {
    return normalizedConfiguredApiUrl;
  }

  // Safe local default for dev/docker compose when NEXT_PUBLIC_API_URL is missing.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'piitrade.com' || host === 'www.piitrade.com') {
      return window.location.origin;
    }
    return 'http://localhost:5000';
  }

  return 'http://backend:5000';
}

export const API_URL = resolveApiUrl();

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

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

function refreshAccessToken(): Promise<{ accessToken: string }> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true })
      .then(({ data }) => {
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
      } catch {
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
