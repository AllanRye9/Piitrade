-- Agriculture wholesale ordering (min order quantity / price tiers) was removed from schema.prisma.
-- Drop the columns added by 20261013110000_agriculture_order_quantities so the DB matches the schema.
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "minOrderQuantity";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "priceTiers";
