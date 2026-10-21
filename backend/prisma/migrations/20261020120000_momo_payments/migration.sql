-- MTN MoMo (collection-only) payment ledger. Purely additive: two enums, one table, indexes.
-- Nothing existing is altered. userId/targetId are deliberately plain strings (no foreign keys)
-- so deleting an account or the record a payment unlocked never deletes the financial record.

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SUBSCRIPTION', 'SUBSCRIPTION_RENEWAL', 'STORE_RENTAL', 'STORE_RENEWAL', 'LISTING_TIER', 'CV_DOWNLOAD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MTN_MOMO',
    "environment" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'UGX',
    "providerAmount" DECIMAL(18,2) NOT NULL,
    "providerCurrency" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerStatus" TEXT,
    "failureReason" TEXT,
    "financialTransactionId" TEXT,
    "provisionedAt" TIMESTAMP(3),
    "provisioningStartedAt" TIMESTAMP(3),
    "provisionNote" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_referenceId_key" ON "PaymentTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_lastCheckedAt_idx" ON "PaymentTransaction"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_userId_createdAt_idx" ON "PaymentTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PaymentTransaction_purpose_targetId_idx" ON "PaymentTransaction"("purpose", "targetId");

-- At most ONE in-flight (PENDING) attempt per target: a double-tap resumes the same USSD prompt
-- instead of pushing a second one to the payer's phone. Partial index (not expressible in
-- schema.prisma, like the trigram indexes in 20261011110000_search_trigram_indexes).
CREATE UNIQUE INDEX "PaymentTransaction_one_pending_per_target_key"
  ON "PaymentTransaction"("purpose", "targetId") WHERE "status" = 'PENDING';

-- A payment is never "provisioned" unless it succeeded.
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_provisioned_only_if_paid_chk"
  CHECK ("provisionedAt" IS NULL OR "status" = 'SUCCESSFUL');
