-- Manual rollback for 20261011110000_search_trigram_indexes. Drops only the
-- indexes; the pg_trgm extension is left installed (other things may use it).
DROP INDEX IF EXISTS "Listing_location_trgm_idx";
DROP INDEX IF EXISTS "Listing_description_trgm_idx";
DROP INDEX IF EXISTS "Listing_title_trgm_idx";
