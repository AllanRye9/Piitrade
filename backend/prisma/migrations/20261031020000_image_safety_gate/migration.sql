-- Photos are screened for prohibited content at upload and only reach the admin queue once the ad is posted.
ALTER TABLE "ProductImage" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "ProductImage" ADD COLUMN "safetyStatus" TEXT NOT NULL DEFAULT 'UNSCREENED';
ALTER TABLE "ProductImage" ADD COLUMN "safetyNote" TEXT;
-- Everything uploaded before this migration was already visible to admins.
UPDATE "ProductImage" SET "submittedAt" = "uploadedAt";
CREATE INDEX "ProductImage_status_submittedAt_idx" ON "ProductImage"("status", "submittedAt");
