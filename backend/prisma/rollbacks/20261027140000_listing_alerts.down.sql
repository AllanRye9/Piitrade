-- Rolls back 20261027140000_listing_alerts (alert history in ListingAlertDelivery is lost).
DROP TRIGGER IF EXISTS listing_active_notify_upd ON "Listing";
DROP TRIGGER IF EXISTS listing_active_notify_ins ON "Listing";
DROP FUNCTION IF EXISTS notify_listing_active();
DROP TABLE IF EXISTS "ListingAlertEvent";
DROP TABLE IF EXISTS "ListingAlertDelivery";
DROP INDEX IF EXISTS "SavedSearch_emailAlert_categorySlug_idx";
ALTER TABLE "SavedSearch" DROP COLUMN IF EXISTS "notifyEmail", DROP COLUMN IF EXISTS "notifySound", DROP COLUMN IF EXISTS "categorySlug", DROP COLUMN IF EXISTS "lastAlertAt";
-- The 'LISTING_ALERT' enum value (20261024110000) cannot be removed from a PostgreSQL enum; it is harmless to leave.
