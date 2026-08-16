-- Add promo video columns to SiteConfig. Powers the "LIVE NOW / SHOP NOW"
-- video shown beside the homepage hero slideshow, which previously only
-- shipped as a static bundled file (public/logo.mp4) with no admin control.
-- Mirrors the interviewDemoVideoUrl/Title columns added for the Interview
-- Demo Video feature (see 20260616000000_fix_site_config_columns).
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "promoVideoUrl" TEXT;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "promoVideoTitle" TEXT;
