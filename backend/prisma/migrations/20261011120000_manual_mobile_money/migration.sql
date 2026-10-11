-- Manual MTN mobile-money payments (no API). See backend/src/utils/paymentProof.ts.
--
--   Payment.dueAt     end of the buyer's payment window (admin-configurable
--                     minutes); NULL for non-mobile-money payments.
--   PaymentProof      a buyer's claim "I paid, here is the MTN transaction ID".
--                     Only an admin confirming it marks the Payment paid.
--
-- Additive: one nullable column and one new table.
ALTER TABLE "Payment" ADD COLUMN "dueAt" TIMESTAMP(3);

CREATE TABLE "PaymentProof" (
    "id"             TEXT NOT NULL,
    "paymentId"      TEXT NOT NULL,
    "orderId"        TEXT NOT NULL,
    "transactionId"  TEXT NOT NULL,
    "senderPhone"    TEXT NOT NULL,
    "amountClaimed"  DOUBLE PRECISION NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'SUBMITTED',
    "amountReceived" DOUBLE PRECISION,
    "reviewedById"   TEXT,
    "reviewedAt"     TIMESTAMP(3),
    "reviewNote"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentProof_status_createdAt_idx" ON "PaymentProof"("status", "createdAt");
CREATE INDEX "PaymentProof_orderId_idx" ON "PaymentProof"("orderId");

-- One MTN transaction can pay for ONE order. Rejected proofs are excluded so a
-- buyer can correct a typo and resubmit the same ID. This is what stops two
-- simultaneous submissions of one transaction ID; the application maps the
-- violation (SQLSTATE 23505 / Prisma P2002) to a friendly 409.
-- Not expressible in schema.prisma, so `prisma migrate dev` may report drift;
-- `migrate deploy` is unaffected.
CREATE UNIQUE INDEX "PaymentProof_transactionId_active_key"
  ON "PaymentProof"("transactionId") WHERE "status" <> 'REJECTED';

ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── In-flight orders at deploy time ─────────────────────────────────────────
-- Before this release a mobile-money order's payment stayed PENDING until the
-- order was DELIVERED; staff moved orders forward by hand once they had seen the
-- money. The new rule "an unconfirmed mobile-money order cannot advance" would
-- otherwise freeze every such order (it is already past PENDING, so there is no
-- proof to submit). Treat orders that staff already progressed as paid, and say
-- so in the audit data. ASSUMPTION: staff only progressed orders they had been
-- paid for — review the rows this touches (they carry channel LEGACY_BACKFILL).
-- Orders still PENDING are left alone: their buyers can submit proof (no
-- deadline is applied to them because dueAt stays NULL).
UPDATE "Payment" p
SET "status"      = 'COMPLETED',
    "paidAt"      = COALESCE(p."paidAt", o."updatedAt"),
    "gatewayData" = jsonb_build_object(
                      'channel', 'LEGACY_BACKFILL',
                      'note',    'Order was progressed before manual payment confirmation existed')
FROM "Order" o
WHERE p."orderId" = o."id"
  AND p."method" = 'MOBILE_MONEY'
  AND p."status" = 'PENDING'
  AND o."status" IN ('CONFIRMED', 'PROCESSING', 'SHIPPED');
