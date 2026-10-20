# Phase-2 fixes — what changed and how to deploy

## Deploy order
1. Back up the database.
2. `cd backend && npx prisma migrate deploy` — additive migrations (all five new ones were executed against PostgreSQL 16, including backfills on sample existing data):
   - `20261020090000_subscription_snapshots_upgrades` (snapshots existing subscriptions at their package's current terms)
   - `20261020100000_split_furniture_garden` (new top-level `garden` category; moves Garden Furniture / BBQ & Grills / Plants & Seeds under it; listings keep their category)
   - `20261020110000_kyc_business_form`
   - `20261020120000_package_scope_store` + `20261020120100_store_packages` (Webstore plans become packages; seeds the old plans once as ordinary, editable packages using the fees already set in Site Config; links existing rentals to them)
3. `npx prisma generate`, then deploy backend + frontend.

## Behaviour changes
- **Subscriptions are snapshotted** (name, price, currency, duration, listing cap). Editing a package affects new subscriptions only; entitlement, admin approval and Revenue read the snapshot.
- **Upgrades** `POST /packages/:id/upgrade {mode: AFTER_EXPIRY|IMMEDIATE, paymentRef}`. AFTER_EXPIRY chains after the current term; IMMEDIATE cancels the current plan on admin approval (unused days are NOT credited). Cancelling a running plan pulls a queued upgrade forward.
- **Admin approval** must send the reviewed package details; the API rejects missing/stale details, and paid requests without a payment ref.
- **Packages**: duplicate, deactivate; delete blocked when subscribers exist; scope locked once subscribed.
- **/profile/subscription**: labels, prices (no fixed FX rate), allowances all derived from package data.
- **KYC**: Webstore application requires KYC submitted (activation still requires approved); partner approval requires approved KYC. Brief business form (`/profile/verification?for=webstore|partner`).
- **/listings**: panels/drawer portalled above the header; one control per filter; breadcrumb with Home link.
- **Enquiries** (`/dashboard/store-rental/tools`): threads keyed by buyer + listing, replies stay on the listing, seller-only filter, 15 s refresh.
- **Furniture** and **Garden** are separate categories/routes (`/furniture`, `/garden`).
- **Partners** (`/partners`, `/admin/partners`) and **Webstores** (`/stores`, `/admin/webstores`) are separate pages. `/admin/store-rentals` redirects.
- `/dashboard/store-rentals/*` and `/listing` redirect to the real paths.

## No hard-coded fees (second pass)
- **Webstore plans** are packages (Admin → Packages → "Webstore" tab: price, length, listing cap, tier). Removed from code: `STORE_PLANS` (0 / 60,000 / 300,000), the 5-month annual multiplier, the Gold/Platinum fee defaults, the `$100 × 3700` fee on the dashboard, the register page's plan cards, the renewal-reminder windows, the `ANNUAL ? 365 : 30` in admin.
- **Listing tier prices** (Gold / Platinum / duration) no longer default to 20,000 / 50,000 / 30 in code. If an admin has not set them in Site Config → Tier Pricing, those tiers are not offered. **After deploy, check Site Config → Tier Pricing is filled in.**
- Package prices in other currencies convert with the admin-managed rate, never a literal.
- A package is either **Free** (ticked, price 0) or **paid** (price > 0); the API rejects anything else.

## CV / free rule
A subscription starts ACTIVE only when its package is ticked Free with price 0. Every paid package — CV included — starts PENDING_PAYMENT, needs a payment reference and admin approval.

## Redirects
`/listing?country=…` → `/listings?country=…` (308, every query parameter kept; verified against a running build). `/dashboard/store-rentals/*` → `/dashboard/store-rental/*`.

## Known gaps
- **The Webstore "payment" modal is a simulation**: it collects card details in the browser, waits 1.5 s and reports success; nothing is charged. The server now records paid applications as payment PENDING for admin confirmation, but the modal should be replaced by a real gateway or by a "pay, then enter your reference" step.
- Not exercised against a live database; the migrations and SQL (`sellerOnly`) have been type-checked, not run.
