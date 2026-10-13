-- Agriculture wholesale ordering: minimum order quantity + volume price tiers.
ALTER TABLE "Listing" ADD COLUMN "minOrderQuantity" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "priceTiers" JSONB;
