-- Paying for a package upgrade (AFTER_EXPIRY / IMMEDIATE) through MTN MoMo.
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_UPGRADE';
