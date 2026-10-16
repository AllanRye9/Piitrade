-- RUN THIS BEFORE `prisma migrate deploy` applies 20261016000000_classifieds_only.
--
-- That migration archives Order / Payment / Withdrawal / Coupon etc. into _archive_* tables,
-- but it DROPS "User"."balance" (seller funds held by the platform) WITHOUT archiving it.
-- This keeps a record of every non-zero balance so you can reconcile/pay out afterwards.
-- Safe to run more than once; does nothing if the column is already gone.
--
--   psql "$DATABASE_URL" -f prisma/pre-migration/archive-user-balances.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'balance') THEN
    CREATE TABLE IF NOT EXISTS "_archive_UserBalance" AS
      SELECT "id", "email", "name", "balance", now() AS "archivedAt"
      FROM "User" WHERE "balance" IS NOT NULL AND "balance" <> 0;
  END IF;
END $$;
