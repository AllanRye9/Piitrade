-- Primary / secondary administrators.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The first (earliest-created) existing admin becomes the primary admin, unless one is already set.
UPDATE "User" SET "isPrimaryAdmin" = true
WHERE "id" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isPrimaryAdmin" = true);

-- Existing other admins keep the access they have today; the primary admin can now restrict it.
UPDATE "User" SET "adminPermissions" = ARRAY['analytics','listings','content','users','payments','stores','support','settings']
WHERE "role" = 'ADMIN' AND "isPrimaryAdmin" = false AND cardinality("adminPermissions") = 0;

-- At most one primary admin, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS "User_single_primary_admin" ON "User" ("isPrimaryAdmin") WHERE "isPrimaryAdmin" = true;
