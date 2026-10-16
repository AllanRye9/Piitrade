# Piitrade (classifieds) — backend / API / security audit

Scope: `backend/` (Express + Prisma 7), the frontend↔API contract, Docker/CI config.
Verified in a sandbox: backend `tsc --noEmit` clean; **62 unit + integration tests pass** (9 files);
frontend `tsc --noEmit` clean; every `api.*` call in the frontend maps to a backend route.
**Not verified** (no database / cloud services here): real DB behaviour, running the migrations,
S3, e-mail, the AI worker, a Docker build, or a browser run of the frontend.

## 1. Build integrity (fixed)
| Problem | Fix |
|---|---|
| `package.json` mixed Prisma 5 (`prisma`, `@prisma/client`) with `@prisma/adapter-pg@7`; lockfile out of sync, so `npm ci` (Docker + CI) failed | Completed the Prisma 7 move the seed scripts/Dockerfile already assumed: `prisma.config.ts`, `PrismaPg` adapter in `utils/prisma.ts`, no `url` in `schema.prisma`, v7 deps, regenerated lockfile. **If your real repo is already on Prisma 7, keep its versions of these files.** |
| 5 real type errors in `listings.ts` (Prisma 7 renamed `JsonFilter`; enum filter typed as `string`), hidden because the Dockerfile tolerated `tsc` errors | Fixed; Dockerfile build now **fails on type errors** |
| CI never ran backend tests | Added `npm test` step |

## 2. Security findings

### Critical / High
| # | Finding | Status |
|---|---|---|
| 1 | **Account takeover**: `reset-password` / `verify-email` passed `req.body.token` straight into a Prisma `where`; `{"token":{"not":""}}` matched any pending reset | Fixed (string-type guards) + global rejection of nested query objects |
| 2 | **Moderation bypass**: `PUT /listings/:id` accepted any `status`, and `PATCH /:id/status` allowed `ACTIVE` from any state, so sellers could publish pending/auto-rejected listings and **undo admin takedowns** (Remove listing / Ban set `HIDDEN`, which sellers could flip back) | Fixed: owner transition matrix (`utils/listingStatus.ts`); admin takedowns now set `REJECTED` |
| 3 | **Contact-gate bypass**: `GET /listings` (list) returned every seller's phone + WhatsApp to anonymous callers; store pages exposed `socialLinks` | Fixed (`utils/contactPrivacy.ts`) |
| 4 | **KYC ID photos publicly readable** at `/api/images/kyc%2F…` and `/uploads/kyc/…` | Blocked; new authenticated `GET /api/upload/kyc-file` (admin or owner only) + frontend `KycImage` for admin review & the verification page |
| 5 | **Banned/demoted users kept access**: `isBanned` only checked at login; `/auth/refresh` never checked it; tokens trusted role for 1h | Live ban/role/deleted check on every request (15 s cache, invalidated on admin actions); refresh checks ban; ban/role change revokes refresh token |
| 6 | **Paid CV downloads are free**: `/cv-payment/confirm` is public and the frontend calls `/initiate` then `/confirm` itself — no gateway exists | Partially fixed: `/confirm` requires `x-webhook-secret` once `CV_PAYMENT_WEBHOOK_SECRET` is set; **you still need a real payment integration** |
| 7 | Production could run with placeholder JWT/admin secrets (compose uses `test-jwt-secret-change-me`) and seed created admin `Admin@123!` | Startup refuses weak/placeholder/identical secrets (`ALLOW_INSECURE_DEFAULTS` for throwaway tests); seed refuses weak `ADMIN_PASSWORD` in production |
| 8 | Uploads trusted client MIME + extension → stored `.html`/`.svg` could be served from `/uploads` (stored XSS) | Magic-byte check at the single storage choke point, extension allow-list, mimetype-derived extensions |

### Medium
- **Login bug**: registration stripped Gmail dots (`normalizeEmail()`), login did not → such users could never sign in. Fixed with backward-compatible lookup.
- `admin-register` back door: off in production unless `ENABLE_ADMIN_REGISTER=true`; constant-time secret compare; 3-admin cap; 12+ char password.
- Auth: timing-equalised login, ban status no longer leaks without the password, JWT algorithm pinned (HS256), Origin check on cookie-authenticated `refresh`/`logout` (CSRF), per-account login limiter (shared mobile IPs no longer lock each other out), limiters on forgot/resend/reset/verify.
- Wildcard `CORS_ORIGIN=*` was reflected together with credentials → ignored now.
- `/health/services` leaked which env vars/services were configured → status only.
- Listing input: finite/bounded price, text length caps, JSON blob size caps, valid dates/coordinates, image-URL scheme check; owners can no longer set `expiresAt` (extend/remove expiry); placement date admin-only; edited text on a live listing is re-run through AI moderation (re-queued if flagged).
- Messaging: 2000-char cap, per-user 20/min limit, listing validated. Reviews: listing must belong to the reviewee, one review per listing, comment bounded.
- Unauthenticated LLM endpoint `/support/chat` and other public writes now rate-limited.
- Farmer marketplace: fictional "verified" buyers/seller no longer seeded in production (they were persisted on first real post); client-set `platformFeePercent` ignored; field length caps.
- Blog HTML sanitised on write and public read (`sanitize-html`); frontend renders it with `dangerouslySetInnerHTML`.
- Frontend: security headers + baseline CSP, `/api` rewrite (`BACKEND_INTERNAL_URL`) that `lib/apiUrl.ts` assumed but never existed, opt-in image-host lockdown (`NEXT_IMAGE_HOSTS`), password minimum 8 (admin 12) aligned with backend.
- Infra: DB/API ports bound to 127.0.0.1 in the test compose, `sync-lockfiles` no longer runs install scripts with a write token, `.gitignore` added, `RATE_LIMIT_MAX` default raised 100→600 (100/15 min is ~8 page views for this SPA).

## 3. Obsolete after the classifieds conversion (verified gone)
Orders, cart, coupons, addresses, withdrawals, payment proofs and their findings (withdrawal race, coupon scoping, address IDOR, quantity rules) no longer exist in this tree.

## 4. Do these before deploying
1. **Back up the DB**, then run `backend/prisma/pre-migration/archive-user-balances.sql`: migration `20261016000000_classifieds_only` drops `User.balance` without archiving it (seller funds would be unrecoverable).
2. Set strong `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 48`) and `ADMIN_SECRET`. Rotate anything that was ever committed.
3. Set `CORS_ORIGIN`; consider `BACKEND_INTERNAL_URL` (same-origin API) — see §5.
4. Admin creation in production: set `ENABLE_ADMIN_REGISTER=true` only briefly, then remove it.
5. Decide on CV payments (§5) and set `CV_PAYMENT_WEBHOOK_SECRET` when a gateway calls `/confirm`.
6. Have native speakers review sw/lg strings (`lib/i18n/ui.ts`), as your changelog already notes.

## 5. Open items (not fixed — need a decision or larger work)
- **Cross-site refresh cookie** (`SameSite=None` between your frontend and API domains) is a third-party cookie that Safari/Firefox block, a likely cause of "random logouts". Serve the API on a same-site subdomain, or use the new rewrite so the browser only talks to the frontend origin.
- Access token lives in `localStorage` (XSS-readable). A full `script-src` CSP needs nonce work.
- **Farmer marketplace stores data in `data/farmer-marketplace.json`**: lost on redeploy in containers, racy, single-instance only, and posting is anonymous. Move to Postgres.
- CV payments: no gateway exists (see finding 6); admin "Revenue → CV downloads" currently counts self-confirmed tokens.
- `uncaughtException` is logged and swallowed (process continues in an undefined state); consider exit + restart.
- `POST /listings/:id/engagement` and `views` increments are unauthenticated and inflatable; reviews only require *one* message in either direction.
- Listing `images` may point to third-party URLs (viewer IPs leak to those hosts); `GET /cv-payment/validate` puts a token in the query string (logged by morgan).
- `BAN_SELLER` hides listings as `REJECTED`; un-banning does not restore them automatically.
- Stock/quantity is informational only (no reservation) — appropriate for classifieds.
