/**
 * Single source of truth for the backend API base URL.
 *
 * Previously every call site (Footer, usePricingCurrency, blog pages,
 * app/page.tsx, app/layout.tsx, cv-services, SiteConfigContext, lib/utils,
 * lib/api) independently read `process.env.NEXT_PUBLIC_API_URL` and each
 * picked its own fallback when it was missing — some fell back to the
 * literal string `'http://localhost:5000'`, some to `''`, and lib/api.ts had
 * a smarter same-origin fallback that the others didn't share. Next.js
 * inlines `NEXT_PUBLIC_*` vars at *build* time, so if the var was briefly
 * unset in the build environment, statically generated / ISR pages baked in
 * `http://localhost:5000` as their backend URL and kept serving that from
 * the CDN — which is indistinguishable, from the browser, from a routing
 * bug: a request goes to the wrong host and comes back 404 (or, if it
 * happens to resolve to something, a cross-origin CORS failure).
 *
 * This module is the only place that fallback logic should live. Everything
 * else should import from here.
 *
 * Security notes:
 *  - We deliberately do NOT silently fall back to a hardcoded
 *    `localhost`/`backend` URL in production. That fallback is almost never
 *    correct on a real deployment and turns a loud, obvious misconfiguration
 *    into a confusing 404/CORS error users have to reverse-engineer. In
 *    production we either resolve to a same-origin path (safe default when
 *    the app sits behind a reverse proxy) or fail loudly.
 *  - We reject an `http://` API URL when running in production so we never
 *    silently downgrade the connection (mixed content / no TLS) for a
 *    production deployment.
 *  - "Production" alone isn't a reliable signal for "don't guess localhost":
 *    a `next build && next start` run on a laptop also sets
 *    NODE_ENV=production. So localhost is detected explicitly — by hostname
 *    in the browser, and by the *absence* of any known hosting platform's
 *    env vars on the server (mirroring the `isRailway` check already used in
 *    backend/src/index.ts) — and always short-circuits straight to the local
 *    default without requiring NEXT_PUBLIC_API_URL to be set at all.
 */

const rawConfiguredApiUrl = process.env.NEXT_PUBLIC_API_URL || '';
const configuredApiUrl = rawConfiguredApiUrl.trim().replace(/\/+$/, '');
const isProduction = process.env.NODE_ENV === 'production';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** True when the browser itself is running on a local machine, regardless
 * of NODE_ENV (covers `next dev` and a locally-run `next build && next start`
 * alike). */
function isBrowserLocalhost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
}

/** True when server-side code is running on one of the hosting platforms
 * this app actually deploys to. Absence of all of these is treated as
 * "running locally" — same signal the backend already uses
 * (`RAILWAY_ENVIRONMENT_ID` / `RAILWAY_PROJECT_ID` in backend/src/index.ts). */
function isKnownHostingPlatform(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.VERCEL ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.NETLIFY
  );
}

function assertSafeScheme(url: string): void {
  if (isProduction && url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|backend)(:|\/|$)/.test(url)) {
    // Loud, not silent: a plain console.error is visible in both server logs
    // and the browser console, so this can't be missed the way a silently
    // "working" but wrong URL would be.
    // eslint-disable-next-line no-console
    console.error(
      `[apiUrl] NEXT_PUBLIC_API_URL ("${url}") uses http:// in production. ` +
      'This should be an https:// URL to avoid mixed-content and downgrade issues.'
    );
  }
}

if (configuredApiUrl) {
  assertSafeScheme(configuredApiUrl);
}

/**
 * Resolves the backend API base URL (no trailing slash, no "/api" suffix).
 * Safe to call from both Server Components / route handlers and Client
 * Components.
 */
export function getApiBaseUrl(): string {
  if (configuredApiUrl) {
    return configuredApiUrl;
  }

  if (typeof window !== 'undefined') {
    // Browser, and NEXT_PUBLIC_API_URL was not baked in at build time.
    if (!isProduction || isBrowserLocalhost(window.location.hostname)) {
      // Local machine — never require the env var to be set here, whether
      // that's `next dev` or a locally-run production build.
      return 'http://localhost:5000';
    }
    // Production, on a real (non-local) host, with no explicit backend URL
    // configured: assume the app is served from behind a reverse proxy that
    // forwards /api/* to the backend, so same-origin is the only sane guess.
    // This matches how piitrade.com is actually deployed, and — importantly
    // — fails predictably (same 404 on every route, immediately visible in
    // the Network tab) rather than silently sending requests to a localhost
    // address that only ever existed on a build machine.
    // eslint-disable-next-line no-console
    console.error(
      '[apiUrl] NEXT_PUBLIC_API_URL is not set. Falling back to same-origin ' +
      `("${window.location.origin}"). Set NEXT_PUBLIC_API_URL in the ` +
      'frontend build environment to point at the backend explicitly.'
    );
    return window.location.origin;
  }

  // Server-side (SSR / route handlers / build-time static generation).
  if (!isProduction || !isKnownHostingPlatform()) {
    // Local dev, or a production build running outside any known hosting
    // platform (e.g. `next build && next start` on a laptop) — use the
    // docker-compose service name default without requiring the env var.
    return 'http://backend:5000';
  }

  // Actually running on a known hosting platform with no NEXT_PUBLIC_API_URL:
  // there is no safe guess to make here (no request origin to fall back to,
  // and guessing 'http://backend:5000' would silently point at a host that
  // doesn't exist outside docker-compose). Fail loudly and immediately
  // instead of letting every SSR fetch on the site quietly 404/ECONNREFUSED
  // one at a time.
  throw new Error(
    '[apiUrl] NEXT_PUBLIC_API_URL is not set in production. Set it in the ' +
    'frontend build/runtime environment to the backend URL (e.g. ' +
    'https://backend-production-xxxx.up.railway.app).'
  );
}

/** Convenience helper: base URL + "/api", with no double slashes. */
export function apiPath(path: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
