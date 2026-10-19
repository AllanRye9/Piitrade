-- Saved searches with new-listing alerts. Extends the existing (previously unused) "SavedSearch" table.
-- Additive: two new columns with defaults, two indexes, and cascade-on-delete so removing a user
-- removes their saved searches instead of failing on the foreign key.
ALTER TABLE "SavedSearch"
  ADD COLUMN IF NOT EXISTS "name"          TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "SavedSearch_userId_createdAt_idx"        ON "SavedSearch"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SavedSearch_emailAlert_lastCheckedAt_idx" ON "SavedSearch"("emailAlert", "lastCheckedAt");

ALTER TABLE "SavedSearch" DROP CONSTRAINT IF EXISTS "SavedSearch_userId_fkey";
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
