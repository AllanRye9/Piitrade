-- Rolls back 20261027100000_uganda_subcategories_existing_parents.
-- Only deletes rows no listing uses, so live data is never orphaned.

DELETE FROM "Category" c
WHERE c."slug" IN ('boda-boda-bikes', 'tuk-tuk-three-wheelers', 'vans-minibuses')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'motors' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('farms-estates', 'market-stalls-kiosks')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'property' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('casual-labour', 'security-jobs', 'agriculture-jobs', 'engineering-jobs', 'remote-jobs')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'jobs' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('second-hand-household', 'business-for-sale', 'toys-games', 'baby-gear')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'classifieds' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('power-banks-ups')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'electronics' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('mitumba', 'mitumba-shoes', 'baby-clothing', 'sportswear-jerseys', 'underwear-sleepwear', 'fabrics-textiles', 'workwear-safety', 'eyewear', 'bags-luggage')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'fashion' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('storage-wardrobes', 'carpentry-made-to-order', 'second-hand-furniture')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'furniture' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('flowers-landscaping', 'pots-nurseries')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'garden' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('tailoring-fashion-design', 'car-wash-detailing', 'phone-computer-repair', 'appliance-repair', 'welding-metalwork', 'carpentry-joinery', 'roofing-ceilings', 'painting-decorating', 'laundry-dry-cleaning', 'pest-control', 'shoe-repair', 'satellite-cctv-installation', 'borehole-water-services', 'waste-sanitation-services', 'typing-translation', 'funeral-services')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'services' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('matooke-staples', 'flowers-horticulture', 'farm-services', 'agro-processing-services')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'agriculture' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");

DELETE FROM "Category" c
WHERE c."slug" IN ('nails-lashes', 'soap-oils-local', 'herbal-natural', 'optical-dental-care')
  AND c."parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'health-beauty' AND "parentId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."categoryId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "Category" k WHERE k."parentId" = c."id");
