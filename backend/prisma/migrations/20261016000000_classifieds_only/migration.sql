-- Classifieds-only: remove every e-commerce table, column and enum value.
-- Idempotent where practical. Money/order history is copied into _archive_*
-- tables first so nothing is lost; drop those later once you have exported
-- them (e.g. `pg_dump -t '_archive_*'`).

DO $$ BEGIN
  IF to_regclass('"Order"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_Order"        AS TABLE "Order";
  END IF;
  IF to_regclass('"OrderItem"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_OrderItem"    AS TABLE "OrderItem";
  END IF;
  IF to_regclass('"Payment"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_Payment"      AS TABLE "Payment";
  END IF;
  IF to_regclass('"PaymentProof"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_PaymentProof" AS TABLE "PaymentProof";
  END IF;
  IF to_regclass('"Return"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_Return"       AS TABLE "Return";
  END IF;
  IF to_regclass('"Withdrawal"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_Withdrawal"   AS TABLE "Withdrawal";
  END IF;
  IF to_regclass('"Coupon"') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS "_archive_Coupon"       AS TABLE "Coupon";
  END IF;
END $$;

-- Archive columns must not depend on the enum types we are about to drop.
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name LIKE '\_archive\_%'
      AND udt_name IN ('OrderStatus','PaymentStatus','PaymentMethod','CouponType','ReturnStatus','WithdrawalStatus','AddressType')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE text USING %I::text', r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;

-- Commerce tables (children first; CASCADE clears the foreign keys).
DROP TABLE IF EXISTS "PaymentProof" CASCADE;
DROP TABLE IF EXISTS "Payment"      CASCADE;
DROP TABLE IF EXISTS "Return"       CASCADE;
DROP TABLE IF EXISTS "OrderItem"    CASCADE;
DROP TABLE IF EXISTS "Order"        CASCADE;
DROP TABLE IF EXISTS "CartItem"     CASCADE;
DROP TABLE IF EXISTS "Coupon"       CASCADE;
DROP TABLE IF EXISTS "Withdrawal"   CASCADE;
DROP TABLE IF EXISTS "ShippingRate" CASCADE;
DROP TABLE IF EXISTS "Address"      CASCADE;

DROP TYPE IF EXISTS "OrderStatus";
DROP TYPE IF EXISTS "PaymentStatus";
DROP TYPE IF EXISTS "PaymentMethod";
DROP TYPE IF EXISTS "CouponType";
DROP TYPE IF EXISTS "ReturnStatus";
DROP TYPE IF EXISTS "WithdrawalStatus";
DROP TYPE IF EXISTS "AddressType";

-- Listing: stock -> optional quantity (keep multi-unit counts above 1), drop shipping fields.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Listing' AND column_name = 'stock') THEN
    UPDATE "Listing" SET "quantity" = "stock" WHERE "stock" > 1;
  END IF;
END $$;
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "stock";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "sku";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "weightKg";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "lengthCm";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "widthCm";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "heightCm";

ALTER TABLE "User"          DROP COLUMN IF EXISTS "balance";
ALTER TABLE "ProductReview" DROP COLUMN IF EXISTS "verifiedPurchase";
ALTER TABLE "SiteConfig"    DROP COLUMN IF EXISTS "paymentSettings";
ALTER TABLE "SiteConfig"    DROP COLUMN IF EXISTS "marketplaceMode";

-- NotificationType: drop the order / payment / return / withdrawal values.
DELETE FROM "Notification" WHERE "type"::text IN (
  'ORDER_PLACED','ORDER_CONFIRMED','ORDER_SHIPPED','ORDER_DELIVERED','ORDER_CANCELLED',
  'PAYMENT_RECEIVED','PAYMENT_FAILED','RETURN_REQUESTED','RETURN_APPROVED','RETURN_REJECTED',
  'WITHDRAWAL_APPROVED','WITHDRAWAL_REJECTED');
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'LISTING_APPROVED','LISTING_REJECTED','IMAGE_APPROVED','IMAGE_REJECTED','REVIEW_POSTED',
  'MESSAGE_RECEIVED','SUBSCRIPTION_ACTIVATED','SUBSCRIPTION_EXPIRED','SUBSCRIPTION_PENDING',
  'LISTING_EXPIRED','KYC_APPROVED','KYC_REJECTED','SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";
