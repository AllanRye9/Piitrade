-- Admin-curated "Back to School" homepage section: listings are assigned to
-- it the same way as LATEST_COLLECTIONS/FEATURED_DEAL/FLASH_SALE (via
-- Listing.placement + placementExpiresAt for per-listing timing). Adding a
-- new enum value is additive and safe to run inside a transaction as long
-- as the value isn't referenced elsewhere in this same migration.
ALTER TYPE "Placement" ADD VALUE 'BACK_TO_SCHOOL';
