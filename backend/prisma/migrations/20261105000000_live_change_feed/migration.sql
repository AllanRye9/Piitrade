-- Live change feed.
--
-- Postgres tells the app the moment listing-related data changes, so open pages refresh immediately
-- instead of polling. The trigger sits on the tables themselves, so EVERY write path is covered with
-- no per-route hook: seller edits, admin approve/reject/delete, bulk actions, scheduled jobs, scripts.
--
-- The payload is only a topic name ('listings', 'clicks'), never row data, so nothing can leak
-- through the channel. The app (utils/liveHub.ts) LISTENs, coalesces bursts and pushes one tiny
-- Server-Sent Event to open browsers, which then re-read the data through the normal API (so
-- permissions are always enforced by the API, not by the feed).
--
--   listings  public listing pages / search results
--   clicks    admin Item Clicks (also changes when a listing is edited, approved or deleted)

CREATE OR REPLACE FUNCTION notify_data_changed() RETURNS trigger AS $$
DECLARE
  topic text;
BEGIN
  -- TG_ARGV[0] is a comma separated topic list. Identical NOTIFYs inside one transaction are
  -- delivered once, so a bulk write is one wake-up per topic.
  FOREACH topic IN ARRAY string_to_array(TG_ARGV[0], ',') LOOP
    PERFORM pg_notify('data_changed', topic);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Listing: create / delete, and any update that changes something a visitor or admin can see.
-- Counters and bookkeeping (views, updatedAt, reminder flags, moderation metadata) are ignored,
-- otherwise every page view would wake every open page.
DROP TRIGGER IF EXISTS live_listing_ins_del ON "Listing";
CREATE TRIGGER live_listing_ins_del
  AFTER INSERT OR DELETE ON "Listing"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed('listings,clicks');

DROP TRIGGER IF EXISTS live_listing_upd ON "Listing";
CREATE TRIGGER live_listing_upd
  AFTER UPDATE ON "Listing"
  FOR EACH ROW
  WHEN (
    (OLD."title", OLD."description", OLD."price", OLD."originalPrice", OLD."priceUnit", OLD."currency",
     OLD."condition", OLD."status", OLD."images", OLD."location", OLD."country", OLD."quantity",
     OLD."tags", OLD."placement", OLD."placementExpiresAt", OLD."tier", OLD."pinOrder",
     OLD."expiresAt", OLD."categoryId")
    IS DISTINCT FROM
    (NEW."title", NEW."description", NEW."price", NEW."originalPrice", NEW."priceUnit", NEW."currency",
     NEW."condition", NEW."status", NEW."images", NEW."location", NEW."country", NEW."quantity",
     NEW."tags", NEW."placement", NEW."placementExpiresAt", NEW."tier", NEW."pinOrder",
     NEW."expiresAt", NEW."categoryId")
  )
  EXECUTE FUNCTION notify_data_changed('listings,clicks');

-- Photos: an approved / rejected / attached / removed photo changes what listings and clicks show.
DROP TRIGGER IF EXISTS live_productimage_ins_del ON "ProductImage";
CREATE TRIGGER live_productimage_ins_del
  AFTER INSERT OR DELETE ON "ProductImage"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed('listings,clicks');

DROP TRIGGER IF EXISTS live_productimage_upd ON "ProductImage";
CREATE TRIGGER live_productimage_upd
  AFTER UPDATE ON "ProductImage"
  FOR EACH ROW
  WHEN ((OLD."status", OLD."cdnUrl", OLD."listingId") IS DISTINCT FROM (NEW."status", NEW."cdnUrl", NEW."listingId"))
  EXECUTE FUNCTION notify_data_changed('listings,clicks');

-- Item clicks: a new click, or a wipe of the log.
DROP TRIGGER IF EXISTS live_clicklog_ins_del ON "ListingClickLog";
CREATE TRIGGER live_clicklog_ins_del
  AFTER INSERT OR DELETE ON "ListingClickLog"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed('clicks');
