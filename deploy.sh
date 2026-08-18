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
  if [ ! -f "./prisma/schema.prisma" ]; then
    echo "ERROR: backend/prisma/schema.prisma not found." >&2
    echo "  - Check it's committed: git ls-files prisma/schema.prisma (run from backend/)" >&2
    echo "  - Check it's on disk: ls -la prisma/" >&2
    echo "  - Check backend/package.json doesn't have a \"prisma.schema\" field pointing elsewhere." >&2
    exit 1
  fi
  npx --no-install prisma generate
  npm run build

  if [ -n "${DATABASE_PRIVATE_URL:-}" ]; then
    export DATABASE_URL="${DATABASE_PRIVATE_URL}"
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    # Migrations only run if the migrations directory actually exists (and
    # has something in it). `prisma migrate deploy` already no-ops safely on
    # an empty directory, so this is a defensive guard rather than a
    # behavior change - it just avoids invoking prisma at all when there's
    # nothing for it to apply, and gives a clear message instead of prisma's
    # own output if the directory is missing entirely (e.g. a fresh
    # checkout that hasn't pulled migrations yet).
    if [ -d "./prisma/migrations" ] && [ -n "$(ls -A ./prisma/migrations 2>/dev/null)" ]; then
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
    else
      echo "No prisma/migrations directory (or it's empty); skipping migrations."
    fi

    echo "Applying schema compatibility hotfixes..."

    # ------------------------------------------------------------------
    # Known hotfixes, in the order they must run (later ones can depend on
    # tables/columns created by earlier ones - e.g. the SellerPackage.scope
    # hotfix needs the SellerPackage table from ensure_seller_subscriptions).
    # Each entry is "relative/path/to/file.sql|description|mode" where mode
    # is "hard" (missing/failed file aborts the deploy, same as the
    # original un-guarded calls) or "soft" (log a warning and continue, same
    # as the original `|| echo ... continuing anyway` calls). The file is
    # only run "if exists" - a missing file is skipped with a message
    # instead of erroring on a missing path, regardless of mode.
    # ------------------------------------------------------------------
    KNOWN_HOTFIXES=(
      "./prisma/hotfixes/ensure_listing_inventory_columns.sql|Ensuring Listing compatibility columns exist|hard"
      "./prisma/hotfixes/ensure_coupon_used_count.sql|Ensuring Coupon.usedCount column exists|hard"
      "./prisma/hotfixes/ensure_site_stat_table.sql|Ensuring SiteStat table exists|soft:SiteStat hotfix failed; continuing anyway."
      "./prisma/hotfixes/ensure_seller_subscriptions.sql|Ensuring SellerPackage and SellerSubscription tables exist|hard"
      "./prisma/hotfixes/ensure_cv_package_scope_column.sql|Ensuring SellerPackage.scope column exists (CV vs LISTING packages)|soft:SellerPackage.scope hotfix failed; CV package pricing will stay unavailable until this is resolved."
      "./prisma/hotfixes/ensure_user_documents.sql|Ensuring UserDocument table exists|hard"
      "./prisma/hotfixes/ensure_default_packages.sql|Seeding default listing packages (free/monthly/yearly)|soft:Default packages seed failed; continuing anyway."
      "./prisma/hotfixes/ensure_listing_category_details.sql|Ensuring listing/category details columns exist|soft:listing/category details hotfix failed; continuing anyway."
      "./prisma/hotfixes/ensure_cv_download_token_columns.sql|Ensuring CvDownloadToken history columns exist (device/package tracking, CV holder snapshot)|soft:CvDownloadToken hotfix failed; CV history dashboard may not populate correctly."
      "./prisma/hotfixes/ensure_site_config_columns.sql|Ensuring SiteConfig columns exist (interview video, promo video, general settings, logo pages type)|soft:SiteConfig compatibility hotfix failed; settings page saves may not persist."
    )

    # Track which files we've handled above so the auto-discovery pass below
    # doesn't run any of them a second time.
    declare -A HANDLED_HOTFIXES=()

    run_hotfix() {
      local file="$1" desc="$2" mode="$3"

      if [ ! -f "$file" ]; then
        echo "  - $file not found; skipping ($desc)."
        return 0
      fi

      echo "$desc..."
      if [ "$mode" = "hard" ]; then
        npx --no-install prisma db execute --file "$file" --schema ./prisma/schema.prisma
      else
        local warn_msg="${mode#soft:}"
        npx --no-install prisma db execute --file "$file" --schema ./prisma/schema.prisma || echo "$warn_msg"
      fi
    }

    for entry in "${KNOWN_HOTFIXES[@]}"; do
      IFS='|' read -r hf_file hf_desc hf_mode <<< "$entry"
      run_hotfix "$hf_file" "$hf_desc" "$hf_mode"
      HANDLED_HOTFIXES["$hf_file"]=1
    done

    # ------------------------------------------------------------------
    # Auto-discovery: pick up any hotfix files that exist in
    # prisma/hotfixes/ but weren't in the known/ordered list above (e.g. a
    # new one added since this script was last updated). Run in filename
    # order and treat failures as soft (non-fatal), matching the pattern
    # used for hotfixes generally (IF NOT EXISTS guards make them safe to
    # retry/skip). If a newly discovered hotfix has ordering requirements,
    # add it to KNOWN_HOTFIXES above instead of relying on this pass.
    # ------------------------------------------------------------------
    if [ -d "./prisma/hotfixes" ]; then
      while IFS= read -r -d '' file; do
        if [ -z "${HANDLED_HOTFIXES[$file]:-}" ]; then
          base=$(basename "$file")
          echo "Running newly discovered hotfix: $base..."
          npx --no-install prisma db execute --file "$file" --schema ./prisma/schema.prisma \
            || echo "$base hotfix failed; continuing anyway (not in known ordered list - add it to KNOWN_HOTFIXES if it needs to run at a specific point)."
        fi
      done < <(find ./prisma/hotfixes -maxdepth 1 -name '*.sql' -print0 | sort -z)
    fi
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