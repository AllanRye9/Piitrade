-- Refunds now reverse the seller's payout (see backend/src/utils/orderStatusService.ts).
--
--   payoutReversedAt  when the payout credited at delivery was taken back; the
--                     guard that makes the reversal happen exactly once.
--   refundReason      why the order was refunded (admin must give one).
--   refundedById      the admin who refunded it (no FK on purpose: audit data
--                     must survive the user being deleted).
--
-- Additive, nullable. Deliberately NO backfill: orders refunded BEFORE this
-- release never had their payout reversed, so they keep payoutReversedAt NULL
-- and scripts/reconcile-seller-balances.sql (query 3) lists them so an admin can
-- decide whether to claw the payout back.
ALTER TABLE "Order" ADD COLUMN "payoutReversedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "refundReason"     TEXT;
ALTER TABLE "Order" ADD COLUMN "refundedById"     TEXT;
