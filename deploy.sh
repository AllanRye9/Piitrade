#!/usr/bin/env bash
set -euo pipefail

trap 'echo "Script failed at line ${LINENO}." >&2' ERR

# ============================================================
# Configuration
# ============================================================

FRONTEND_DIR="frontend"
BACKEND_DIR="backend"

PRISMA_SCHEMA="./prisma/schema.prisma"
PRISMA_MIGRATIONS_DIR="./prisma/migrations"
PRISMA_HOTFIX_DIR="./prisma/hotfixes"

# ============================================================
# Validate repository state
# ============================================================

if [[ -n "$(git ls-files -u)" ]]; then
  echo "Unresolved merge conflicts detected. Resolve conflicts, stage the files, and commit before running this script." >&2
  exit 1
fi

# ============================================================
# Stash local changes if any
# ============================================================

need_apply=false

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  need_apply=true
  echo "Local changes were stashed."
  git stash push --include-untracked -m "deploy-script-autostash" >/dev/null
fi

# ============================================================
# Pull latest main
# ============================================================

echo ""
echo "========================================"
echo "Pulling latest main"
echo "========================================"

git pull --ff-only origin main

# ============================================================
# Reapply local changes
# ============================================================

if [ "$need_apply" = true ]; then
  echo ""
  echo "Reapplying stashed local changes..."

  if git stash list | grep -q .; then
    git stash pop --index

    if [[ -n "$(git ls-files -u)" ]]; then
      echo "Reapplying stashed changes on top of origin/main produced merge conflicts." >&2
      echo "Resolve them manually, then re-run this script." >&2
      echo "The stash is preserved: git stash list" >&2
      exit 1
    fi
  fi
fi

# ============================================================
# Validate project structure
# ============================================================

if [ ! -d "$FRONTEND_DIR" ] || [ ! -d "$BACKEND_DIR" ]; then
  echo "Expected frontend and backend directories in repository root." >&2
  exit 1
fi

# ============================================================
# Frontend
# ============================================================

echo ""
echo "========================================"
echo "Building frontend"
echo "========================================"

pushd "$FRONTEND_DIR" > /dev/null

if [ ! -x node_modules/.bin/next ] \
  || [ ! -f node_modules/.package-lock.json ] \
  || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
else
  echo "Reusing existing frontend node_modules."
fi

npm run build

popd > /dev/null

echo "Frontend build completed successfully."

# ============================================================
# Backend
# ============================================================

if [ -f "$BACKEND_DIR/package.json" ]; then

  echo ""
  echo "========================================"
  echo "Building backend"
  echo "========================================"

  pushd "$BACKEND_DIR" > /dev/null

  if [ ! -x node_modules/.bin/tsc ] \
    || [ ! -f node_modules/.package-lock.json ] \
    || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
  else
    echo "Reusing existing backend node_modules."
  fi

  # ==========================================================
  # Prisma
  # ==========================================================
  #
  # Prisma is optional.
  #
  # We only run Prisma commands when the local Prisma CLI
  # actually exists in node_modules.
  #
  # This prevents npx from attempting to download Prisma and
  # allows the deployment to continue without Prisma.
  # ==========================================================

  PRISMA_AVAILABLE=false

  if [ -x "./node_modules/.bin/prisma" ]; then
    PRISMA_AVAILABLE=true
    echo "Prisma CLI found."
  else
    echo ""
    echo "Prisma CLI not found."
    echo "Skipping Prisma client generation and database operations."
  fi

  # ==========================================================
  # Generate Prisma client
  # ==========================================================

  if [ "$PRISMA_AVAILABLE" = true ]; then

    echo ""
    echo "Generating Prisma client..."

    ./node_modules/.bin/prisma generate

    echo "Prisma client generated successfully."

  fi

  # ==========================================================
  # Build backend before touching the database
  # ==========================================================

  echo ""
  echo "Building backend..."

  npm run build

  echo "Backend build completed successfully."

  # ==========================================================
  # Database URL
  # ==========================================================

  if [ "$PRISMA_AVAILABLE" = true ]; then

    if [ -n "${DATABASE_PRIVATE_URL:-}" ]; then
      echo "Using DATABASE_PRIVATE_URL for database operations."
      export DATABASE_URL="${DATABASE_PRIVATE_URL}"
    fi

    # ========================================================
    # Database schema sync + hotfixes
    # ========================================================

    if [ -n "${DATABASE_URL:-}" ]; then

      echo ""
      echo "========================================"
      echo "Database deployment"
      echo "========================================"

      # ======================================================
      # Detect migration workflow
      # ======================================================
      #
      # This repo does not currently commit any Prisma
      # migrations (schema changes have historically been made
      # directly in schema.prisma and synced with `prisma db
      # push`). `prisma migrate deploy` against an empty/missing
      # migrations directory succeeds trivially without applying
      # any schema changes at all, which would silently leave the
      # live database out of sync with schema.prisma.
      #
      # So: use `migrate deploy` only once real, committed
      # migrations exist under prisma/migrations. Until then,
      # fall back to `db push`, which reconciles the live schema
      # with schema.prisma directly. Once the first migration is
      # committed, this automatically switches over with no
      # script changes needed.
      # ======================================================

      HAS_MIGRATIONS=false

      if [ -d "$PRISMA_MIGRATIONS_DIR" ]; then
        if find "$PRISMA_MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d -name '*_*' -print -quit | grep -q .; then
          HAS_MIGRATIONS=true
        fi
      fi

      if [ "$HAS_MIGRATIONS" = true ]; then

        # ======================================================
        # Prisma migrations
        # ======================================================

        echo ""
        echo "Committed migrations found under $PRISMA_MIGRATIONS_DIR."
        echo "Running Prisma migrations..."

        DEPLOY_OUTPUT=$(
          ./node_modules/.bin/prisma migrate deploy 2>&1
        ) && DEPLOY_OK=1 || DEPLOY_OK=0

        echo "$DEPLOY_OUTPUT"

        # ======================================================
        # Failed migration recovery
        # ======================================================

        if [ "$DEPLOY_OK" = "0" ]; then

          echo ""
          echo "========================================"
          echo "Prisma migration failure detected"
          echo "========================================"

          echo "Attempting to identify failed migrations..."

          # Prisma normally reports failures in a format similar to:
          #
          # The `20260829094500_example` migration started at ...
          # failed
          #
          # Extract the migration name between backticks.

          FAILED_MIGRATIONS=$(
            echo "$DEPLOY_OUTPUT" |
              sed -n 's/.*`\([^`]*\)` migration.*failed.*/\1/p' |
              sort -u
          )

          if [ -n "$FAILED_MIGRATIONS" ]; then

            echo ""
            echo "Failed migration(s) detected:"

            while IFS= read -r migration; do
              [ -z "$migration" ] && continue
              echo "  - $migration"
            done <<< "$FAILED_MIGRATIONS"

            echo ""
            echo "WARNING: the migrations below will be marked as rolled back and"
            echo "re-applied automatically. This assumes each failed migration made"
            echo "no partial changes to the database. If a migration could have"
            echo "partially applied before failing, verify the schema manually"
            echo "before letting this proceed."
            echo ""

            # Resolve every failed migration dynamically.
            while IFS= read -r migration; do

              [ -z "$migration" ] && continue

              echo "Marking migration '$migration' as rolled back..."

              ./node_modules/.bin/prisma migrate resolve \
                --rolled-back "$migration" || true

            done <<< "$FAILED_MIGRATIONS"

            echo ""
            echo "Retrying Prisma migrations..."

            ./node_modules/.bin/prisma migrate deploy

          else

            echo ""
            echo "Prisma migrate deploy failed, but no failed migration name could be parsed." >&2
            echo "The database deployment has been stopped." >&2

            exit 1

          fi

        else

          echo ""
          echo "Prisma migrations completed successfully."

        fi

      else

        # ======================================================
        # No committed migrations: sync schema directly
        # ======================================================
        #
        # (Prisma 7 `db push` never generates the client, and --skip-generate
        # no longer exists; the client was already generated above.)
        # No --accept-data-loss: by design. Additive changes (new
        # nullable columns, new tables, etc.) apply without
        # prompting. Anything destructive (dropping/narrowing a
        # column, etc.) will make this command fail loudly instead
        # of silently discarding data — that case needs a human
        # to look at it and either add an explicit hotfix or
        # re-run manually with --accept-data-loss.
        # ======================================================

        echo ""
        echo "No committed migrations found under $PRISMA_MIGRATIONS_DIR."
        echo "Syncing schema directly with 'prisma db push'..."

        if ! ./node_modules/.bin/prisma db push 2>&1 | tee /tmp/db_push_output.log; then

          if grep -qi "data loss" /tmp/db_push_output.log; then
            echo ""
            echo "'prisma db push' requires confirming a potentially destructive" >&2
            echo "change and cannot proceed unattended. Review the output above," >&2
            echo "then either add a hand-written hotfix for a safe, non-destructive" >&2
            echo "path, or re-run manually with --accept-data-loss if the change" >&2
            echo "is intentional." >&2
          fi

          echo ""
          echo "Database schema sync failed. Deployment stopped." >&2
          exit 1

        fi

        echo "Schema sync completed successfully."

      fi

      # ========================================================
      # Dynamic SQL hotfix discovery
      # ========================================================
      #
      # Every .sql file directly inside prisma/hotfixes is
      # automatically executed.
      #
      # No filenames need to be hardcoded in this script.
      #
      # Files are sorted alphabetically so execution is
      # deterministic.
      #
      # Recommended naming:
      #
      #   001_ensure_listing_inventory_columns.sql
      #   002_ensure_coupon_used_count.sql
      #   003_ensure_site_stat_table.sql
      #
      # Existing filenames without numeric prefixes also work.
      #
      # Hotfixes are expected to be idempotent (CREATE TABLE IF
      # NOT EXISTS / ADD COLUMN IF NOT EXISTS-style guards) since
      # they run on every deploy regardless of migration path.
      # ========================================================

      echo ""
      echo "========================================"
      echo "Database compatibility hotfixes"
      echo "========================================"

      if [ -d "$PRISMA_HOTFIX_DIR" ]; then

        # Use null-delimited output so filenames containing spaces
        # are handled safely.
        mapfile -d '' HOTFIXES < <(
          find "$PRISMA_HOTFIX_DIR" \
            -maxdepth 1 \
            -type f \
            -name '*.sql' \
            -print0 |
            sort -z
        )

        if [ "${#HOTFIXES[@]}" -eq 0 ]; then

          echo "No SQL hotfixes found in $PRISMA_HOTFIX_DIR."

        else

          echo "Found ${#HOTFIXES[@]} SQL hotfix(es)."

          HOTFIX_FAILURES=0

          for hotfix in "${HOTFIXES[@]}"; do

            echo ""
            echo "----------------------------------------"
            echo "Applying hotfix:"
            echo "$hotfix"
            echo "----------------------------------------"

            if ./node_modules/.bin/prisma db execute \
              --file "$hotfix"; then

              echo "Hotfix completed successfully:"
              echo "$hotfix"

            else

              HOTFIX_FAILURES=$((HOTFIX_FAILURES + 1))

              echo ""
              echo "WARNING: Hotfix failed:"
              echo "$hotfix"
              echo "Continuing with remaining hotfixes..."

            fi

          done

          echo ""
          echo "----------------------------------------"
          echo "Hotfix summary"
          echo "----------------------------------------"
          echo "Hotfixes found:    ${#HOTFIXES[@]}"
          echo "Hotfixes failed:   $HOTFIX_FAILURES"
          echo "----------------------------------------"

          if [ "$HOTFIX_FAILURES" -gt 0 ]; then
            echo ""
            echo "WARNING: $HOTFIX_FAILURES hotfix(es) failed. Review the output above." >&2
          fi

        fi

      else

        echo "No hotfix directory found at:"
        echo "$PRISMA_HOTFIX_DIR"
        echo "Skipping database hotfixes."

      fi

      echo ""
      echo "Database deployment completed."

    else

      echo ""
      echo "No DATABASE_URL set."
      echo "Skipping schema sync and database hotfixes."

    fi

  else

    echo ""
    echo "Prisma is not installed."
    echo "Skipping Prisma client generation, schema sync, and hotfixes."

  fi

  popd > /dev/null

else

  echo ""
  echo "Warning: backend/package.json not found."
  echo "Skipping backend build and database deployment."

fi

# ============================================================
# Commit generated/build changes
# ============================================================

echo ""
echo "========================================"
echo "Checking for changes"
echo "========================================"

git add .

if git diff --cached --quiet; then

  echo "Build completed, but there are no changes to commit."
  exit 0

fi

# ============================================================
# Commit
# ============================================================

echo ""
echo "Committing changes..."

git commit -m "$(TZ="Asia/Dubai" date +'%Y-%m-%d %H:%M:%S')"

# ============================================================
# Push
# ============================================================

echo ""
echo "Pushing to origin/main..."

git push origin main

echo ""
echo "========================================"
echo "Deployment completed successfully"
echo "========================================"

echo "Done!"