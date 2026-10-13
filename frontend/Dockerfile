# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — install dependencies.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — build the Next.js app.
# NEXT_PUBLIC_* variables must be present at BUILD time (they're inlined into
# the client bundle), so they're accepted as build args and re-exported as
# ENV before `next build` runs. Railway passes these automatically when set
# as build-time service variables (see railway.json / dashboard variables).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Node's default V8 heap ceiling is derived from the host's total memory,
# which in a containerized build (Railway, Docker) is often much higher
# than the container's actual enforced memory limit — V8 then grows the
# heap toward that inflated ceiling during webpack's minification /
# output-file-tracing steps, gets OOM-killed by the container runtime once
# it crosses the real limit, and the build simply hangs for a long time
# before dying with no clear error. Setting an explicit, conservative
# ceiling here makes the build respect the container's real budget: it
# either completes cleanly or fails fast with a legible "heap out of
# memory" error instead of a silent long-hang-then-kill. Override at
# build time with `--build-arg BUILD_MAX_OLD_SPACE_MB=<n>` if your
# Railway build container has a smaller (or larger) memory allocation.
ARG BUILD_MAX_OLD_SPACE_MB=4096
ENV NODE_OPTIONS=--max-old-space-size=${BUILD_MAX_OLD_SPACE_MB}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NOTE on BuildKit cache mounts: this build intentionally does NOT use
# `--mount=type=cache` for Next's .next/cache directory. Two real, documented
# constraints make that not worth the fragility here:
#
# 1. Railway's builder rejects a plain `--mount=type=cache,id=<anything>`.
#    It requires the id to be prefixed with the literal Railway *service*
#    UUID, hardcoded, in the exact form:
#      --mount=type=cache,id=s/<service-id>-<target-path>,target=<target-path>
#    (see https://docs.railway.com/builds/dockerfiles#cache-mounts). Railway
#    explicitly does not support passing that id via ARG/ENV — it must be a
#    literal string baked into this file — which would permanently couple
#    this Dockerfile to one specific Railway service and break the moment
#    that service is recreated (new UUID) or the image is built anywhere
#    else (Render, plain `docker build`, CI, another Railway service).
# 2. This repo is explicitly meant to be portable across hosts (see
#    .env.example mentioning both Render and Railway), so a hardcoded
#    per-service id is the wrong default here.
#
# Net effect: without the cache mount, `npm run build` re-runs Next's build
# from a clean slate on every image build, which is slower but always
# correct everywhere. Dependency installation (the more expensive step) is
# still cached via normal Docker layer caching, since `npm ci` runs in its
# own layer (Stage 1: deps) keyed on package.json/package-lock.json and is
# unaffected by source-code changes.
#
# If you want the extra Next.js incremental-build speedup AND are committed
# to staying on this specific Railway service, you can opt back in by
# replacing the line below with:
#   RUN --mount=type=cache,id=s/<your-railway-service-id>-next-cache,target=/app/.next/cache \
#       npm run build
# Find <your-railway-service-id> in the Railway dashboard: Service → Settings
# → the UUID shown there (also exposed as the RAILWAY_SERVICE_ID variable at
# runtime, but it cannot be interpolated into the mount id at build time).
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runner — minimal production image using the Next.js standalone
# output (server.js + only the required node_modules subset).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "server.js"]
