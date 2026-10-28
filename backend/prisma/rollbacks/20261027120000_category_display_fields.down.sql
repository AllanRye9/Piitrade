-- Rolls back 20261027120000_category_display_fields. Drops the display fields (their values are lost).
DROP INDEX IF EXISTS "Category_parentId_sortOrder_idx";
ALTER TABLE "Category" DROP COLUMN IF EXISTS "sortOrder", DROP COLUMN IF EXISTS "shortName", DROP COLUMN IF EXISTS "menuGroup", DROP COLUMN IF EXISTS "isActive";
