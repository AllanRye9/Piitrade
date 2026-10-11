-- Manual rollback for 20261011130000_refund_payout_reversal. Remove the row
-- from "_prisma_migrations" and the three fields from schema.prisma too.
-- WARNING: this loses the record of which payouts were reversed. If any refund
-- has been processed since the migration, seller balances already reflect the
-- reversal; re-applying later would not know that. Export first:
--   \copy (SELECT id,"orderNumber","sellerPayout","payoutReversedAt","refundReason" FROM "Order" WHERE "payoutReversedAt" IS NOT NULL) TO 'reversals.csv' CSV HEADER
ALTER TABLE "Order" DROP COLUMN "refundedById";
ALTER TABLE "Order" DROP COLUMN "refundReason";
ALTER TABLE "Order" DROP COLUMN "payoutReversedAt";
