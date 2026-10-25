-- Remove the agriculture bulk-order columns that are no longer declared in schema.prisma
-- (added by 20261013110000_agriculture_order_quantities). Nothing in the backend or frontend reads them.
--
-- IF EXISTS makes this safe to re-run and safe on databases where the columns are already gone.
--
-- The `_archive_*` tables (order, payment, withdrawal and coupon history copied aside by
-- 20261016000000_classifieds_only) are deliberately NOT dropped here. They are intentionally absent from
-- schema.prisma so Prisma will not manage them, and scripts/db-setup.ts ignores them when verifying the
-- schema ("ignoring preserved _archive_* tables"). `prisma migrate dev` proposes dropping them every time
-- because it cannot see them in the schema; that suggestion must never be committed, as it permanently
-- deletes the platform's financial record. If they are ever retired on purpose, do it in a separate,
-- reviewed migration after exporting them (e.g. `pg_dump -t '_archive_*'`).

-- AlterTable
ALTER TABLE "Listing"
  DROP COLUMN IF EXISTS "minOrderQuantity",
  DROP COLUMN IF EXISTS "priceTiers";
