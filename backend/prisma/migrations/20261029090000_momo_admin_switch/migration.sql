-- Admin on/off switch for MTN MoMo.
-- NULL = never set by an admin: MTN_ENABLED (environment) decides, as before.
ALTER TABLE "SiteConfig" ADD COLUMN IF NOT EXISTS "momoEnabled" BOOLEAN;
