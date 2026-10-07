-- Listing visibility tiers (Free / Gold / Platinum) — the base render
-- priority every listing sits at, independent of admin-curated Placement
-- sections. See the ListingTier enum comment in schema.prisma for how this
-- relates to Placement, and backend/src/routes/listings.ts for the render
-- sort that uses it.
CREATE TYPE "ListingTier" AS ENUM ('FREE', 'GOLD', 'PLATINUM');

ALTER TABLE "Listing" ADD COLUMN "tier" "ListingTier" NOT NULL DEFAULT 'FREE';
ALTER TABLE "Listing" ADD COLUMN "tierExpiresAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "requestedTier" "ListingTier";

-- A store's subscription tier — cascades onto every listing the store owns
-- (see syncStoreListingsTier() in routes/storeRentals.ts).
ALTER TABLE "StoreRental" ADD COLUMN "tier" "ListingTier" NOT NULL DEFAULT 'FREE';

-- Store Dashboard branding: background theme, settable only by a
-- Registered Store via the Store Dashboard.
ALTER TABLE "Store" ADD COLUMN "backgroundTheme" JSONB;

-- Admin-set Free/Gold/Platinum catalog pricing (covers both the ordinary
-- per-listing tier selector and store subscription tiers).
ALTER TABLE "SiteConfig" ADD COLUMN "tierPricing" JSONB;

-- Render priority index: FLASH_SALE placement already sorts first via
-- application logic; within the general feed, listings are ordered by tier
-- (PLATINUM > GOLD > FREE) then recency. This composite index supports
-- that sort without a full table scan on large listing tables.
CREATE INDEX "Listing_status_tier_updatedAt_idx" ON "Listing"("status", "tier", "updatedAt");
