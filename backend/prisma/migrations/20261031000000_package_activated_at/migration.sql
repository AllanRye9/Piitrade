-- A CV package's duration window now runs from when it was (re)activated, not from creation.
ALTER TABLE "SellerPackage" ADD COLUMN "activatedAt" TIMESTAMP(3);
