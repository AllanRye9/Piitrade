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
    if ! git stash pop --index; then
      if [[ -n "$(git ls-files -u)" ]]; then
        echo "Reapplying stashed changes on top of origin/main produced merge conflicts." >&2
        echo "Resolve them manually, then verify the worktree before continuing." >&2
        echo "The stash is preserved: git stash list" >&2
      else
        echo "Could not reapply the stashed changes. Check the stash list before continuing." >&2
      fi
      exit 1
    fi

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

      # Single source of truth for migrations, baselining (P3005), hotfixes
      # and schema verification: scripts/db-setup.ts. It is the same script
      # the container entrypoint and the backend boot run, so a deploy that
      # passes here will also pass at startup. It exits non-zero on failure
      # and set -e stops the deploy before anything is committed or pushed.
      npm run db:setup

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