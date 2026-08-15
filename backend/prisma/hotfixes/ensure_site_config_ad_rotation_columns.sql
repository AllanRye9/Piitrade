-- Ensure SiteConfig has the ad-rotation columns schema.prisma expects
-- (multiple rotating ad images + admin-configurable display interval).
-- Run defensively on every startup, like the other hotfixes in this folder.

ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adImages" JSONB;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adIntervalSeconds" INTEGER;
