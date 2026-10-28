-- Rolls back 20261027110000_uganda_standalone_categories.
-- Only deletes rows no listing uses; a parent with live listings/children is kept.
-- The five top-level categories shared with categoryTaxonomy.ts are never deleted here.

DELETE FROM "Category" c
WHERE c."slug" IN ('street-food-snacks', 'staples-flour-oil', 'tea-coffee-cocoa')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'food-groceries' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('cement-bricks-blocks', 'iron-sheets-roofing', 'steel-metal', 'timber-wood-products', 'sand-stones-murram', 'doors-windows-grills', 'fencing-wire', 'paint-tiles-finishing', 'plumbing-materials', 'electrical-materials', 'water-tanks-pumps', 'hand-power-tools')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'building-construction' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('workshop-machinery', 'sewing-knitting-machines', 'milling-agro-machines', 'freezers-cold-rooms', 'shop-fittings-pos', 'packaging-printing-equipment')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'industrial-business' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('solar-panels-kits', 'inverters-batteries', 'gas-cylinders-stoves', 'charcoal-briquettes', 'energy-saving-stoves', 'power-installation-services')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'energy-power' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('pet-services')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'pets-animals' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('schools-nursery-secondary', 'colleges-universities', 'vocational-skills', 'driving-schools')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'education-training' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('event-venues-halls')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'events-entertainment' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('tours-safaris', 'hotels-lodges', 'flights-visas-agents', 'bus-cargo-services', 'adventure-camping')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'travel-tourism' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('necklaces', 'rings', 'bracelets', 'earrings', 'pendants', 'brooches', 'sets', 'other-jewellery')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'fine-jewellery' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('paintings', 'sculptures', 'photography', 'antiques', 'coins-stamps', 'vintage', 'tribal-art', 'crafts-handmade', 'other-art')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'arts-collectibles' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('building-construction', 'energy-power', 'travel-tourism', 'fine-jewellery', 'arts-collectibles')
  AND c."parentId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");
