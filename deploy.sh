#!/usr/bin/env bash
set -euo pipefail

trap 'echo "Script failed at line ${LINENO}." >&2' ERR

# If DATABASE_URL / DATABASE_PRIVATE_URL isn't already exported in this shell,
# pull it from backend/.env (where the production secret already lives on the
# server, untracked by git) so the script can complete without a manual
# `export DATABASE_URL=...` step before every run.
#
# NOTE: deliberately NOT using `source`/`.` here. Sourcing runs the file as
# real bash, so a `$`, backtick, or other shell metacharacter in the DB
# password gets interpreted instead of taken literally, and CRLF line endings
# leave a trailing \r stuck on the value - both silently corrupt the URL and
# produce Prisma's "must start with the protocol postgresql://" error even
# though a value was actually loaded. Extract just the one line as plain text
# instead.
read_env_var() {
  local file="$1" key="$2" line val
  line=$(grep -m1 "^${key}=" "$file") || return 1
  val="${line#*=}"
  val="${val%$'\r'}"                # strip trailing CR (CRLF line endings)
  val="${val%\"}"; val="${val#\"}"  # strip surrounding double quotes
  val="${val%\'}"; val="${val#\'}"  # strip surrounding single quotes
  printf '%s' "$val"
}

is_valid_postgres_url() {
  local url="${1:-}"
  [[ -n "$url" && "$url" =~ ^postgres(ql)?:// ]]
}

if [[ -z "${DATABASE_URL:-}" && -z "${DATABASE_PRIVATE_URL:-}" && -f backend/.env ]]; then
  loaded_url="$(read_env_var backend/.env DATABASE_URL || true)"
  loaded_private_url="$(read_env_var backend/.env DATABASE_PRIVATE_URL || true)"

  if [[ -n "$loaded_url" && "$loaded_url" =~ ^https?:// ]]; then
    echo "Ignoring invalid DATABASE_URL loaded from backend/.env: must start with postgresql:// or postgres://" >&2
  elif [[ -n "$loaded_url" ]]; then
    export DATABASE_URL="$loaded_url"
  fi

  if [[ -n "$loaded_private_url" && "$loaded_private_url" =~ ^https?:// ]]; then
    echo "Ignoring invalid DATABASE_PRIVATE_URL loaded from backend/.env: must start with postgresql:// or postgres://" >&2
  elif [[ -n "$loaded_private_url" ]]; then
    export DATABASE_PRIVATE_URL="$loaded_private_url"
  fi
fi

if [[ -n "${DATABASE_URL:-}" && ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  echo "Ignoring invalid DATABASE_URL environment variable: must start with postgresql:// or postgres://" >&2
  unset DATABASE_URL
fi

if [[ -n "${DATABASE_PRIVATE_URL:-}" && ! "$DATABASE_PRIVATE_URL" =~ ^postgres(ql)?:// ]]; then
  echo "Ignoring invalid DATABASE_PRIVATE_URL environment variable: must start with postgresql:// or postgres://" >&2
  unset DATABASE_PRIVATE_URL
fi

# if ! git diff --quiet || ! git diff --cached --quiet; then
#   echo "Working tree has uncommitted changes. Commit or stash them before running this script." >&2
#   exit 1
# fi

if [[ -n "$(git ls-files -u)" ]]; then
  echo "Unresolved merge conflicts detected. Resolve conflicts, stage the files, and commit before running this script." >&2
  exit 1
fi

# Stash local changes if any, remember whether we created a stash
stash_output=$(git stash 2>&1 || true)
need_apply=false
if [[ "$stash_output" != *"No local changes"* ]]; then
  need_apply=true
fi

git pull --ff-only origin main

# Only apply stash if we actually created one
if [ "$need_apply" = true ]; then
  git stash apply
  if [[ -n "$(git ls-files -u)" ]]; then
    echo "Reapplying stashed changes on top of origin/main produced merge conflicts." >&2
    echo "Resolve them manually, then re-run this script (the stash is preserved: 'git stash list')." >&2
    exit 1
  fi
fi

if [ ! -d frontend ] || [ ! -d backend ]; then
  echo "Expected frontend and backend directories in repository root." >&2
  exit 1
fi

pushd frontend > /dev/null
rm -rf node_modules package-lock.json
npm install
npm run build
popd > /dev/null

if [ -f backend/package.json ]; then
  pushd backend > /dev/null
  rm -rf node_modules package-lock.json
  npm install

  # `prisma` is a pinned "dependencies" entry (not devDependencies) on purpose:
  # `--no-install` below makes npx use only that locally-installed version.
  # If it were ever missing, npx would otherwise silently download the
  # latest version from the registry instead - which can be a newer major
  # version with breaking schema/config changes (this happened once:
  # prisma@7 dropped support for `datasource { url = env(...) }` in
  # schema.prisma, which made every migration/hotfix step below fail with a
  # schema validation error, and every DB-backed route in the app failed as
  # a result). `--no-install` makes that failure loud and immediate instead.
  npx --no-install prisma generate
  npm run build

  if [ -n "${DATABASE_PRIVATE_URL:-}" ]; then
    export DATABASE_URL="${DATABASE_PRIVATE_URL}"
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "Running database migrations..."
    DEPLOY_OUTPUT=$(npx --no-install prisma migrate deploy 2>&1) && DEPLOY_OK=1 || DEPLOY_OK=0
    echo "$DEPLOY_OUTPUT"

    if [ "$DEPLOY_OK" = "0" ]; then
      echo ""
      echo "prisma migrate deploy failed - attempting to resolve failed migrations..."

      # Extract failed migration names from the deploy output.
      # Prisma outputs lines like: The `<n>` migration started at ... failed
      # The migration SQL uses IF NOT EXISTS guards, so marking as
      # rolled-back and re-deploying is safe.
      FAILED_MIGRATIONS=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*`\([^`]*\)` migration.*failed.*/\1/p')

      if [ -n "$FAILED_MIGRATIONS" ]; then
        for mig in $FAILED_MIGRATIONS; do
          echo "Marking migration $mig as rolled back..."
          npx --no-install prisma migrate resolve --rolled-back "$mig" || true
        done

        echo "Retrying prisma migrate deploy..."
        npx --no-install prisma migrate deploy
      else
        echo "Prisma migrate deploy failed and no failed migration name could be parsed." >&2
        exit 1
      fi
    fi

    echo "Applying schema compatibility hotfixes..."

    echo "Ensuring Listing compatibility columns exist..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_listing_inventory_columns.sql --schema ./prisma/schema.prisma

    echo "Ensuring Coupon.usedCount column exists..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_coupon_used_count.sql --schema ./prisma/schema.prisma

    echo "Ensuring SiteStat table exists..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_site_stat_table.sql --schema ./prisma/schema.prisma || echo "SiteStat hotfix failed; continuing anyway."

    echo "Ensuring SellerPackage and SellerSubscription tables exist..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_seller_subscriptions.sql --schema ./prisma/schema.prisma

    echo "Ensuring SellerPackage.scope column exists (CV vs LISTING packages)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_cv_package_scope_column.sql --schema ./prisma/schema.prisma || echo "SellerPackage.scope hotfix failed; CV package pricing will stay unavailable until this is resolved."

    echo "Ensuring UserDocument table exists..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_user_documents.sql --schema ./prisma/schema.prisma

    echo "Seeding default listing packages (free/monthly/yearly)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_default_packages.sql --schema ./prisma/schema.prisma || echo "Default packages seed failed; continuing anyway."

    echo "Ensuring listing/category details columns exist..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_listing_category_details.sql --schema ./prisma/schema.prisma || echo "listing/category details hotfix failed; continuing anyway."

    echo "Ensuring CvDownloadToken history columns exist (device/package tracking, CV holder snapshot)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_cv_download_token_columns.sql --schema ./prisma/schema.prisma || echo "CvDownloadToken hotfix failed; CV history dashboard may not populate correctly."

    echo "Ensuring SiteConfig columns exist (interview video, promo video, general settings, logo pages type)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_site_config_columns.sql --schema ./prisma/schema.prisma || echo "SiteConfig compatibility hotfix failed; settings page saves may not persist."
  else
    echo "No DATABASE_URL set; skipping migrations and schema hotfixes."
  fi

  popd > /dev/null
else
  echo "Warning: backend/package.json not found. Skipping backend build."
fi

git add .

if git diff --cached --quiet; then
  echo "Build completed, but there are no changes to commit."
  exit 0
fi

git commit -m "Update frontend build"
git push origin main
echo "Done!"