#!/usr/bin/env bash
#
# prisma-local.sh — local dev workflow for Prisma migrations, matching this
# repo's actual conventions (docker-compose Postgres, prisma/migrations
# already baselined with `init`, and the db-setup.ts baseline/hotfix logic
# also used by docker-entrypoint.sh / src/index.ts on container start).
#
# Usage (run from anywhere — it locates the backend/ dir itself):
#   backend/scripts/prisma-local.sh check     Read-only drift check
#   backend/scripts/prisma-local.sh migrate   Generate + apply a new migration
#                                              (wraps `prisma migrate dev`)
#   backend/scripts/prisma-local.sh deploy    Apply committed migrations the
#                                              same way production does
#                                              (wraps `npm run db:setup`, so
#                                              you get the P3005 baseline
#                                              fallback + hotfixes for free)
#   backend/scripts/prisma-local.sh reset     Drop + recreate the local DB
#
# DATABASE_URL resolution order:
#   1. Already exported in your shell
#   2. backend/.env.local
#   3. backend/.env
#   4. The docker-compose default (postgresql://marketplace:marketplace_secret@localhost:55432/marketplace_db?schema=public)
#      — matches docker-compose.yml's POSTGRES_* defaults and the 55432 host
#      port mapping, so this works out of the box against `docker compose up`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

# ── Resolve DATABASE_URL ───────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  for envfile in .env.local .env; do
    if [ -f "$envfile" ]; then
      # Strip CRLF line endings (this repo's .env.example ships with \r\n)
      # before sourcing, so quoted values with spaces/$ signs parse the same
      # way `dotenv/config` (used by the app itself) would read them.
      set -a
      # shellcheck disable=SC1090
      source <(sed 's/\r$//' "$envfile")
      set +a
      break
    fi
  done
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ️  DATABASE_URL not set and no backend/.env(.local) found — falling back"
  echo "   to the docker-compose default (localhost:55432)."
  export DATABASE_URL="postgresql://marketplace:marketplace_secret@localhost:55432/marketplace_db?schema=public"
fi

echo "🔗 DATABASE_URL: $(echo "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"

SCHEMA="prisma/schema.prisma"
if [ ! -f "$SCHEMA" ]; then
  echo "❌ No Prisma schema found at $SCHEMA"
  exit 1
fi
echo "📄 Using schema: $SCHEMA"

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ npx not found — is Node installed and are you inside backend/?"
  exit 1
fi

check_drift() {
  set +e
  # Prisma 7: --from-url / --to-schema-datamodel were removed. The database
  # comes from the datasource in prisma.config.ts (reads DATABASE_URL).
  npx prisma migrate diff \
    --from-config-datasource \
    --to-schema "$SCHEMA" \
    --exit-code
  DIFF_EXIT=$?
  set -e

  if [ "$DIFF_EXIT" -eq 0 ]; then
    echo "✅ No drift — DB matches schema"
    return 0
  elif [ "$DIFF_EXIT" -eq 2 ]; then
    echo "⚠️  Schema drift detected"
    return 2
  else
    echo "::error:: prisma migrate diff failed unexpectedly (exit $DIFF_EXIT)"
    exit "$DIFF_EXIT"
  fi
}

warn_if_destructive() {
  local sql_file="$1"
  if grep -qiE "drop table|drop column|alter table.*drop|truncate" "$sql_file"; then
    echo ""
    echo "🚨 This migration contains destructive operations (DROP TABLE/COLUMN, TRUNCATE)."
    echo "   Review $sql_file carefully before continuing."
    echo ""
  fi
}

CMD="${1:-}"

case "$CMD" in
  check)
    check_drift || true
    ;;

  migrate)
    set +e
    npx prisma migrate diff \
      --from-config-datasource \
      --to-schema "$SCHEMA" \
      --script > /tmp/prisma_local_preview.sql 2>/tmp/prisma_local_preview.stderr
    set -e

    if [ -s /tmp/prisma_local_preview.sql ]; then
      warn_if_destructive /tmp/prisma_local_preview.sql
    fi

    # Generates the migration file and applies it. Prisma 7 no longer runs
    # `prisma generate` automatically after `migrate dev`, so do it explicitly.
    # Remember to commit the new prisma/migrations/<timestamp>_<name>/
    # directory afterward per prisma/migrations/README.md.
    npx prisma migrate dev --schema="$SCHEMA"
    npx prisma generate --schema="$SCHEMA"
    ;;

  deploy)
    # Reuse the repo's own setup script instead of a bare `prisma migrate
    # deploy`, so a fresh/behind local DB gets the same P3005 baseline
    # fallback and prisma/hotfixes/*.sql handling that production gets via
    # docker-entrypoint.sh.
    echo "🚀 Applying migrations via db-setup.ts (same path as production)..."
    npm run db:setup
    ;;

  reset)
    echo "⚠️  This will drop and recreate the local database."
    npx prisma migrate reset --schema="$SCHEMA"
    ;;

  *)
    echo "Usage: $0 {check|migrate|deploy|reset}"
    exit 1
    ;;
esac
