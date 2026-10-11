-- OPTIONAL search acceleration, safe whether or not the database allows
-- extensions. Listing search today is  title/description ILIKE '%term%'
-- (routes/listings.ts), which cannot use an ordinary index and scans the whole
-- table. PostgreSQL's pg_trgm extension adds trigram GIN indexes that DO serve
-- ILIKE '%term%' — so this speeds up the existing query with NO code change.
--
-- Guarded: if the extension cannot be created (managed host without it,
-- insufficient privilege), this migration still SUCCEEDS, creates nothing, and
-- prints a NOTICE. Search then keeps working exactly as before. Re-running the
-- migration's statements later (after the extension is enabled) adds the indexes.
--
-- Plain CREATE INDEX (not CONCURRENTLY, which cannot run inside a migration):
-- it blocks writes to "Listing" while building. Run during low traffic.
--
-- Note: these indexes are not described in schema.prisma, so `prisma migrate
-- dev` (development only) may report drift; `migrate deploy` is unaffected.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm is not available (%). Skipping trigram indexes; listing search keeps using the existing ILIKE path.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "Listing_title_trgm_idx"       ON "Listing" USING gin ("title" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Listing_description_trgm_idx" ON "Listing" USING gin ("description" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Listing_location_trgm_idx"    ON "Listing" USING gin ("location" gin_trgm_ops);
  END IF;
END $$;
