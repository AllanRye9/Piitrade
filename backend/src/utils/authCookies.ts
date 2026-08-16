import { Request, Response, CookieOptions } from 'express';

const REFRESH_COOKIE_NAME = 'refreshToken';

// Mirrors JWT_REFRESH_EXPIRES_IN's default (see utils/jwt.ts) so the cookie
// doesn't outlive the token it carries. The JWT's own signed expiry is what
// actually gets enforced server-side — this only controls how long the
// browser holds onto the cookie.
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cookie flags are derived from the ACTUAL request's protocol, not from
 * NODE_ENV. NODE_ENV is easy to leave unset (or "development") on PaaS
 * hosts — Railway in particular does not set it automatically for Node
 * services — and this project's own .env.example ships NODE_ENV=development
 * as the default. Gating on it previously meant that, unless an operator
 * remembered to override it, the refresh cookie was issued as
 * `secure:false; sameSite:'lax'` even in a live deployment — which is a
 * problem here because the frontend (3relite.com) and backend
 * (*.onrender.com / *.up.railway.app) are on different domains. Browsers
 * never attach a SameSite=Lax cookie to a cross-site fetch/XHR, so every
 * refresh call was silently rejected as soon as the 1h access token
 * expired, which looked like the site randomly logging people out and
 * bouncing them to the login page.
 *
 * `app.set('trust proxy', 1)` (see app.ts) makes `req.secure` reflect the
 * original client protocol via X-Forwarded-Proto, so this is reliable
 * behind Railway/Render/nginx too — and self-corrects regardless of how
 * NODE_ENV happens to be configured on the host.
 */
function cookieOptionsFor(req: Request): CookieOptions {
  const isHttps = req.secure;
  return {
    httpOnly: true,
    secure: isHttps,
    // 'none' is required whenever the request is cross-site over HTTPS,
    // which is the normal case for this app's split frontend/backend
    // deployment. Plain HTTP (local dev) can't use 'none' — browsers
    // require Secure alongside SameSite=None — so it falls back to 'lax'
    // there, which works fine since localhost:3000 -> localhost:5000 is
    // same-site.
    sameSite: isHttps ? 'none' : 'lax',
    // Scoped to the auth routes only, so this cookie is never sent on
    // unrelated requests (listings, images, uploads, etc.).
    path: '/api/auth',
  };
}

/** Sets the refresh token as an httpOnly cookie, unreadable by frontend JS. */
export function setRefreshTokenCookie(req: Request, res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...cookieOptionsFor(req), maxAge: REFRESH_COOKIE_MAX_AGE_MS });
}

/** Clears the refresh token cookie on logout. */
export function clearRefreshTokenCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptionsFor(req));
}

/**
 * Reads the refresh token straight from the raw Cookie header. Parsed by
 * hand (rather than adding the cookie-parser package) since this is the
 * only cookie the app reads.
 */
export function getRefreshTokenCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
