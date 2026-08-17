-- Add enabledCountries to SiteConfig. Controls which countries are publicly
-- selectable on the storefront (country switcher, welcome modal, /country/*
-- pages). Launch scope is Uganda-only; UAE/Kenya/China stay in the codebase
-- and can be turned on later from /admin/settings without a deploy.
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "enabledCountries" TEXT[] NOT NULL DEFAULT ARRAY['UGANDA']::TEXT[];
