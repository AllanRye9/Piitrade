import { withIntlayer } from 'next-intlayer/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */

// Warn during builds if NEXT_PUBLIC_API_URL isn't set, and hard-fail if it's
// still the unfilled `<...>` placeholder from .env.example. Railway may
// expose service variables at runtime without forwarding them into Docker
// ARGs, so refusing to create the image makes the deployment failure less
// actionable to leave as a warning alone.
//
// NEXT_PUBLIC_* variables are inlined into the client JS bundle at build
// time. Once a build ships with this wrong, no runtime fix is possible —
// setting the variable in the hosting dashboard afterwards does nothing
// until the frontend is rebuilt. That's exactly what happened on
// piitrade.com (twice now — see the committed root `.env` this was found
// in): the deployed bundle had NEXT_PUBLIC_API_URL baked in as either
// missing or the literal `https://<your-backend-service>.up.railway.app`
// placeholder text, so every API call in the browser tried to resolve a
// domain that doesn't exist and failed outright — every /auth/login,
// /auth/register, etc. request included.
//
if (process.env.NEXT_PUBLIC_API_URL?.includes('<') && !process.env.SKIP_API_URL_CHECK) {
  throw new Error(
    `NEXT_PUBLIC_API_URL is still set to the unfilled placeholder "${process.env.NEXT_PUBLIC_API_URL}". `
      + 'Replace it with the real backend URL (e.g. http://localhost:5000 for local docker-compose, or '
      + 'the deployed backend\'s https URL) before building. Set SKIP_API_URL_CHECK=1 to bypass this check.'
  );
}
if (!process.env.NEXT_PUBLIC_API_URL && !process.env.SKIP_API_URL_CHECK) {
  console.warn(
    '\n⚠ NEXT_PUBLIC_API_URL is not set. The build will continue, but browser API calls '
      + 'will use the local fallback. Set this as a FRONTEND build-time variable and rebuild.\n'
  );
}

// ── Image proxy scope ────────────────────────────────────────────────────────
// `/_next/image?url=...` fetches and re-encodes whatever remote host is allowed
// below. Allowing ANY host makes it a free open image proxy for third parties.
// Set NEXT_IMAGE_HOSTS to a comma-separated host list (e.g. "api.piitrade.com,
// cdn.piitrade.com") to lock it down; the API host from NEXT_PUBLIC_API_URL is
// always included. Left unset, the previous permissive https behaviour is kept so
// older listings that point at third-party image URLs keep rendering.
function apiHost() {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || '').hostname; } catch { return ''; }
}
// The configured API origin is always allowed, with whatever protocol it really uses.
function apiPattern() {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_API_URL || '');
    return [{ protocol: u.protocol.replace(':', ''), hostname: u.hostname, ...(u.port ? { port: u.port } : {}) }];
  } catch { return []; }
}
const lockedHosts = (process.env.NEXT_IMAGE_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
const imageRemotePatterns = lockedHosts.length > 0
  ? [...new Set([...lockedHosts, apiHost()].filter(Boolean))].map((hostname) => ({ protocol: 'https', hostname }))
      .concat([{ protocol: 'http', hostname: 'localhost' }])
  : [
      ...apiPattern(),
      { protocol: 'https', hostname: '**' },
      // Plain http only for local development / the docker-compose backend.
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: 'backend' },
    ];

// Baseline browser hardening. The CSP here only restricts things the app never
// does (framing us, <base> hijack, plugins, cross-site form posts) so it cannot
// break pages; a full script-src policy needs nonce plumbing and is a follow-up.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const backendInternalUrl = (
  process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:5000'
).replace(/\/+$/, '');

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  // lib/apiUrl.ts falls back to a same-origin "/api" when NEXT_PUBLIC_API_URL was not
  // inlined at build time and says "Next.js proxies that path to the backend" — no
  // rewrite existed, so every API call 404'd. Same-origin proxying also makes the
  // refresh cookie first-party (no cross-site cookie blocking in Safari/Firefox).
  // Target resolution: BACKEND_INTERNAL_URL, else NEXT_PUBLIC_API_URL, else the
  // docker-compose service name. Rewrites are baked into the routes manifest at
  // BUILD time. When NEXT_PUBLIC_API_URL is set the browser talks to the API
  // directly and these rules are simply never hit.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendInternalUrl}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backendInternalUrl}/uploads/:path*` },
    ];
  },

  // Produces a minimal, self-contained `.next/standalone` build (server +
  // only the node_modules actually used) so the production Docker image
  // doesn't need to ship the full node_modules tree.
  output: 'standalone',

  // Pin file tracing to this app. The repo root has its own package-lock.json
  // (orchestration only), which makes Next infer the wrong workspace root and
  // nest the standalone output under `frontend/`; this keeps
  // `.next/standalone/server.js` at a fixed path for local builds and Docker.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),

  // Keep a higher ceiling for any page or route that may add a slow
  // build-time fetch. Static pages and the sitemap do not depend on the
  // backend during generation; their optional API requests are bounded.
  staticPageGenerationTimeout: 120,

  eslint: {
    // Linting is run in CI / locally; don't let it block production builds.
    ignoreDuringBuilds: true,
  },

  images: {
    // Listing/avatar/site-media images are served from the backend API
    // (local disk in dev, S3-compatible storage in production) rather than
    // from a fixed set of remote hosts, so we allow any https(s) source and
    // let the backend be the actual access-control boundary. Tighten this
    // to explicit remotePatterns once the production image domain(s) are
    // finalized.
    remotePatterns: imageRemotePatterns,
  },
};

// withIntlayer() reads frontend/intlayer.config.ts, builds the content
// dictionaries, and wires the plugin into webpack/Turbopack. It's async
// (it prepares dictionaries before the build starts), so it's awaited here
// at the top level — supported because this file is loaded as ESM.
export default await withIntlayer(nextConfig);
