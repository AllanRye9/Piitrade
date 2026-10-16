# Pi Classifieds

A Uganda-focused classified-ads marketplace in a single repository:

| | Stack |
|---|---|
| **Web app** (`frontend/`) | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS 3, Intlayer (en / sw / lg / ach) |
| **API** (`backend/`) | Node 22, Express, TypeScript, Prisma 7 (PostgreSQL via `@prisma/adapter-pg`) |
| **Database** | PostgreSQL 16 |

Buyers browse and message sellers (no checkout — contact is by message / call /
WhatsApp). Sellers post listings, run store pages, and can buy listing tiers
(Free / Gold / Platinum). Admins moderate listings, reports, KYC and site
content from `/admin`.

## Repository layout

```
.
├── backend/                 Express API
│   ├── src/                 routes/, middleware/, utils/, lib/
│   ├── prisma/              schema.prisma, migrations/, rollbacks/, hotfixes/, seed.ts
│   ├── scripts/             db-setup.ts (migrate + hotfixes), prisma-local.sh, seeds
│   ├── Dockerfile           production image (also used by Railway)
│   └── TESTING.md, DOCKER_TESTING.md
├── frontend/                Next.js app
│   ├── app/                 routes (public site, /profile, /dashboard, /admin)
│   ├── components/          admin/ account/ layout/ listings/ ui/
│   ├── context/ hooks/ lib/ shared client code (lib/api.ts = axios client)
│   └── Dockerfile           production image (Next "standalone" output)
├── scripts/dev.mjs          starts API + web together for local development
├── docker-compose.yml       full local stack: Postgres + API + web (production images)
├── .env.example             ONE env file for dev + compose (copy to .env)
├── .github/workflows/       CI (typecheck, tests, lint, build), lockfile sync, dep updates
├── deploy.sh                server-side pull → build → migrate script
└── CHANGES.md               change log per drop
```

`backend/` and `frontend/` stay independently buildable (each has its own
`package.json`, lockfile and Dockerfile, and `deploy.sh` / Railway expect that).
The root `package.json` has **no dependencies** — it only provides commands that
drive both.

## Quick start

Requires Node 22+, npm, and a PostgreSQL 16 database (Docker is the easiest).

```bash
cp .env.example .env            # fill in secrets
npm run install:all             # npm ci in backend/ and frontend/
docker compose up -d postgres   # Postgres on localhost:55432
npm run db:setup                # apply migrations (+ hotfixes)
npm run dev                     # API :5000  +  Web :3000
```

Full production-like stack instead: `npm run docker:up`
(web http://localhost:3000, API http://localhost:5000/health).

### Creating an account locally needs an email sink

Registration sends a verification email and **fails with HTTP 503 (and rolls the
user back) if no provider is configured** — Resend, or SMTP with `SMTP_HOST`,
`SMTP_USER` *and* `SMTP_PASS` all set. (Despite the startup log line, emails are
not merely logged.) For local development run any SMTP catcher, e.g. Mailpit on
port 1025, and set in `.env`:

```
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USER=local
SMTP_PASS=local
```

The verification link then appears in the catcher's inbox.

Admin accounts are created at `/admin/auth/register` (`POST /api/auth/admin-register`)
with `ADMIN_SECRET`. In production that endpoint is **disabled** unless
`ENABLE_ADMIN_REGISTER=true`; enable it only long enough to create the first
admin (max 3 admins, password of 12+ characters).

## Commands (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | API (ts-node-dev) and web (next dev) together, output prefixed `[api]` / `[web]` |
| `npm run build` | Prisma generate + backend `tsc`, then `next build` |
| `npm run typecheck` | `tsc --noEmit` in both apps |
| `npm run lint` | `next lint` (frontend) |
| `npm test` | Backend unit tests (Vitest, no DB/network needed) |
| `npm run check` | typecheck + lint + test (what CI runs) |
| `npm run db:setup` / `db:migrate` | Apply committed migrations / create a new one (`prisma migrate dev`) |
| `npm run docker:up` / `docker:down` | Full stack in Docker |

## Configuration

Everything is configured through the root `.env` (see `.env.example`, which
documents each variable). Two rules matter most:

* `NEXT_PUBLIC_API_URL` is **baked into the browser bundle at build time**. It
  must be a real URL reachable from the browser; `next.config.mjs` aborts the
  build if it still contains a `<placeholder>`.
* If it is left unset, the browser calls the web app's own `/api/*`, which Next
  proxies to `BACKEND_INTERNAL_URL` (default `http://backend:5000`).

## Security

`SECURITY_AUDIT.md` documents the hardening in this tree and what is still open.
Behaviours that affect how you run it:

* In production the API **refuses to start** with missing, short (<32), identical
  or placeholder `JWT_SECRET` / `JWT_REFRESH_SECRET`. `ALLOW_INSECURE_DEFAULTS=true`
  bypasses this for throwaway local smoke tests only.
* KYC documents are served only through the authenticated
  `GET /api/upload/kyc-file` (admin or owner); contact details are hidden from
  anonymous callers; banned users lose access on the next request.
* Paid CV downloads still have **no payment gateway**; `/api/cv-payment/confirm`
  needs `CV_PAYMENT_WEBHOOK_SECRET` once one exists.

## Database & migrations

* Schema: `backend/prisma/schema.prisma` (Prisma 7: the connection URL lives in
  `backend/prisma.config.ts` / the driver adapter, **not** in the schema).
* Apply: `npm run db:setup` (runs `prisma migrate deploy`, baselines legacy
  databases, applies `prisma/hotfixes`). Containers run it on start.
* The classifieds conversion migration `20261016000000_classifieds_only`
  archives order/payment/coupon/withdrawal data into `_archive_*` tables before
  dropping the commerce tables, and is safe to run twice. It does **not**
  archive `User.balance`: on an existing database, back it up and run
  `backend/prisma/pre-migration/archive-user-balances.sql` first
  (see `backend/prisma/pre-migration/README.md`).
  Containers apply migrations automatically on start, so set
  `AUTO_MIGRATE_ON_START=false` until that script has been run.

## Deployment

* **Railway / containers:** each service builds from its own directory
  (`backend/railway.json`, `frontend/railway.json`) using its Dockerfile.
* **Server checkout:** `deploy.sh` pulls `main`, builds both apps and applies
  migrations.
* CI (`.github/workflows/ci.yml`) typechecks, tests, lints and builds both apps
  on pushes and PRs to `main` / `develop`.

## Further reading

* `backend/TESTING.md` — what the tests and manual DB checks cover
* `backend/DOCKER_TESTING.md` — validating the production image locally
* `backend/prisma/migrations/README.md` — migration conventions
* `CHANGES.md` — what changed in each drop
