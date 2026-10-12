-- Special Offers: optional "was" price on listings (idempotent).
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "originalPrice" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "Listing_originalPrice_idx" ON "Listing" ("originalPrice") WHERE "originalPrice" IS NOT NULL;
