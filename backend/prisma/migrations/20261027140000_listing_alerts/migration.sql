-- Instant listing alerts.
--
-- 1. SavedSearch becomes the alert rule: per-channel switches + a denormalised category slug.
--    `emailAlert` remains the master "alerts on" switch.
-- 2. ListingAlertDelivery is the exactly-once guard: one row per (listing, user) already alerted.
-- 3. ListingAlertEvent is a durable queue. A trigger on "Listing" inserts a row whenever a listing is
--    inserted as ACTIVE, becomes ACTIVE, or is ACTIVE and its price changes, and sends
--    pg_notify('listing_active') as a wake-up. EVERY write path (seller post, admin approve, bulk
--    post, scripts) is covered with no per-route hook. Workers claim rows with FOR UPDATE SKIP
--    LOCKED, so several server instances share the work without duplicates, and nothing is lost if
--    a server is down or a notification is missed (workers also poll).

ALTER TABLE "SavedSearch"
  ADD COLUMN IF NOT EXISTS "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifySound" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "categorySlug" TEXT,
  ADD COLUMN IF NOT EXISTS "lastAlertAt" TIMESTAMP(3);

UPDATE "SavedSearch" SET "categorySlug" = "filters"->>'category'
WHERE "categorySlug" IS NULL AND "filters"->>'category' IS NOT NULL;

CREATE INDEX IF NOT EXISTS "SavedSearch_emailAlert_categorySlug_idx" ON "SavedSearch"("emailAlert", "categorySlug");

CREATE TABLE IF NOT EXISTS "ListingAlertDelivery" (
  "id" TEXT NOT NULL,
  "savedSearchId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "notificationId" TEXT,
  "emailedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ListingAlertDelivery_listingId_userId_key" ON "ListingAlertDelivery"("listingId", "userId");
CREATE INDEX IF NOT EXISTS "ListingAlertDelivery_savedSearchId_idx" ON "ListingAlertDelivery"("savedSearchId");
CREATE INDEX IF NOT EXISTS "ListingAlertDelivery_userId_createdAt_idx" ON "ListingAlertDelivery"("userId", "createdAt" DESC);

ALTER TABLE "ListingAlertDelivery" DROP CONSTRAINT IF EXISTS "ListingAlertDelivery_savedSearchId_fkey";
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingAlertDelivery" DROP CONSTRAINT IF EXISTS "ListingAlertDelivery_listingId_fkey";
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingAlertDelivery" DROP CONSTRAINT IF EXISTS "ListingAlertDelivery_userId_fkey";
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ListingAlertEvent" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ListingAlertEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ListingAlertEvent_processedAt_createdAt_idx" ON "ListingAlertEvent"("processedAt", "createdAt");
-- One pending row per listing: a burst of edits collapses into a single event.
CREATE UNIQUE INDEX IF NOT EXISTS "ListingAlertEvent_pending_listing_key" ON "ListingAlertEvent"("listingId") WHERE "processedAt" IS NULL;

CREATE OR REPLACE FUNCTION notify_listing_active() RETURNS trigger AS $$
BEGIN
  INSERT INTO "ListingAlertEvent" ("id", "listingId")
  VALUES (gen_random_uuid()::text, NEW."id")
  ON CONFLICT ("listingId") WHERE "processedAt" IS NULL DO NOTHING;
  PERFORM pg_notify('listing_active', NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_active_notify_ins ON "Listing";
CREATE TRIGGER listing_active_notify_ins
  AFTER INSERT ON "Listing"
  FOR EACH ROW
  WHEN (NEW."status" = 'ACTIVE')
  EXECUTE FUNCTION notify_listing_active();

DROP TRIGGER IF EXISTS listing_active_notify_upd ON "Listing";
CREATE TRIGGER listing_active_notify_upd
  AFTER UPDATE ON "Listing"
  FOR EACH ROW
  WHEN (NEW."status" = 'ACTIVE' AND (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."price" IS DISTINCT FROM NEW."price"))
  EXECUTE FUNCTION notify_listing_active();
