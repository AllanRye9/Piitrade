-- Rolls back 20261029090000_momo_admin_switch. MTN_ENABLED (environment) decides again.
ALTER TABLE "SiteConfig" DROP COLUMN IF EXISTS "momoEnabled";
