#!/usr/bin/env bash
set -euo pipefail

trap 'echo "Script failed at line ${LINENO}." >&2' ERR

# if ! git diff --quiet || ! git diff --cached --quiet; then
#   echo "Working tree has uncommitted changes. Commit or stash them before running this script." >&2
#   exit 1
# fi

if [[ -n "$(git ls-files -u)" ]]; then
  echo "Unresolved merge conflicts detected. Resolve conflicts, stage the files, and commit before running this script." >&2
  exit 1
fi

# FIX: the rest of the script assumes it is operating on `main` (it later runs
# `git pull --ff-only origin main` and `git push origin main`). If this script
# is invoked from a different branch, `pull --ff-only origin main` merges
# origin/main into *that* branch instead of updating main, and the final push
# would then push the wrong branch's history to main. Make the assumption
# explicit and fail loudly instead of silently operating on the wrong branch.
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "main" ]]; then
  echo "Must be run from the 'main' branch (currently on '$current_branch')." >&2
  exit 1
fi

# Stash local changes if any, remember whether we created a stash.
# FIX: added -u so untracked files (e.g. a new hotfix .sql file you haven't
# git-added yet) survive the pull too, not just tracked-file edits.
stash_output=$(git stash push -u 2>&1 || true)
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

# FIX: `rm -rf node_modules package-lock.json && npm install` regenerates the
# lockfile from scratch on every run, re-resolving every semver range in
# package.json against whatever is newest in the registry that day. That
# silently undermines the exact scenario the backend build's own comment
# below warns about: a dependency (like `prisma`) drifting to a new major
# version between deploys with no diff to review. `npm ci` installs exactly
# what's pinned in the committed package-lock.json — reproducible, and any
# intentional version bump has to go through an explicit `npm install
# <pkg>@x` + reviewed lockfile diff instead of happening implicitly here.
# Falls back to `npm install` only on a first run with no lockfile yet.
install_deps() {
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
}

pushd frontend > /dev/null
install_deps
npm run build
frontend_built=true
popd > /dev/null

backend_built=false
migrations_ran=false

if [ -f backend/package.json ]; then
  pushd backend > /dev/null
  install_deps

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
  backend_built=true

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
          # FIX: quote "$mig" - unquoted expansion is unnecessary word-splitting
          # risk here even though migration names shouldn't contain spaces.
          npx --no-install prisma migrate resolve --rolled-back "$mig" || true
        done

        echo "Retrying prisma migrate deploy..."
        npx --no-install prisma migrate deploy
      else
        echo "Prisma migrate deploy failed and no failed migration name could be parsed." >&2
        exit 1
      fi
    fi

    migrations_ran=true
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

    echo "Ensuring SiteConfig advertisement columns exist (homepage ad banner)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_site_config_ad_columns.sql --schema ./prisma/schema.prisma || echo "SiteConfig advertisement hotfix failed; homepage ad banner saves may not persist."

    echo "Ensuring SiteConfig ad-rotation columns exist (multiple ad images + interval timer)..."
    npx --no-install prisma db execute --file ./prisma/hotfixes/ensure_site_config_ad_rotation_columns.sql --schema ./prisma/schema.prisma || echo "SiteConfig ad-rotation hotfix failed; homepage ad rotation saves may not persist."
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

# FIX: the commit message previously always said "Update frontend build" even
# on runs that also rebuilt the backend and ran migrations against the
# database - misleading when reading `git log` later to see what a deploy
# actually did. Build the message from what actually happened this run.
commit_parts=()
[ "$frontend_built" = true ] && commit_parts+=("frontend build")
[ "$backend_built" = true ] && commit_parts+=("backend build")
[ "$migrations_ran" = true ] && commit_parts+=("DB migrations")
commit_message="Update $(IFS=' + '; echo "${commit_parts[*]}")"

git commit -m "$commit_message"
git push origin main
echo "Done!"
