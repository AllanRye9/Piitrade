-- Admin-configurable payment gateway settings: { mobileMoneyEnabled,
-- mobileMoneyNumber, mobileMoneyInstructions, codEnabled }, stored as a
-- JSON blob on the singleton SiteConfig row, following the same convention
-- as generalSettings/todaysDeals/blogPopup. Nullable — a missing value is
-- treated as "use defaults" by the API (see GET/PUT /api/admin/payment-settings
-- and the paymentSettings field on GET /api/public/site-config).
ALTER TABLE "SiteConfig" ADD COLUMN "paymentSettings" JSONB;
