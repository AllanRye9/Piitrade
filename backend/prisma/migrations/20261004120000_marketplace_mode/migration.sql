-- Site-wide buy/cart availability mode: CLASSIFIEDS (nobody gets cart/buy),
-- ECOMMERCE (everyone outside Motors/Property gets cart/buy), or HYBRID
-- (only admin-owned listings get cart/buy — the only behavior that existed
-- before this column, hence why null/unrecognized is treated as HYBRID in
-- application code rather than a DB default, so no existing listing's
-- buyable status changes until an admin deliberately switches modes). See
-- isCheckoutEligible() in frontend/lib/utils.ts and its enforcement in
-- POST /api/orders (backend/src/routes/orders.ts).
ALTER TABLE "SiteConfig" ADD COLUMN "marketplaceMode" TEXT;
