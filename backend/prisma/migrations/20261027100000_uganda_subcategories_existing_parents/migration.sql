-- Uganda-demand subcategories for EXISTING parent categories (informal-sector focus).
-- Source of truth: backend/src/data/ugandaTaxonomy.ts (UGANDA_SUBCATEGORY_ADDITIONS).
-- Entries that backend/src/utils/categoryTaxonomy.ts already defines (same slug, or the same idea
-- under another slug) are NOT repeated here, so every environment ends with one row per idea.
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Parents are never created here; a
-- parent that does not exist simply yields zero rows (JOIN), so this is safe to
-- run on any database state.

-- motors
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Boda Boda & Delivery Bikes', 'boda-boda-bikes', '🏍️'),
  ('Tuk-Tuks & Three-Wheelers', 'tuk-tuk-three-wheelers', '🛺'),
  ('Vans & Minibuses (Taxis)', 'vans-minibuses', '🚐')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'motors' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- property
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Farms & Estates', 'farms-estates', '🌾'),
  ('Market Stalls, Kiosks & Arcade Shops', 'market-stalls-kiosks', '🏪')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'property' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- jobs
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Casual & Daily Labour', 'casual-labour', '🧱'),
  ('Security & Guards', 'security-jobs', '🛡️'),
  ('Farm & Agribusiness Jobs', 'agriculture-jobs', '🌱'),
  ('Engineering & Technical', 'engineering-jobs', '⚙️'),
  ('Remote & Online Work', 'remote-jobs', '🌐')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'jobs' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- classifieds
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Used Household Items', 'second-hand-household', '♻️'),
  ('Businesses for Sale (Shops, Salons, Kiosks)', 'business-for-sale', '💼'),
  ('Toys & Games', 'toys-games', '🧸'),
  ('Strollers, Cots & Baby Gear', 'baby-gear', '🍼')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'classifieds' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- electronics
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Power Banks & UPS', 'power-banks-ups', '🔋')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'electronics' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- fashion
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Second-Hand Clothes (Mivumba)', 'mitumba', '♻️'),
  ('Second-Hand Shoes', 'mitumba-shoes', '👟'),
  ('Baby & Toddler Clothing', 'baby-clothing', '👶'),
  ('Sportswear & Jerseys', 'sportswear-jerseys', '🎽'),
  ('Underwear & Sleepwear', 'underwear-sleepwear', '🩲'),
  ('Fabrics & Textiles', 'fabrics-textiles', '🧶'),
  ('Workwear, Overalls & Safety Boots', 'workwear-safety', '🥾'),
  ('Sunglasses & Eyewear', 'eyewear', '🕶️'),
  ('Bags, Backpacks & Luggage', 'bags-luggage', '🎒')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'fashion' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- furniture
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Wardrobes, Shelves & Storage', 'storage-wardrobes', '🗄️'),
  ('Made-to-Order & Local Carpentry', 'carpentry-made-to-order', '🪚'),
  ('Second-Hand Furniture', 'second-hand-furniture', '♻️')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'furniture' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- garden
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Flowers, Hedges & Landscaping', 'flowers-landscaping', '🌸'),
  ('Pots, Planters & Nurseries', 'pots-nurseries', '🪴')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'garden' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- services
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Tailoring & Fashion Design', 'tailoring-fashion-design', '🧵'),
  ('Car Wash & Detailing', 'car-wash-detailing', '🚿'),
  ('Phone & Computer Repair', 'phone-computer-repair', '📱'),
  ('Appliance & Electronics Repair', 'appliance-repair', '🔧'),
  ('Welding & Metal Fabrication', 'welding-metalwork', '🔥'),
  ('Carpentry & Joinery', 'carpentry-joinery', '🪚'),
  ('Roofing, Ceilings & Gypsum', 'roofing-ceilings', '🏠'),
  ('Painting & Decorating', 'painting-decorating', '🎨'),
  ('Laundry & Dry Cleaning', 'laundry-dry-cleaning', '🧺'),
  ('Pest Control & Fumigation', 'pest-control', '🪳'),
  ('Shoe Repair & Cobblers', 'shoe-repair', '👞'),
  ('DStv, Satellite & CCTV Installation', 'satellite-cctv-installation', '📡'),
  ('Borehole Drilling & Water Services', 'borehole-water-services', '💧'),
  ('Garbage & Sewage Services', 'waste-sanitation-services', '♻️'),
  ('Typing, Secretarial & Translation', 'typing-translation', '⌨️'),
  ('Funeral & Memorial Services', 'funeral-services', '⚱️')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'services' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- agriculture
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Matooke, Cassava & Staple Foods', 'matooke-staples', '🍌'),
  ('Flowers & Horticulture', 'flowers-horticulture', '🌷'),
  ('Farm Services (Ploughing, Spraying, Harvesting)', 'farm-services', '🚜'),
  ('Milling & Agro-Processing Services', 'agro-processing-services', '⚙️')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'agriculture' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- health-beauty
INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Nails, Lashes & Beauty Tools', 'nails-lashes', '💅'),
  ('Soap, Oils & Local Cosmetics', 'soap-oils-local', '🧼'),
  ('Herbal & Natural Products', 'herbal-natural', '🌿'),
  ('Glasses, Dental & Eye Care', 'optical-dental-care', '👓')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'health-beauty' AND p."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;
