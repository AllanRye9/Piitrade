-- Subscription lifecycle, listing-column preference, and category-count index.
-- Purely additive: no data is changed or dropped.

-- 1. Subscription lifecycle bookkeeping + sweep indexes
ALTER TABLE "SellerSubscription"
  ADD COLUMN "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt"    TIMESTAMP(3);

CREATE INDEX "SellerSubscription_userId_status_endDate_idx" ON "SellerSubscription"("userId", "status", "endDate");
CREATE INDEX "SellerSubscription_status_endDate_idx"        ON "SellerSubscription"("status", "endDate");

-- 2. Preferred listing-grid column count for /profile/listings
ALTER TABLE "User" ADD COLUMN "listingColumns" INTEGER;
ALTER TABLE "User" ADD CONSTRAINT "User_listingColumns_range"
  CHECK ("listingColumns" IS NULL OR ("listingColumns" BETWEEN 1 AND 6));

-- 3. Fast per-category counts of live listings (GROUP BY categoryId WHERE status = 'ACTIVE')
CREATE INDEX "Listing_status_categoryId_idx" ON "Listing"("status", "categoryId");
