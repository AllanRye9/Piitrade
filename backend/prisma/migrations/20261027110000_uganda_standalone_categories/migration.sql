-- Uganda-demand STANDALONE top-level categories (own subcategories), kept in a
-- separate migration from the existing-parent additions so it can be rolled back
-- independently. Source of truth: backend/src/data/ugandaTaxonomy.ts
-- (UGANDA_STANDALONE_CATEGORIES). Idempotent (ON CONFLICT (slug) DO NOTHING).
-- food-groceries, industrial-business, pets-animals, education-training and events-entertainment
-- are also top-level categories of backend/src/utils/categoryTaxonomy.ts and use ITS names, so the
-- row is identical whichever of the two creates it first.
-- fine-jewellery and arts-collectibles use the exact slugs the existing
-- /fine-jewellery and /arts-collectibles pages already expect.

INSERT INTO "Category" ("id", "name", "slug", "icon")
VALUES
  (gen_random_uuid()::text, 'Food & Beverages', 'food-groceries', '🍲'),
  (gen_random_uuid()::text, 'Building, Construction & Hardware', 'building-construction', '🏗️'),
  (gen_random_uuid()::text, 'Business & Industrial', 'industrial-business', '🏭'),
  (gen_random_uuid()::text, 'Energy, Solar & Cooking Fuel', 'energy-power', '⚡'),
  (gen_random_uuid()::text, 'Pets & Animals', 'pets-animals', '🐕'),
  (gen_random_uuid()::text, 'Education & Books', 'education-training', '🎓'),
  (gen_random_uuid()::text, 'Events & Entertainment', 'events-entertainment', '🎉'),
  (gen_random_uuid()::text, 'Travel, Tours & Hospitality', 'travel-tourism', '✈️'),
  (gen_random_uuid()::text, 'Fine Jewellery', 'fine-jewellery', '💎'),
  (gen_random_uuid()::text, 'Arts & Collectibles', 'arts-collectibles', '🎨')
ON CONFLICT ("slug") DO NOTHING;

-- Food & Beverages
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Street Food, Snacks & Rolex', 'street-food-snacks', '🌯'),
  ('Flour, Sugar, Oil & Staples', 'staples-flour-oil', '🌾'),
  ('Tea, Coffee & Cocoa Products', 'tea-coffee-cocoa', '☕')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'food-groceries' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Building, Construction & Hardware
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Cement, Bricks & Blocks', 'cement-bricks-blocks', '🧱'),
  ('Iron Sheets & Roofing Materials', 'iron-sheets-roofing', '🏠'),
  ('Steel, Rebar & Metal Sections', 'steel-metal', '🔩'),
  ('Timber & Wood Products', 'timber-wood-products', '🪵'),
  ('Sand, Stones & Murram', 'sand-stones-murram', '⛰️'),
  ('Doors, Windows & Security Grills', 'doors-windows-grills', '🚪'),
  ('Fencing, Barbed Wire & Mesh', 'fencing-wire', '🧷'),
  ('Paint, Tiles & Finishing', 'paint-tiles-finishing', '🎨'),
  ('Plumbing & Sanitary Materials', 'plumbing-materials', '🚰'),
  ('Electrical Materials & Cables', 'electrical-materials', '💡'),
  ('Water Tanks & Pumps', 'water-tanks-pumps', '💧'),
  ('Hand & Power Tools', 'hand-power-tools', '🔨')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'building-construction' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Business & Industrial
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Workshop & Manufacturing Machinery', 'workshop-machinery', '⚙️'),
  ('Sewing & Knitting Machines', 'sewing-knitting-machines', '🧵'),
  ('Milling & Agro-Processing Machines', 'milling-agro-machines', '🌾'),
  ('Freezers & Cold Room Equipment', 'freezers-cold-rooms', '🧊'),
  ('Shop Fittings, Shelves & POS', 'shop-fittings-pos', '🧾'),
  ('Packaging & Printing Equipment', 'packaging-printing-equipment', '📦')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'industrial-business' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Energy, Solar & Cooking Fuel
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Solar Panels, Kits & Lighting', 'solar-panels-kits', '☀️'),
  ('Inverters, Batteries & Stabilizers', 'inverters-batteries', '🔋'),
  ('Gas Cylinders & Cookers', 'gas-cylinders-stoves', '🔥'),
  ('Charcoal, Briquettes & Firewood', 'charcoal-briquettes', '🪵'),
  ('Energy-Saving Stoves & Biogas', 'energy-saving-stoves', '♨️'),
  ('Solar & Power Installation Services', 'power-installation-services', '🔧')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'energy-power' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Pets & Animals
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Pet Vet, Grooming & Boarding', 'pet-services', '🩺')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'pets-animals' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Education & Books
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Nursery, Primary & Secondary Schools', 'schools-nursery-secondary', '🏫'),
  ('Colleges, Universities & Institutes', 'colleges-universities', '🏛️'),
  ('Vocational & Skills Training', 'vocational-skills', '🔧'),
  ('Driving Schools', 'driving-schools', '🚗')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'education-training' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Events & Entertainment
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Venues & Halls', 'event-venues-halls', '🏛️')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'events-entertainment' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Travel, Tours & Hospitality
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Tours, Safaris & Gorilla Trekking', 'tours-safaris', '🦍'),
  ('Hotels, Lodges & Guest Houses', 'hotels-lodges', '🏨'),
  ('Flights, Visas & Travel Agents', 'flights-visas-agents', '🛫'),
  ('Bus Travel & Cargo Services', 'bus-cargo-services', '🚌'),
  ('Adventure, Rafting & Camping', 'adventure-camping', '🏕️')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'travel-tourism' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Fine Jewellery
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Necklaces', 'necklaces', '📿'),
  ('Rings', 'rings', '💍'),
  ('Bracelets', 'bracelets', '✨'),
  ('Earrings', 'earrings', '💎'),
  ('Pendants', 'pendants', '🏅'),
  ('Brooches & Pins', 'brooches', '🌸'),
  ('Jewellery Sets', 'sets', '🎁'),
  ('Other Jewellery', 'other-jewellery', '🔮')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'fine-jewellery' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Arts & Collectibles
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Paintings & Prints', 'paintings', '🖼️'),
  ('Sculptures', 'sculptures', '🗿'),
  ('Photography Prints', 'photography', '📷'),
  ('Antiques', 'antiques', '🏺'),
  ('Coins & Stamps', 'coins-stamps', '🪙'),
  ('Vintage Items', 'vintage', '🕰️'),
  ('Tribal & Cultural Art', 'tribal-art', '🎭'),
  ('Crafts & Handmade (Baskets, Bark Cloth)', 'crafts-handmade', '🧺'),
  ('Other Collectibles', 'other-art', '🔮')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'arts-collectibles' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;
