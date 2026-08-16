-- Performance indexes on Listing table for faster country/status/category queries

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_country_status_createdAt_idx"
  ON "Listing"("country", "status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_categoryId_country_status_idx"
  ON "Listing"("categoryId", "country", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_userId_status_createdAt_idx"
  ON "Listing"("userId", "status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_status_placement_country_idx"
  ON "Listing"("status", "placement", "country");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_country_placement_status_idx"
  ON "Listing"("country", "placement", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_createdAt_idx"
  ON "Listing"("createdAt" DESC);
