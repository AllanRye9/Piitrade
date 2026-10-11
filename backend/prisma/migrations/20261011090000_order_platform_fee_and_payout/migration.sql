-- Platform fee & seller payout, recorded once on the Order when it is
-- DELIVERED (see backend/src/utils/orderStatusService.ts). All three columns
-- are nullable and additive: existing queries and code are unaffected.
--
--   platformFee      what the platform kept (admin-configured % of total - shipping)
--   sellerPayout     what was credited to the seller's balance
--   payoutCreditedAt when that credit happened; non-null == "already paid out",
--                    the guard that prevents crediting the same order twice.
ALTER TABLE "Order" ADD COLUMN "platformFee"      DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "sellerPayout"     DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "payoutCreditedAt" TIMESTAMP(3);

-- Backfill: the previous code credited the seller (total - shippingCost) at
-- DELIVERED, in both order-status routes. Mark those orders as already paid
-- out so the new guard treats them as settled. NOTE: this records the
-- single credit that SHOULD have happened; it does NOT detect or correct
-- orders that the old repeat-credit bug paid more than once — audit those
-- separately (see TESTING.md / fix list B1).
UPDATE "Order"
SET "platformFee"      = 0,
    "sellerPayout"     = "total" - "shippingCost",
    "payoutCreditedAt" = COALESCE("deliveredAt", "updatedAt")
WHERE "status" = 'DELIVERED'
  AND "payoutCreditedAt" IS NULL;
