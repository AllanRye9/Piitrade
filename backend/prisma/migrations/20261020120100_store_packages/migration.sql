ALTER TABLE "SellerPackage" ADD COLUMN "storeTier" "ListingTier";

ALTER TABLE "StoreRental"
  ADD COLUMN "packageId"    TEXT,
  ADD COLUMN "packageName"  TEXT,
  ADD COLUMN "durationDays" INTEGER;

-- One-off seed so existing deployments keep offering the plans they offered before. From now on
-- these are ordinary packages: edit, add, deactivate or delete them in Admin → Packages (scope
-- "Webstore"). Gold/Platinum monthly prices are taken from the fees the admin had already set in
-- Site Config (falling back to the old built-in figures only here, once). Annual = 5 x monthly,
-- exactly what the old code charged. Nothing is inserted if Webstore packages already exist.
WITH cfg AS (
  SELECT
    COALESCE((SELECT ("tierPricing"->>'storeFreeFee')::float     FROM "SiteConfig" WHERE "id" = 'global'), 60000)  AS free_fee,
    COALESCE((SELECT ("tierPricing"->>'storeGoldFee')::float     FROM "SiteConfig" WHERE "id" = 'global'), 150000) AS gold_fee,
    COALESCE((SELECT ("tierPricing"->>'storePlatinumFee')::float FROM "SiteConfig" WHERE "id" = 'global'), 400000) AS plat_fee
), plans(name, price, days, tier, free) AS (
  SELECT 'Webstore Free Trial', 0::float, 3, 'FREE', true
  UNION ALL SELECT 'Webstore Monthly',          free_fee,     30,  'FREE',     false FROM cfg
  UNION ALL SELECT 'Webstore Annual',           free_fee * 5, 365, 'FREE',     false FROM cfg
  UNION ALL SELECT 'Webstore Gold Monthly',     gold_fee,     30,  'GOLD',     false FROM cfg
  UNION ALL SELECT 'Webstore Gold Annual',      gold_fee * 5, 365, 'GOLD',     false FROM cfg
  UNION ALL SELECT 'Webstore Platinum Monthly', plat_fee,     30,  'PLATINUM', false FROM cfg
  UNION ALL SELECT 'Webstore Platinum Annual',  plat_fee * 5, 365, 'PLATINUM', false FROM cfg
)
INSERT INTO "SellerPackage" ("id","name","description","scope","isFree","price","currency","durationDays","maxListings","isActive","storeTier","createdAt","updatedAt")
SELECT gen_random_uuid()::text, name, NULL, 'STORE', free, price, 'UGX', days, 100, true, tier::"ListingTier", NOW(), NOW()
FROM plans
WHERE NOT EXISTS (SELECT 1 FROM "SellerPackage" WHERE "scope" = 'STORE');

-- Existing rentals: record the length they were bought for.
UPDATE "StoreRental"
SET "durationDays" = GREATEST(1, ROUND(EXTRACT(EPOCH FROM ("endDate" - "startDate")) / 86400)::int)
WHERE "durationDays" IS NULL;

-- Link existing paid rentals to the seeded package with the same tier and length, so one-click
-- renewal keeps working for them. (Trials stay unlinked: a free package is not renewable.)
UPDATE "StoreRental" r
SET "packageId" = p."id", "packageName" = p."name"
FROM "SellerPackage" p
WHERE r."packageId" IS NULL
  AND p."scope" = 'STORE'
  AND p."storeTier" = r."tier"
  AND p."durationDays" = CASE WHEN r."placements"->>'subscriptionPlan' = 'ANNUAL' THEN 365 ELSE 30 END
  AND r."placements"->>'subscriptionPlan' IN ('MONTHLY', 'ANNUAL');
