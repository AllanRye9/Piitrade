-- Homepage section layout (order, visibility, titles, custom collection rows). NULL = the built-in default layout.
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "homeLayout" JSONB;
