#!/usr/bin/env bash
set -euo pipefail

SCHEMA="${SCHEMA:-prisma/schema.prisma}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/health}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL is required.' >&2
  printf '%s\n' 'Example: DATABASE_URL="postgresql://..." ./scripts/check-database-sync.sh' >&2
  exit 1
fi

printf '%s\n' 'Checking Prisma schema drift...'
diff_output=$(npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel "$SCHEMA" \
  --exit-code 2>&1) || {
  status=$?
  printf '%s\n' "$diff_output" >&2
  if [[ "$status" -eq 2 ]]; then
    printf '%s\n' 'Schema drift detected.' >&2
  fi
  exit "$status"
}

printf '%s\n' "$diff_output"
printf '%s\n' 'Checking API health...'
curl --fail --silent --show-error "$HEALTH_URL"
printf '\n%s\n' 'Database schema and API checks passed.'