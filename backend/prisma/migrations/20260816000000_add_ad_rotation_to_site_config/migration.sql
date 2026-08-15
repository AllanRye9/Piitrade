-- Supersedes the single adImageUrl/adLinkUrl/adAltText columns added in
-- 20260815000000_add_advertisement_to_site_config with a rotating set of ad
-- images plus a configurable display interval. Those older columns are left
-- in place untouched (harmless if already deployed) — the app simply stops
-- reading/writing them in favor of adImages/adIntervalSeconds below.
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adImages" JSONB;
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "adIntervalSeconds" INTEGER;
