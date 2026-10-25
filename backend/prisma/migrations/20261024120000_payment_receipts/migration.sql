-- Digital receipts for mobile-money payments: a unique tracking code per receipt plus email delivery
-- bookkeeping. The PDF itself is generated on demand from the payment row.
ALTER TABLE "PaymentTransaction"
  ADD COLUMN "receiptNumber" TEXT,
  ADD COLUMN "receiptIssuedAt" TIMESTAMP(3),
  ADD COLUMN "receiptEmailedAt" TIMESTAMP(3),
  ADD COLUMN "receiptEmailAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "PaymentTransaction_receiptNumber_key" ON "PaymentTransaction"("receiptNumber");
