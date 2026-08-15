-- Ensure SiteConfig has the homepage-advertisement columns schema.prisma
-- expects. Run defensively on every startup (like the other hotfixes in this
-- folder) so admin settings saves never fail with "column does not exist",
-- even if migration history in this environment is out of sync with the
-- migrations folder.

ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adImageUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adLinkUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adAltText" TEXT;
