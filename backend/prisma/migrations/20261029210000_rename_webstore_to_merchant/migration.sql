-- "Web Store" is now called "Merchant" everywhere it is shown. This is data only (no schema change).
--
-- The store_packages migration seeded plans named "Webstore Free Trial", "Webstore Monthly", ... and every
-- rental keeps a snapshot copy of its plan's name, so those old names are still on screen (package picker,
-- seller dashboard, receipts). Rename exactly that seeded pattern and nothing else: a name an admin has
-- already changed (anything that does not start with "Webstore ") is left alone. Safe to run more than once.
UPDATE "SellerPackage"
SET "name" = 'Merchant' || substr("name", length('Webstore') + 1)
WHERE "scope" = 'STORE' AND "name" LIKE 'Webstore %';

UPDATE "StoreRental"
SET "packageName" = 'Merchant' || substr("packageName", length('Webstore') + 1)
WHERE "packageName" LIKE 'Webstore %';
