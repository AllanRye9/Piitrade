-- Ensure SiteConfig has every column schema.prisma expects. Run defensively
-- on every startup (like the other hotfixes in this folder) so a settings
-- save never fails with "column does not exist", even if migration history
-- in this environment is out of sync with the migrations folder.

ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "interviewDemoVideoUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "interviewDemoVideoTitle" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "promoVideoUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "promoVideoTitle" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "generalSettings" JSONB;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "logoSize" INTEGER;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "logoLinkUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "logoDisplayMode" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "enabledCountries" TEXT[] NOT NULL DEFAULT ARRAY['UGANDA']::TEXT[];

-- Fix logoPages type drift (previously created as TEXT, schema declares Json/jsonb).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SiteConfig' AND column_name = 'logoPages' AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE "SiteConfig"
      ALTER COLUMN "logoPages" TYPE JSONB USING (
        CASE
          WHEN "logoPages" IS NULL OR "logoPages" = '' THEN NULL
          ELSE "logoPages"::jsonb
        END
      );
  END IF;
END $$;
