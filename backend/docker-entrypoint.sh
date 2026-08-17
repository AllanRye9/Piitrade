#!/bin/sh
set -e

# Every hotfix below is intentionally non-fatal on failure (echo + continue,
# never `exit 1`) so that a single bad or inapplicable compatibility SQL
# file — e.g. one referencing a table that doesn't exist yet on a given
# environment, or a transient DB blip — can never prevent this container
# from reaching `exec node dist/index.js` at the bottom. Railway restarts a
# container that never starts listening, and a genuinely broken health
# check looks identical to a CORS failure from the browser's side (no
# process bound to the port = no response headers at all, CORS included).
# A degraded feature from one skipped hotfix is far preferable to the whole
# API being unreachable. `set -e` above only auto-aborts on *unguarded*
# command failures — every `npx prisma db execute` call here is wrapped in
# `if ! ...; then ...; fi`, so set -e never triggers on these regardless.

if [ -n "${DATABASE_PRIVATE_URL}" ]; then
	export DATABASE_URL="${DATABASE_PRIVATE_URL}"
fi

echo "Running database migrations..."
DEPLOY_OUTPUT=$(npx prisma migrate deploy 2>&1) && DEPLOY_OK=1 || DEPLOY_OK=0
echo "$DEPLOY_OUTPUT"

if [ "$DEPLOY_OK" = "0" ]; then
	echo ""
	echo "prisma migrate deploy failed – attempting to resolve failed migrations..."

	# Extract failed migration names from the deploy output.
	# Prisma outputs lines like: The `<name>` migration started at … failed
	# The migration SQL uses IF NOT EXISTS guards, so marking as rolled-back
	# and re-deploying is safe.
	FAILED_MIGRATIONS=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*`\([^`]*\)` migration.*failed.*/\1/p')

	if [ -n "$FAILED_MIGRATIONS" ]; then
		for mig in $FAILED_MIGRATIONS; do
			echo "Marking migration $mig as rolled back..."
			npx prisma migrate resolve --rolled-back "$mig" || true
		done

		echo "Retrying prisma migrate deploy..."
		if ! npx prisma migrate deploy; then
			if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ]; then
				echo "Prisma migrate deploy still failed during Railway startup; proceeding to compatibility hotfix check."
			else
				exit 1
			fi
		fi
	else
		if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ]; then
			echo "Prisma migrate deploy failed during Railway startup; proceeding to compatibility hotfix check."
		else
			exit 1
		fi
	fi
fi

echo "Ensuring Listing compatibility columns exist..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_listing_inventory_columns.sql --schema ./prisma/schema.prisma; then
	echo "Listing compatibility hotfix failed; continuing anyway. Listing routes touching the affected columns may error until this is resolved."
fi

echo "Ensuring Coupon.usedCount column exists..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_coupon_used_count.sql --schema ./prisma/schema.prisma; then
	echo "Coupon compatibility hotfix failed; continuing anyway. Check that the Coupon table exists and the database user has ALTER TABLE privileges."
fi

echo "Ensuring SiteStat table exists..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_site_stat_table.sql --schema ./prisma/schema.prisma; then
	echo "SiteStat hotfix failed; continuing anyway."
fi

echo "Ensuring SellerPackage and SellerSubscription tables exist..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_seller_subscriptions.sql --schema ./prisma/schema.prisma; then
	echo "SellerSubscription compatibility hotfix failed; continuing anyway. Check that the Currency/NotificationType enums exist and the database user has CREATE TABLE privileges."
fi

echo "Ensuring SellerPackage.scope column exists (CV vs LISTING packages)..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_cv_package_scope_column.sql --schema ./prisma/schema.prisma; then
	echo "SellerPackage.scope hotfix failed; continuing anyway. CV package pricing lookups will keep failing with 'Database schema is out of date.' until this is resolved."
fi

echo "Ensuring CvDownloadToken has deviceId/packageId/holder* columns..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_cv_download_token_columns.sql --schema ./prisma/schema.prisma; then
	echo "CvDownloadToken compatibility hotfix failed; continuing anyway. CV payment/history routes may error until this is resolved."
fi

echo "Ensuring UserDocument table exists..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_user_documents.sql --schema ./prisma/schema.prisma; then
	echo "UserDocument compatibility hotfix failed; continuing anyway. Check that the database user has CREATE TABLE privileges."
fi

echo "Seeding default listing packages (free/monthly/yearly)..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_default_packages.sql --schema ./prisma/schema.prisma; then
	echo "Default packages seed failed; continuing anyway."
fi

echo "Ensuring listing/category details columns exist..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_listing_category_details.sql --schema ./prisma/schema.prisma; then
  echo "listing/category details hotfix failed; continuing anyway."
fi

echo "Ensuring SiteConfig columns exist (interview video, general settings, logo pages type)..."
if ! npx prisma db execute --file ./prisma/hotfixes/ensure_site_config_columns.sql --schema ./prisma/schema.prisma; then
  echo "SiteConfig compatibility hotfix failed; settings page saves may not persist."
fi

# Entry point already attempted migrations. Prevent duplicate startup attempt in node process.
export AUTO_MIGRATE_ON_START=false

echo "Starting server..."
exec node dist/index.js
