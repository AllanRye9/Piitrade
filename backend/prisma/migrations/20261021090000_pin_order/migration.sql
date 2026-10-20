-- Admin homepage layout: manual pin rank for listings and stores (lower = first, NULL = unpinned).
ALTER TABLE "Listing" ADD COLUMN "pinOrder" INTEGER;
ALTER TABLE "Store" ADD COLUMN "pinOrder" INTEGER;
CREATE INDEX "Listing_pinOrder_idx" ON "Listing"("pinOrder");
