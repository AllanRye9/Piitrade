-- Manual rollback for 20261011120000_manual_mobile_money. Remove the row from
-- "_prisma_migrations" and the PaymentProof model / Payment.dueAt from
-- schema.prisma too. DESTRUCTIVE: deletes every recorded payment proof (the
-- audit trail of manually confirmed payments). Export the table first if any
-- proofs exist:  \copy "PaymentProof" TO 'payment_proofs_backup.csv' CSV HEADER
DROP TABLE "PaymentProof";
ALTER TABLE "Payment" DROP COLUMN "dueAt";

-- NOTE: the LEGACY_BACKFILL update in the forward migration is NOT reversed by
-- this script (those payments stay COMPLETED). To list them:
--   SELECT "id","orderId" FROM "Payment" WHERE "gatewayData"->>'channel' = 'LEGACY_BACKFILL';
