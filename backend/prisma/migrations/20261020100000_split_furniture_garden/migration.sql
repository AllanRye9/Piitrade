-- Furniture & Garden becomes two independent top-level categories: Furniture and Garden.
-- Listings keep their category id, so nothing is re-assigned — only the three outdoor
-- subcategories move to the new parent. Idempotent.

UPDATE "Category" SET "name" = 'Furniture' WHERE "slug" = 'furniture' AND "parentId" IS NULL;

INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, 'Garden', 'garden', '🌿', NULL
WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'garden');

UPDATE "Category"
SET "parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'garden')
WHERE "slug" IN ('garden-furniture', 'bbq-grills', 'plants-seeds')
  AND EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'garden');
