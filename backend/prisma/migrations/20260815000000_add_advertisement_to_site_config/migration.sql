-- Add homepage advertisement columns to SiteConfig. Powers the admin-managed
-- ad banner that replaces the old "PIITRADE EXCHANGE · Money Transfer Rates"
-- widget directly under the homepage hero slideshow.
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adImageUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adLinkUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adAltText" TEXT;
