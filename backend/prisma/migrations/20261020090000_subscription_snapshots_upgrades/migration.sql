-- Subscription package snapshots + upgrade bookkeeping + admin decision trail.
-- Additive only. Existing rows are backfilled from their package so they keep the terms they
-- have today; from now on edits to a package affect NEW requests only.

ALTER TABLE "SellerSubscription"
  ADD COLUMN "snapshotAt"   TIMESTAMP(3),
  ADD COLUMN "packageName"  TEXT,
  ADD COLUMN "pricePaid"    DOUBLE PRECISION,
  ADD COLUMN "currency"     "Currency",
  ADD COLUMN "durationDays" INTEGER,
  ADD COLUMN "maxListings"  INTEGER,
  ADD COLUMN "changeKind"   TEXT NOT NULL DEFAULT 'NEW',
  ADD COLUMN "upgradeMode"  TEXT,
  ADD COLUMN "replacesId"   TEXT,
  ADD COLUMN "approvedAt"   TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "adminNote"    TEXT;

-- Backfill: freeze every existing subscription at its package's current terms.
UPDATE "SellerSubscription" s
SET "snapshotAt"   = NOW(),
    "packageName"  = p."name",
    "pricePaid"    = p."price",
    "currency"     = p."currency",
    "durationDays" = p."durationDays",
    "maxListings"  = p."maxListings"
FROM "SellerPackage" p
WHERE p."id" = s."packageId"
  AND s."snapshotAt" IS NULL;

-- Anything already ACTIVE was, by definition, already accepted.
UPDATE "SellerSubscription" SET "approvedAt" = "createdAt" WHERE "status" = 'ACTIVE' AND "approvedAt" IS NULL;
