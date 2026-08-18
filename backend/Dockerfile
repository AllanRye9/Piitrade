# Build context is this directory (backend/) — self-contained, runs
# independently of the repo root. Build directly with:
#   cd backend && docker build -t piitrade-backend .
# Also used by docker-compose.yml with `context: ./backend`.
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package*.json ./
# prisma CLI is needed at runtime to run `prisma migrate deploy`
RUN npm ci --only=production

FROM base AS builder
COPY package*.json ./
# Provide a placeholder DATABASE_URL so that the @prisma/client postinstall
# hook (which runs `prisma generate`) and the explicit generate step below
# can validate the schema format without a real database connection.
# The actual DATABASE_URL is injected at container runtime by the host/orchestrator.
ARG DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
ENV DATABASE_URL=${DATABASE_URL}
RUN npm ci
COPY . .
# Some deployments intentionally do not ship a Prisma schema yet; skip generation
# in that case instead of failing the entire image build.
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; else echo "Skipping prisma generate: prisma/schema.prisma not found"; fi
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Prisma may be intentionally absent in some environments; do not fail the build
# when the repo does not include a schema or generated client yet.
RUN if [ -d /app/prisma ]; then cp -R /app/prisma ./prisma; fi
RUN if [ -d /app/node_modules/.prisma ]; then mkdir -p /tmp/prisma-client && cp -R /app/node_modules/.prisma /tmp/prisma-client/ && cp -R /tmp/prisma-client/.prisma ./node_modules/.prisma; fi
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]
