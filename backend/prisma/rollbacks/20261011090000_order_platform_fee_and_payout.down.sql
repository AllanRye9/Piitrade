-- Manual rollback for 20261011090000_order_platform_fee_and_payout.
-- Prisma Migrate has no automatic "down"; run this by hand, then remove the
-- row for this migration from "_prisma_migrations" and the three fields from
-- schema.prisma. Dropping the columns discards the recorded fee/payout split
-- (the seller balances themselves are untouched).
ALTER TABLE "Order" DROP COLUMN "payoutCreditedAt";
ALTER TABLE "Order" DROP COLUMN "sellerPayout";
ALTER TABLE "Order" DROP COLUMN "platformFee";
