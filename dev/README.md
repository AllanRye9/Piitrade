# Local development: one command

```bash
./dev/dev.sh          # database + backend + frontend + nginx, then open  http://localhost:8080
```

Press **Ctrl-C** (or run `./dev/dev.sh stop` from another terminal) to stop everything.

This folder only **adds** files. Nothing in `backend/`, `frontend/`, the Dockerfiles, `package.json`
or the deploy/CI configuration is changed, so production builds are unaffected. Everything the services need is
passed to them as environment variables by the script.

## What it starts

```
browser ─► nginx :8080 ─┬─ /api  /uploads  /health ─► backend  (Express + Prisma)  :5000
                        └─ everything else + HMR ───► Next.js dev server           :3000
                                         PostgreSQL (existing, Docker, or a private lean cluster) :55432
```

| Command | What it does |
|---|---|
| `./dev/dev.sh` | start everything, stay in the foreground |
| `./dev/dev.sh --lan` | also reachable from a phone / other machines (`http://<your-ip>:8080`) |
| `./dev/dev.sh status` | what is running and how much memory each part uses |
| `./dev/dev.sh seed` | load seed data (admin user, categories, packages) |
| `./dev/dev.sh logs [backend\|frontend\|nginx\|db]` | follow logs |
| `./dev/dev.sh stop` | stop everything |
| `./dev/dev.sh doctor` | check the tools it needs |
| `./dev/dev.sh reset-db` | delete the managed local database (asks first) |

First run: it installs dependencies, generates the Prisma client, creates the database and runs migrations
(the backend does this on start, exactly as in production). Later runs start in about half a minute.

The seeded admin is `admin@piitrade.com` with the password from `ADMIN_PASSWORD` (default `Admin@123!`).

## Requirements

* Node 20+ and npm, `curl`
* **nginx**: `brew install nginx` · `sudo apt install nginx` (Windows: use WSL2)
* a database, any one of: Docker, PostgreSQL 14+ installed locally, or your own `DATABASE_URL`.
  The script uses whatever is already listening on the port in `DATABASE_URL`
  (`backend/.env`, default `localhost:55432`); otherwise it starts one for you (Docker first, then a private
  cluster in `dev/.data/`, which needs a normal, non-root user).

## CORS

* The normal path needs no CORS at all: nginx serves pages and the API from the **same origin**
  (`http://localhost:8080`), and the frontend is started with `NEXT_PUBLIC_API_URL` pointing at it.
* For everything else the script sets the backend's `CORS_ORIGIN` allow-list (the same list the cookie
  endpoints use for their origin check): `localhost` and `127.0.0.1` on the nginx port and on the Next port,
  plus your LAN address with `--lan`. Add more with `DEV_EXTRA_ORIGINS=http://localhost:5173,...`.
* Credentials are enabled, so `*` is never used (the backend ignores it by design). Unknown origins such as
  `http://evil.test` get no CORS headers and the preflight is not granted.
* CORS headers come from the backend only; nginx passes `Origin` through and adds nothing, so they are never duplicated.

## Memory

Measured on a cold start while loading a dozen pages (Linux, Node 22):

| | before (`npm run dev` in both) | `dev.sh` |
|---|---|---|
| backend | ~490 MB (`ts-node-dev`: 4 processes) | ~330-400 MB (one `node` process, `--watch`) |
| frontend | ~1.5 GB (Next dev, 8 processes) | ~440 MB settled (heap capped at 768 MB) |
| nginx | n/a | ~10 MB (1 worker, no access log) |
| database | n/a | ~70-100 MB (tuned: 32 MB shared buffers, 25 connections) |
| **total** | **~2 GB+** | **~0.9 GB settled** |

How: the backend runs straight under `node` with ts-node's transpile-only mode instead of through
`ts-node-dev`; the Next dev server gets a heap cap, runs without the `npm exec` wrapper, and has telemetry off;
nginx runs a single worker; PostgreSQL gets dev-only memory settings (`fsync=off`, so after a crash just
`reset-db`). Memory peaks while pages compile the first time, then settles.

With a low cap Next restarts its own server now and then ("approaching the used memory threshold"); nginx shows
a page that refreshes itself for those couple of seconds. Trade-offs you can change in `dev/.env.local`
(see `.env.local.example`):

* `DEV_FRONTEND_HEAP_MB=1280` stops those restarts but lets the frontend grow to ~1.7 GB.
* `DEV_BACKEND_WATCH=0` (or `--no-watch`) saves ~70 MB but you restart the backend by hand after edits.

## Troubleshooting

* **port already in use**: change `DEV_PORT`, `DEV_BACKEND_PORT` or `DEV_FRONTEND_PORT` in `dev/.env.local`.
* **a service fails to start**: `./dev/dev.sh logs backend` (or `frontend`, `nginx`, `db`); logs live in `dev/.run/logs/`.
* **"PostgreSQL refuses to run as root"**: run the script as your normal user, or point `DATABASE_URL` at a database you already run.
* **Turbopack** (`next dev --turbo`) is not used: the current middleware does not run under it.
