-- Removes Health & Beauty only if no listings use it or its subcategories.
DELETE FROM "Category" c
WHERE c."slug" IN ('skincare','makeup','hair-care','fragrances','personal-care','health-wellness')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'health-beauty')
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");
DELETE FROM "Category" c
WHERE c."slug" = 'health-beauty'
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");
