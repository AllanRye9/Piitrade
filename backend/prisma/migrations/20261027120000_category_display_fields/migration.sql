-- Phase 2 of the Uganda category expansion: display/structure fields on Category.
-- Additive and idempotent. Defaults (sortOrder 0, isActive true) keep today's behaviour: the
-- API still returns categories alphabetically until an admin reorders them.
-- Backfills shortName (<= 24 chars, for tiles/chips/menus) and menuGroup (headings on category
-- pages) for the categories added by 20261023100000 / 20261023110000 and for the big parents.

ALTER TABLE "Category"
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shortName" TEXT,
  ADD COLUMN IF NOT EXISTS "menuGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");

-- shortName (only where an admin has not already set one)
UPDATE "Category" c SET "shortName" = v.short
FROM (VALUES
  ('boda-boda-bikes', 'Boda Boda Bikes'),
  ('tuk-tuk-three-wheelers', 'Tuk-Tuks'),
  ('market-stalls-kiosks', 'Stalls & Kiosks'),
  ('baby-gear', 'Baby Gear'),
  ('workwear-safety', 'Workwear & Boots'),
  ('bags-luggage', 'Bags & Luggage'),
  ('storage-wardrobes', 'Wardrobes & Storage'),
  ('carpentry-made-to-order', 'Local Carpentry'),
  ('flowers-landscaping', 'Flowers & Landscaping'),
  ('pots-nurseries', 'Pots & Nurseries'),
  ('tailoring-fashion-design', 'Tailoring'),
  ('appliance-repair', 'Appliance Repair'),
  ('welding-metalwork', 'Welding & Metalwork'),
  ('roofing-ceilings', 'Roofing & Ceilings'),
  ('pest-control', 'Pest Control'),
  ('satellite-cctv-installation', 'DStv & CCTV Install'),
  ('borehole-water-services', 'Boreholes & Water'),
  ('waste-sanitation-services', 'Waste & Sanitation'),
  ('typing-translation', 'Typing & Translation'),
  ('funeral-services', 'Funeral Services'),
  ('matooke-staples', 'Matooke & Staples'),
  ('agro-processing-services', 'Milling & Processing'),
  ('nails-lashes', 'Nails & Lashes'),
  ('soap-oils-local', 'Soaps & Oils'),
  ('herbal-natural', 'Herbal Products'),
  ('optical-dental-care', 'Optical & Dental'),
  ('building-construction', 'Building & Hardware'),
  ('industrial-business', 'Business & Machinery'),
  ('energy-power', 'Energy & Solar'),
  ('events-entertainment', 'Events & Weddings'),
  ('travel-tourism', 'Travel & Tours'),
  ('street-food-snacks', 'Street Food & Snacks'),
  ('staples-flour-oil', 'Flour, Oil & Staples'),
  ('tea-coffee-cocoa', 'Tea & Coffee'),
  ('iron-sheets-roofing', 'Iron Sheets & Roofing'),
  ('steel-metal', 'Steel & Metal'),
  ('doors-windows-grills', 'Doors & Windows'),
  ('fencing-wire', 'Fencing & Wire'),
  ('plumbing-materials', 'Plumbing Materials'),
  ('electrical-materials', 'Electrical Materials'),
  ('workshop-machinery', 'Workshop Machinery'),
  ('sewing-knitting-machines', 'Sewing Machines'),
  ('milling-agro-machines', 'Milling Machines'),
  ('freezers-cold-rooms', 'Freezers & Cold Rooms'),
  ('shop-fittings-pos', 'Shop Fittings & POS'),
  ('packaging-printing-equipment', 'Packaging Equipment'),
  ('solar-panels-kits', 'Solar Panels & Kits'),
  ('inverters-batteries', 'Inverters & Batteries'),
  ('charcoal-briquettes', 'Charcoal & Firewood'),
  ('energy-saving-stoves', 'Efficient Stoves'),
  ('power-installation-services', 'Solar Installation'),
  ('pet-services', 'Pet Care Services'),
  ('schools-nursery-secondary', 'Schools'),
  ('colleges-universities', 'Colleges'),
  ('vocational-skills', 'Vocational Training'),
  ('tours-safaris', 'Tours & Safaris'),
  ('hotels-lodges', 'Hotels & Lodges'),
  ('flights-visas-agents', 'Flights & Visas'),
  ('bus-cargo-services', 'Bus & Cargo'),
  ('adventure-camping', 'Adventure & Camping')
) AS v(slug, short)
WHERE c."slug" = v.slug AND c."shortName" IS NULL;

-- menuGroup: services
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('phone-computer-repair', 'Repair & Maintenance'),
  ('appliance-repair', 'Repair & Maintenance'),
  ('shoe-repair', 'Repair & Maintenance'),
  ('car-wash-detailing', 'Repair & Maintenance'),
  ('welding-metalwork', 'Building & Trades'),
  ('carpentry-joinery', 'Building & Trades'),
  ('roofing-ceilings', 'Building & Trades'),
  ('painting-decorating', 'Building & Trades'),
  ('plumbing-electrical', 'Building & Trades'),
  ('borehole-water-services', 'Building & Trades'),
  ('satellite-cctv-installation', 'Building & Trades'),
  ('tailoring-fashion-design', 'Beauty & Personal'),
  ('laundry-dry-cleaning', 'Beauty & Personal'),
  ('movers-storage', 'Transport & Moving'),
  ('typing-translation', 'Professional & Office'),
  ('design-creative', 'Professional & Office'),
  ('it-tech-support', 'Professional & Office'),
  ('tutoring', 'Professional & Office'),
  ('cleaning', 'Home & Safety'),
  ('pest-control', 'Home & Safety'),
  ('waste-sanitation-services', 'Home & Safety'),
  ('funeral-services', 'Home & Safety')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'services' AND "parentId" IS NULL);

-- menuGroup: jobs
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('casual-labour', 'Everyday work'),
  ('security-jobs', 'Everyday work'),
  ('agriculture-jobs', 'Everyday work'),
  ('technology', 'Professional'),
  ('healthcare', 'Professional'),
  ('finance', 'Professional'),
  ('engineering-jobs', 'Professional'),
  ('full-time', 'Job type'),
  ('part-time', 'Job type'),
  ('freelance', 'Job type'),
  ('remote-jobs', 'Job type')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'jobs' AND "parentId" IS NULL);

-- menuGroup: fashion
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('women-clothing', 'Clothing'),
  ('men-clothing', 'Clothing'),
  ('girls-clothing', 'Clothing'),
  ('boys-clothing', 'Clothing'),
  ('baby-clothing', 'Clothing'),
  ('underwear-sleepwear', 'Clothing'),
  ('sportswear-jerseys', 'Clothing'),
  ('workwear-safety', 'Clothing'),
  ('fabrics-textiles', 'Clothing'),
  ('women-shoes', 'Shoes & Bags'),
  ('men-shoes', 'Shoes & Bags'),
  ('women-bags', 'Shoes & Bags'),
  ('bags-luggage', 'Shoes & Bags'),
  ('watches', 'Shoes & Bags'),
  ('eyewear', 'Shoes & Bags'),
  ('mitumba', 'Second-hand'),
  ('mitumba-shoes', 'Second-hand')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'fashion' AND "parentId" IS NULL);

-- menuGroup: electronics
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('smartphones', 'Phones & Tablets'),
  ('tablets', 'Phones & Tablets'),
  ('power-banks-ups', 'Phones & Tablets'),
  ('laptops', 'Computers'),
  ('desktops', 'Computers'),
  ('headphones', 'Audio, Video & Gaming'),
  ('cameras', 'Audio, Video & Gaming'),
  ('consoles', 'Audio, Video & Gaming'),
  ('games-accessories', 'Audio, Video & Gaming')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'electronics' AND "parentId" IS NULL);

-- menuGroup: agriculture
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('crops-grains', 'Crops & Produce'),
  ('fruits-vegetables', 'Crops & Produce'),
  ('matooke-staples', 'Crops & Produce'),
  ('flowers-horticulture', 'Crops & Produce'),
  ('seeds-inputs', 'Crops & Produce'),
  ('livestock', 'Livestock & Fish'),
  ('poultry-eggs', 'Livestock & Fish'),
  ('dairy-products', 'Livestock & Fish'),
  ('farm-equipment', 'Farm Inputs & Services'),
  ('farm-services', 'Farm Inputs & Services'),
  ('agro-processing-services', 'Farm Inputs & Services')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'agriculture' AND "parentId" IS NULL);

-- menuGroup: motors
UPDATE "Category" c SET "menuGroup" = v.grp
FROM (VALUES
  ('used-cars', 'Cars & Vans'),
  ('new-cars', 'Cars & Vans'),
  ('classic-cars', 'Cars & Vans'),
  ('vans-minibuses', 'Cars & Vans'),
  ('trucks-buses', 'Cars & Vans'),
  ('motorcycles', 'Bikes & Three-wheelers'),
  ('boda-boda-bikes', 'Bikes & Three-wheelers'),
  ('tuk-tuk-three-wheelers', 'Bikes & Three-wheelers'),
  ('car-parts', 'Parts & Services'),
  ('tyres-wheels', 'Parts & Services'),
  ('car-accessories', 'Parts & Services'),
  ('boats', 'Other vehicles')
) AS v(slug, grp)
WHERE c."slug" = v.slug AND c."menuGroup" IS NULL
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'motors' AND "parentId" IS NULL);
