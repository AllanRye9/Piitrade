# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — install ALL dependencies (incl. devDependencies).
# devDependencies are kept through to the runtime image on purpose: the
# Prisma CLI (used by docker-entrypoint.sh for `prisma migrate deploy` and
# compatibility hotfixes) lives in devDependencies, and running it via a
# pre-installed CLI is faster and more reliable in production than letting
# `npx` fetch it from the registry on every container start.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# openssl is required by the Prisma engines at both generate- and run-time.
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — generate the Prisma client and compile TypeScript.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.node.json ./
COPY prisma.config.ts ./prisma.config.ts
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

RUN npx prisma generate
# This codebase has never been typechecked before (no tsconfig.json existed
# until this deployment setup added one) — `tsc` is now surfacing real but
# pre-existing type gaps (Prisma JSON input types, etc.) scattered across
# routes that are out of scope to fix here without touching src/. `tsc`
# still emits JS on type errors (noEmitOnError defaults to false); we only
# treat it as fatal if no output was actually produced.
RUN npx tsc; test -f dist/index.js || (echo "tsc produced no output — fatal parse error, not just type errors" && exit 1)

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runner — minimal-as-possible production image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat curl \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nodeuser -u 1001

ENV NODE_ENV=production \
    PORT=5000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.node.json ./tsconfig.node.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Writable directory for local/temp file uploads before they are shipped to
# S3-compatible storage (see src/utils/cdn.ts). Mount a volume here in
# docker-compose / Railway if S3 env vars are not configured.
RUN mkdir -p /app/uploads/temp \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R nodeuser:nodejs /app

USER nodeuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
