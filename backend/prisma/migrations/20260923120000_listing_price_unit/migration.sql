-- Lets a listing's price be quoted per kg or per tonne instead of only per
-- item — needed for Agriculture produce (crops/livestock sold by weight).
-- See the "Price unit" selector on the Agriculture quick-post form
-- (frontend: create-produce).
CREATE TYPE "PriceUnit" AS ENUM ('ITEM', 'KG', 'TONNE');

ALTER TABLE "Listing" ADD COLUMN "priceUnit" "PriceUnit" NOT NULL DEFAULT 'ITEM';
