-- AlterTable: add personalId column, backfill with generated IDs, then add unique constraint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "personalId" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows: generate a unique ID like '3RE-' + 8 uppercase hex chars from the UUID
UPDATE "User"
SET "personalId" = '3RE-' || UPPER(REPLACE(SUBSTRING("id"::text, 1, 8), '-', ''))
WHERE "personalId" = '';

-- Add unique constraint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'User_personalId_key'
	) THEN
		ALTER TABLE "User" ADD CONSTRAINT "User_personalId_key" UNIQUE ("personalId");
	END IF;
END $$;
