# Admin audit fixes – batch 1

**Added**
- Special Offers admin control: `GET/PUT /api/admin/site-config/special-offers` (enabled, minimum discount 1-99, optional start/end window, validated) and `frontend/components/admin/SpecialOffersSettings.tsx`, mounted on Admin > Settings. The public site already read these values; nothing could write them before.
- "Currency Rates" link in the admin sidebar (Monetisation). The page is live: `usePricingCurrency` uses it to convert USD package prices to UGX.

**Fixed**
- `PUT /api/admin/settings` now validates and clamps through `normalizeGeneralSettings` before saving, and `GET` returns the enforced values. Settings inputs use the same bounds as the server (items per page 4-100, images 1-30).

**Removed (no contribution)**
- Header theme: admin route, settings card, context field, public-config field, Header dependency. (The `headerTheme` DB column is left in place; no migration.)
- `DELETE /admin/reports/:id` and `POST /admin/subscriptions/run-expiry` (no UI; the 5-minute lifecycle sweep covers expiry).
- Unused imports in `routes/admin.ts` (`readJsonFile`, currency-rate helpers, `expireOverdueSubscriptions`).

**Not done yet** (see audit): move JSON-file stores to Prisma, farmer-marketplace seed/escrow cleanup, single-country leftovers, duplicate per-page role checks, settings page split, doc corrections.
