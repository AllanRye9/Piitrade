# Changes in this drop

1. **Uganda + UGX only** – country/currency pickers removed (listing form, register, profile, checkout, shipping, packages, admin settings, jobs, categories, media, tier pricing); `Country`/`Currency` frontend types narrowed to `UGANDA`/`UGX`; middleware no longer geo-detects; backend validators/forced values (listings create/update/bulk, auth, jobs, stores, store rentals, doc parser, stats timezone). Prisma enums are untouched (no destructive migration).
2. **Special Offers** – new `Listing.originalPrice`; `GET /api/listings/special-offers` (admin switch + window + min-discount, paginated, search/sort/category); home section, `/special-offers` page, popup now uses the endpoint. **Back to School** – responsive (was mobile-only), paginated endpoint, `/back-to-school` page, countdown.
3. **Tier Pricing (Free/Gold/Platinum)** – now the last section of the posting form (review modal only echoes it).
4. **/jobs image** – job poster now shown full-size in the job dialog (was only a 64px cropped thumbnail); logos use `object-contain`.

## Migrations (run `prisma migrate deploy`)
- `20261012120000_listing_original_price`
- `20261012121000_uganda_ugx_only` – converts any non-UGX listing prices to UGX (default rates, rounded to 100) and sets country to UGANDA. Review rates before deploying if you have non-UGX data.

## Search
- Engine (`backend/src/utils/search.ts`): every word must match (title, description, category, location, tags, store name, vehicle make/model, property type, SKU); `"exact phrase"`, `-exclude`, plural/synonym matching, typo correction from real listing vocabulary, price phrases (`under 500k`, `over 1.5m`, `between 1m and 2m`), deterministic relevance ranking.
- `GET /api/listings` falls back to the corrected spelling on zero results (returns `correctedQuery`/`originalQuery`); `GET /api/listings/suggest` powers the header dropdown.
- Header dropdown: live suggestions (did-you-mean, completions, categories, top listings with photo + price), keyboard navigable. Results page shows "showing results for…" and search tips on empty results.
- Tests: `backend/src/utils/search.test.ts`.

## Admin audit fixes
- Settings now actually work: Maintenance Mode (503 gate + storefront maintenance screen; admins and sign-in exempt), Allow Registration (server-enforced + notice on the register page), Site Name (page title/OG), Items Per Page (default page size), Max Images Per Listing (server + upload UI). "Default Country" removed (Uganda only).
- Reports: Open/Resolved/Dismissed tabs; actions Remove listing / Warn seller / Ban seller / No violation / Dismiss; records kept; seller + reporter notified. Migration `20261013100000_report_moderation`.
- Removed dead/duplicate items: Account Types page (redirects to Users), Exchange Rates nav entry, orphan logo + enabled-countries admin endpoints, stray `app/admin_settings_page.tsx`.

## Layout / space usage pass
- `PublicShell`: removed the 7% side gutters on desktop; content now fills a centred 1472px (`max-w-[92rem]`) column that lines up with the header.
- Tailwind `max-w-7xl` widened 1280px → 1472px (all page containers).
- Product grids denser on wide screens: listings 5→6 cols (xl), home/category/flash/brand grids up to 7 cols at 2xl, 5-col store/flash grids → 6 at xl; listing detail sidebar wider at xl.

## Visual QA pass (Playwright, 1440px + 390px, ~28 public pages)
- Header: right-hand buttons were wrapping/crushed at 1440px; search now truly centred (≤40px off at 1440/1920). Language shows as code (EN); Help/Wishlist/Browse collapse on narrower desktops.
- Removed leftover "4 countries" copy (stores, register, store rental); jobs page widened and the dead "Country" filter removed.

## Margin trim
- Shell side gutters removed (content runs edge-to-edge of the 1472px column); page container vertical padding py-5…12 → py-3…5; home section spacing, empty-state padding and large top margins tightened.

## Header search upgrade
- Dropdown panel (720px on desktop) with grouped sections: Recent (per-item remove / clear all), Popular, Suggestions/"Did you mean", Categories, Listings with image/price/location; matched text highlighted; "See all results" row; keyboard hints.
- Refine panel: price presets + min/max (UGX) and condition (Any/New/Used), passed to /listings as priceMin/priceMax/condition.
- `/` or Ctrl/Cmd+K focuses the search from anywhere.

## Search by photo
- Camera button in the header search (desktop + mobile). Uses the same image-AI worker calls as the AI auto-fill on /listings/create (`identifyImageUrl` + `classifyImageUrl`), via new `frontend/lib/imageSearch.ts`.
- New public, rate-limited `POST /api/upload/search` (20/10min/IP): stores the photo briefly in `search-temp/` so the worker can fetch it, returns the URL, deletes it ~15 min later (no DB record).
- Results page shows a "Photo search" banner with alternative terms (classifier labels) to retry.
- Note: backend `tsc` could not be run in the sandbox (backend deps not installed); the new route follows the existing upload.ts patterns.

## Translation depth (en / sw / lg / ach)
- New `<T>text</T>` component (`components/ui/T.tsx`) for inline translated text; `useTr()` for placeholders/aria-labels.
- ~400 more UI strings translated (Kiswahili + Luganda) in `lib/i18n/ui.ts`, wired into: register, forgot-password, cart, checkout, profile, listing detail, post-a-listing form (labels, vehicle/property/job fields, review step), special offers, back to school, flash deals, today's deals, stores/partners, jobs (search, filters, apply), category pages, listing grid/search, mobile nav.
- Anything without an entry falls back to English. Acoli (ach) still only has entries sourced from your reviewed content files — no invented Acoli.
- sw and lg are AI-drafted: have native speakers review `lib/i18n/ui.ts` before launch.
- Not translated: long prose pages (about, help/FAQ, safety, terms, privacy, blog), admin/dashboard, category names coming from the database, seller-written listing content.

## Infra update (fb79715c-main.zip) + admin verification
- Applied from the zip: CI workflows (`.github/workflows`), `deploy.sh`, both Dockerfiles (Node 22, `prisma.config.ts` COPY), `seed.ts`/`seed-brand-fields.ts` (PrismaPg adapter), `db-setup.ts`, `prisma-local.sh`, `tsconfig.node.json`, migrations README.
  NOTE: these presuppose the Prisma 7 upgrade (`prisma.config.ts`, prisma/@prisma/client ^7, adapter in `src/utils/prisma.ts`, no `url` in schema datasource). Those files were not in the zip and are not in this tree — keep your repo's versions.
- Admin: layout now guards every /admin page (non-admins → /admin/auth/login); previously 11 pages had no role check. Header avatar no longer crashes if `user.name` is missing. Images/Reviews/Payment-proofs pages tolerate unexpected API shapes.

## Account area redesign (full-width, compact)
- `/profile`: 12-col layout (sticky identity/KYC rail + edit form + listings preview + documents), padding trimmed.
- `/profile/orders`: full-width compact cards, search, sort, role/status filters, page totals, pagination.
- `/profile/listings`: search, status/category/placement/price filters, sorting, table/grid views, bulk status/placement/delete, CSV export, copy link, stats strip.
- `/dashboard/store-rental`: two-column layout (subscription/placement/actions beside store profile).
- `/dashboard/store-rental/tools`: left-rail tabs with full-width content.
- Settings dropdown stays pinned right in `AccountTopBar` (shared by /profile and /dashboard).
- globals.css: opt-in `table.fill-table` (global `table{display:block}` rule shrank tables to content width).
- Hardened `VisitorStats`/`SiteAnalytics` against undefined counts; added sw/lg strings for the new UI.

## Classifieds-only conversion (all e-commerce removed)
**Frontend** — removed: /cart, /checkout, /profile/orders (+detail), /flash-sales, /special-offers, admin orders/returns/coupons/shipping/withdrawals/payment-proofs/payment-settings pages, CartContext, QuickAddButton, floating cart bar, delivery QR components, marketplace-mode admin card. Header/bottom-nav/account bar/portal lose cart + orders. Listing detail now shows only Message / Call / WhatsApp (login required for contact details). Store Tools reduced to Listings (price + status), Analytics (views, sold, enquiries) and Enquiries. Listing forms: required `stock` → optional `quantity`. Admin Revenue page (/admin/transactions) kept for subscriptions, store fees, CV downloads. Terms/support copy rewritten.
**Backend** — removed routes cart, orders, coupons, addresses, paymentProofs, withdrawals; utils checkoutPolicy, deliveryCode, orderLifecycle, orderStatusService, paymentProof(+Service) and their tests/cron; admin order/return/coupon/shipping/withdrawal/payment-settings/marketplace-mode/special-offers endpoints; GET /listings/status. Reviews now require prior message contact instead of a delivered order (no more verifiedPurchase). /stores/me/analytics returns views, active/sold counts, enquiry threads.
**Database** — migration `20261016000000_classifieds_only`: archives Order/OrderItem/Payment/PaymentProof/Return/Withdrawal/Coupon into `_archive_*` tables, drops all commerce tables/enums, Listing.stock→quantity (optional), drops sku/weight/dimensions, User.balance, ProductReview.verifiedPurchase, SiteConfig.paymentSettings/marketplaceMode, and trims NotificationType. Four obsolete rollback scripts deleted.
**Kept deliberately** — tiers/placements (incl. FLASH_SALE placement slot, now without a public page), store rentals as storefronts, KYC, messaging, reviews, jobs/CV, farmer marketplace (still has a placeholder `escrowStatus` field to remove).

### Classifieds pass — review fixes
- Restored admin `/site-config/deals` (Today's Deals) endpoints that an over-broad edit had removed; verified every frontend `/admin/*` call now has a backend route.
- Migration verified on PostgreSQL 16: all migrations apply, new one runs twice cleanly, data archived, resulting tables/columns match schema.prisma exactly. Fixed enum-dependency failure in the archive step found during that test.
- Listing detail: removed stray comment text rendered in the page, removed fake colour/size pickers (now read-only options only if the seller listed some).
- Removed unused auth code in FeaturedProductCard; tools tab wording.

## Frontend quality pass (post-classifieds conversion)
- **Deploy fix:** `frontend/package-lock.json` was out of sync with `package.json` (webpack and deps missing), so the Dockerfile's `npm ci` failed. Lockfile regenerated; `npm ci` verified from a clean directory.
- **Blog articles:** `prose*` classes had no effect (typography plugin not installed). Added `@tailwindcss/typography` and registered it in `tailwind.config.ts`.
- **Undefined classes:** `animate-fade-down` (region banner) is now defined (config animation + keyframes); `h-4.5`/`w-4.5` (filter-count badge) added as a 18px spacing step.
- **Homepage:** removed the "LIVE NOW" / "Piitrade" text collision (LIVE NOW now shows only when a promo video is set); region banner no longer tells users to use a country selector that no longer exists; raw `UGANDA` enum no longer shown in copy (`countryLabel()` helper in `lib/utils.ts`; featured-deal empty state, browse-all empty state, category result count).
- **Classifieds copy:** WhatsApp card "Chat To Order" -> "Chat With Us" (prefilled message no longer mentions ordering); "Today's Deals / Exclusive Prices" card (which links to /listings) -> "Latest Listings / Fresh From Sellers"; "SHOP NOW" -> "BROWSE LISTINGS".
- **Header:** mobile "Browsing Uganda" row used a dropdown chevron though it is a plain link; now a right chevron. Search placeholder truncates with an ellipsis instead of being hard-clipped.
- **Accessibility:** search combobox now has `aria-controls` linked (via `useId`) to its listbox.
- **Lint:** 2 errors cleared (no-op `eslint-disable` comments naming unloaded rules) and the duplicate `extends` key in `.eslintrc.json` removed. 2 `react-hooks/exhaustive-deps` warnings intentionally left (Intlayer nodes in deps could cause callback churn).
- Verified: `tsc --noEmit` clean, `next build` succeeds, 14 pages x desktop/mobile load with no horizontal overflow and no uncaught JS errors.

## Search-by-photo, search bar redesign, compact jobs page
- **Search by photo is now prominent and supports camera + upload.** The header search has a tinted "Photo" button (label shown on xl screens, icon chip below that) that opens a *Take a photo / Upload a photo* menu. The suggestions panel also shows a *Take photo | Upload* row when the box is empty.
  - Phones/tablets: "Take a photo" opens the native camera via `<input capture="environment">`; "Upload" opens the gallery/file picker.
  - Desktops: new `components/search/CameraCaptureModal.tsx` (getUserMedia, rear camera preferred, camera switch when >1 camera, downscaled JPEG, tracks always stopped on close). Blocked/missing camera falls back to upload with a clear message.
  - All three paths feed one `processPhoto()` pipeline (same 10 MB / image-type validation and `searchByImage()` as before).
- **Search bar:** fully rounded pill with lined segments (category | input | photo | round search button) on desktop and mobile; desktop bar widened (`lg:w-[40%] max-w-[32rem]`). Fixed invalid `ring-[var(--x)]/NN` classes (Tailwind cannot apply opacity to `var()` colours, so the ring silently fell back to blue).
- **Jobs page compacted:** header 230px -> 102px (desktop) / 208px -> 147px (mobile); search is a single rounded, lined bar (keyword | location | button, two rows on phones); tighter filters, cards (~35% shorter), spacing and empty/loading states. Behaviour, ids, labels and handlers unchanged.
- **Breadcrumb (all 13 pages using it):** a global `nav a { min-height: 44px }` mobile rule made the "Home" link a tall box that looked like the trail wrapped onto two lines. Breadcrumb links are now exempt.
- Verified: `tsc --noEmit` clean, ESLint 0 errors, `next build` OK, Playwright behaviour tests (menu, Escape, fake-webcam capture, blocked-camera fallback, mobile native-camera chooser, gallery upload) and a 28-page overflow/JS-error smoke test.

## Landing page: category item counts, professional hero, tablet header
- **New endpoint `GET /api/categories/rollup-counts?country=UGANDA`** (backend/src/routes/categories.ts, additive): `{ counts: { [slug]: n }, total, country }` where each count includes ALL subcategories (Motors = Used Cars + Motorcycles + ...). `jobs` is the number of open JobPost rows (Jobs is its own model). A missing slug means 0. Cached in memory for 30s. Covered by `src/routes/categories.rollup.test.ts` (roll-up, jobs override, country scoping, cache, cycle safety, error path). The existing `/active-counts` route is untouched.
- **Counts on every home category icon:** mobile icon grid, a new tablet/desktop "Browse by category" tile row (10 categories + "N active listings" total), and the desktop "All Categories" sidebar. Counts are formatted `842 / 1,234 / 12.4K / 1.2M` (truncated, never rounded up), show a skeleton while loading, read "No listings yet" for empty categories, and render nothing (not "0") if the request fails. One shared request feeds all three (`hooks/useCategoryCounts.ts`, `lib/formatCount.ts`, `lib/homeCategories.ts`, `components/ui/CategoryCount.tsx`, `components/ui/HomeCategoryTiles.tsx`).
- **Sidebar fix:** it gated entries on *direct* counts, so a parent such as /fashion was hidden when its listings sat only in subcategories. It now uses the roll-up counts.
- **Hero:** the empty state told public visitors "Hero images are uploaded by the admin". It is now a branded welcome ("Buy, sell and find anything in Uganda" + Browse listings / Post a free ad). It appears only after the hero request settles, so it never flashes before an uploaded banner.
- **Mobile tiles:** removed the leftover "Sale" badge (kept "Hot").
- **Tablet header (640-1023px):** the search input was ~74px wide and "Register" was clipped off-screen. The tagline is hidden and the category dropdown is hidden at those widths (category stays selectable via "Refine"); input is now ~180px and nothing is clipped. >=1024px and phones unchanged.
- **Deploy fix (backend):** `backend/package-lock.json` was out of sync with `package.json` (react, react-dom, scheduler missing), so the Dockerfile's `npm ci` would fail. Regenerated (pure addition); `npm ci` verified.
- New UI strings fall back to English until translated in `lib/i18n/ui.ts`.

## Backend / API / security audit pass
See `SECURITY_AUDIT.md` for the full findings, fixes, pre-deploy steps and open items. Summary: Prisma 7 reconciled (lockfile now in sync), token-injection account takeover closed, listing moderation can no longer be bypassed by owners, seller contact details gated on list + store endpoints, KYC photos made private (authenticated route + `KycImage`), live ban/role enforcement, upload content validation, rate limits on public/LLM endpoints, blog sanitisation, security headers, CI runs tests, Docker build fails on type errors.

## Repository merge & organisation pass (backend + frontend → one application)
**Layout.** `backend/` and `frontend/` are kept (deploy.sh, Railway and both Dockerfiles depend on it) but now behave as one app: root `package.json` (no dependencies) with `dev`, `build`, `typecheck`, `lint`, `test`, `check`, `db:*`, `docker:*`; `scripts/dev.mjs` runs API + web together from ONE root `.env`; root `README.md`; consolidated `.env.example`.

**Sources combined.** `main.zip` (repo: Prisma 7, Dockerfiles, CI, three extra migrations) + `pi-classifieds.zip` (classifieds-only source) + `pi-classifieds-v2-changes-only.zip` (search-by-photo / jobs / globals.css; only its 4 real code files were applied).

**Stale files in the incoming drops that were deliberately NOT taken** (they would have regressed the repo):
- `backend/package.json` + lock: drop pinned **Prisma 5.22**; repo is on **Prisma 7.10** → repo versions kept.
- `backend/src/utils/prisma.ts`: drop used the legacy `datasources` option (Prisma 7 needs the `PrismaPg` adapter) → repo version kept.
- `backend/prisma/schema.prisma`: classifieds models kept, but the `url = env("DATABASE_URL")` datasource line removed (invalid in Prisma 7; URL lives in `prisma.config.ts`).
- `frontend/package.json` `next` pin `15.5.23` → restored `^15.5.27` (lock now resolves 15.5.28); lock regenerated, clean `npm ci` verified. v2's package.json/lock were byte-identical to v1's and were not applied.

**Fixes needed to make the merge compile on Prisma 7** (`backend/src/routes/listings.ts`, 2 lines): `/suggest` select `status: { not: 'REJECTED' as const }`; `Prisma.JsonFilter` → `Prisma.JsonNullableFilter` (the non-nullable `JsonFilter` type is only generated when a model has a required Json column; the only one, `Withdrawal.accountInfo`, was removed).

**Migrations.** Kept `20261011215407_advance_migration_dev`, `20261013110000_agriculture_order_quantities`, `20261013175117_combo_database_application` (in your repo, absent from the drop) so history matches any database that already applied them. Verified on PostgreSQL 16: upgrading a DB that had the old chain applied (+`classifieds_only`, run twice) produces a schema identical to a fresh install of the merged chain. NOTE: `advance_migration_dev` drops the three `Listing_*_trgm_idx` search indexes and `combo_database_application` drops `Report_status_createdAt_idx` — see the follow-up in the hand-over notes.

**Removed.** Conversion leftovers absent from the drop: 57 files (cart/checkout/orders/coupons/withdrawals routes, order utils + 140 tests, admin commerce pages, country pages, rollbacks for dropped order migrations, stray `admin_settings_page.tsx`). Confirmed-dead code: 9 components (`FooterLocations`, `layout/LocaleSwitcher`, `CategoryPills`, `CommodityPriceWidget`, `HomeFarmerMarketplace`, `HomeMarketPrices`, `PromoBanners`, `SiteAnalytics`, `TodaysDeals`), 3 orphaned Intlayer dictionaries, unreferenced `frontend/style.css`, empty `backend/fix.sql`, stale root `intlayer.config.ts` (it listed locales the app no longer has). Generated/secret files not shipped: `backend/dist`, `frontend/.intlayer`, `*.tsbuildinfo`, and the root `.env` (it contained real-looking secrets — rotate them if they were ever used outside local dev).

**Config.** `frontend/next.config.mjs`: added the same-origin `/api` rewrite that `lib/apiUrl.ts` already claimed existed, and `outputFileTracingRoot` (silences the multi-lockfile warning; keeps `.next/standalone/server.js` path stable). Root `.env.example`: `NEXT_PUBLIC_API_URL` placeholder (`<your-backend-service>`) would have aborted `docker compose up --build`; now a working default. `.gitignore` rewritten (old `/dist` rule was root-anchored, so `backend/dist` was committed). `frontend/.dockerignore` deduplicated + ignores generated files. `backend/.env.example`: removed obsolete order/delivery-code vars. CI now also runs backend unit tests and frontend lint. `frontend` gained a `typecheck` script.

### Second merge: v3 (landing-page counts) + security-audited tree
**Lineage.** `pi-classifieds-v3-full.zip` is v2 + 15 files. `files.zip` → `pi-classifieds-fixed.zip` was built from **v1** (it lacks the v2 camera/jobs/globals.css work; taking its copies of `HeaderSearch.tsx`, `globals.css`, `jobs/page.tsx` would have silently reverted search-by-photo), so only its real delta (fixed − v1) was applied: 34 changed + 26 added files. v3's delta (v3 − v2) was applied on top. The two deltas overlapped only in `CHANGES.md` and `backend/package-lock.json`.

**Resolved by hand.** `next.config.mjs`: kept the audit's security headers, opt-in `NEXT_IMAGE_HOSTS` image lockdown and `/uploads` proxy, plus the pinned `outputFileTracingRoot`; the two competing `/api` rewrites became one keyed on `BACKEND_INTERNAL_URL` (fallback `NEXT_PUBLIC_API_URL`, then `http://backend:5000`). `backend/.env.example`: dropped the dead order/delivery-code block, kept the new security switches. `listings.ts`: the audit's version (it fixes all 5 enum sites + `JsonNullableFilter<'Listing'>`; supersedes my 2-line patch). `ci.yml`: audit and I had added the identical test step; kept my extra lint step. `backend/package.json`: your Prisma 7 manifest + the two new deps (`sanitize-html`, `@types/sanitize-html`); lockfile regenerated, clean `npm ci` verified. The audit's `prisma.ts`, `prisma.config.ts` and schema change were byte-identical to the repo's, confirming the Prisma 7 layer.

**Compatibility fixes for the merged infrastructure.** The new startup guard makes `docker-compose.yml` (NODE_ENV=production, placeholder secret defaults) refuse to start until real secrets are set, so the "boots with no .env" claim was removed and `.env.example`/README now say to generate secrets. Compose now passes through `ALLOW_INSECURE_DEFAULTS`, `ENABLE_ADMIN_REGISTER` and `CV_PAYMENT_WEBHOOK_SECRET` (empty = off), and `RATE_LIMIT_MAX` defaults to 600 as the audit recommends. `.gitignore` gained `backend/data/` and `backend/logs/`.

**Before deploying to an existing database:** back it up and run `backend/prisma/pre-migration/archive-user-balances.sql` (the classifieds migration drops `User.balance`).

## Subscriptions, preferences, admin alerts, inbox, category counts, store activation
See `API_CHANGES.md` (API contracts, behaviour changes, operations). New migration `20261017090000_subscription_lifecycle_prefs_counts` (additive). 39 integration + 123 unit tests.

## Site-wide QA pass (mobile header + functionality)
See `QA_REPORT.md`. Frontend fixes: header now sticks on scroll (global `overflow-x: hidden` on html+body broke `position: sticky`),
hamburger visible when scrolled, Login/footer/"Forgot password" labels centred, 320px header no longer clipped, bottom nav and
support-chat bubble no longer cover the open menu / Home tab, off-canvas drawer shadow leak and keyboard-focus leak removed,
admin pages no longer clipped on phones (`min-w-0`), two React hook dependency warnings fixed. `tools/mobile-audit/` re-checks these.


## Merge: classifieds v4 + QA-fixed backend/frontend + UI phase 2
- **Base** = `pi-full-qa-fixed` (new backend: `/admin/alerts`, `/categories/counts`, subscription lifecycle, inbox pagination, column preference, store activation; mobile/header QA fixes; 123 unit + 39 integration tests). `pi-classifieds-v4-full` is the same line minus those backend changes; its only unique content was a **separate frontend implementation of the six feature items** (built for `GET /admin/pending-tasks`, `latest/status` on `my-subscription`, `utils/rentalActivation.ts`). That implementation duplicates the QA-fixed backend's contract, so it was **not carried over** (`NavBadge`, `PendingTasksPanel`, `AnimatedCount`, `SubscriptionStatusBadge`, `useAdminPendingTasks`, `useLiveRefresh`, backend `pendingTasks`/`subscriptionState`/`rentalActivation`). The phase-1 frontend (below) replaces it. `.env` from the v4 zip is intentionally excluded.
- **Phase 1 frontend (6 items)** and **phase 2 UI** (sticky mobile contact bar, seller trust block + safety strip, sticky quick-filter bar with `withPhotos`, card badges + animated heart, posting stepper + live preview) were three-way merged onto that base. Conflicts resolved: `MobileCategoryGrid` keeps the base's home-page counts (`useCategoryCounts` → `/categories/rollup-counts`); the nav-bar hook was renamed `useNavCategoryCounts` to avoid a name clash; `messages/page.tsx` keeps the base's hook-deps fix.
- **Saved searches with alerts (new).** `POST/GET/PATCH/DELETE /api/saved-searches` (max 10 per user, de-duplicated, filters whitelisted in `utils/savedSearches.ts`). A step in the 5-minute lifecycle sweep notifies the owner (`SYSTEM` notification with a `href`) when new ACTIVE listings matching a search appear after its watermark. Migration `20261019000000_saved_searches` extends the existing unused `SavedSearch` table (adds `name`, `lastCheckedAt`; cascade on user delete). UI: "Save search" chip in the filter bar, `/profile/saved-searches` (alerts toggle, new-match badge, delete), link in the account bar/profile, "View listings" link on those notifications. 4 unit tests.
- **Skeleton loaders** replace the spinners on public pages (`/stores/[slug]`, `/jobs` Suspense fallback) via `components/ui/PageSkeleton.tsx`; listing grids already used skeletons.

### Merge audit fixes (found by diffing the three trees, then running the merged stack for real)
- **Hydration fix restored:** the v4 zip's `useCategoryCounts` no longer seeds state from its module cache (the cause of React error #418); the QA-fixed zip lacked it. The same fix is applied to `useNavCategoryCounts` (nav bar).
- **Admin store rentals (`/admin/partners`)** now shows the API's real refusal reason (KYC not passed, end date passed) instead of "Failed", updates the row from the save response, confirms "store is now Active and operational", warns when ACTIVE is chosen with a past end date, and has a **Reactivate** button for Expired/Cancelled rentals that opens the editor on ACTIVE with a fresh period pre-filled (the API refuses a past end date, so the admin confirms the date; the v4 zip's auto-extend behaviour was not carried over because the QA-fixed API deliberately does not auto-extend).
- The support-chat bubble no longer covers the sticky Message button on phone listing pages.
- `backend/src/savedSearches.integration.test.ts` added (4 real-database tests).
- Verified on a real PostgreSQL 16: all 30 migrations apply in order; 123+4 unit tests; 39+4 integration tests; live browser run of the real frontend against the real backend (subscription Expired → Renew, listings filter bar + save search, saved-searches page, seller trust block from real data, messages without page scroll, create-listing live preview, store owner flips Expired → Active when an admin activates the rental, admin Needs-attention panel + bell) with no failed API calls or JS errors.

## Homepage / admin fixes (Oct 2026)
- `/admin/media`: page title now shows the Site Logo (BrandLogo; 🏷️ fallback) instead of 📁.
- Today's Deals: restored `components/ui/TodaysDeals.tsx` (deleted in the conversion cleanup) and mounted it at the top of the homepage; driven by Admin → Settings → Today's Deals.
- Back to School: compact banner and `/back-to-school` header on mobile.
- Support Chat: logged-in users' conversations persist on-device (localStorage, per-user key, 50 messages, 30-day expiry) and sync to the server (`SupportChatHistory` table, migration `20261020130000_support_chat_history`; `GET/PUT/DELETE /support/chat/history`), newest copy wins; "Clear chat" clears both; guests are never stored.
- Admin `/admin/support-requests` redesigned as a Support Inbox (searchable list + chat-bubble detail, contact actions, composer, full saved chat via `GET /support/admin/history/:userId`); chat widget header polished.
- Homepage Layout: new `/admin/homepage-layout` (pin/reorder Flash Deals, Featured Deal, Latest Collections, Back to School, Trusted Stores); `Listing.pinOrder` + `Store.pinOrder` (migration `20261021090000_pin_order`); pinned items sort first in every row and the main feed; `/api/stores` now orders pinned → store plan tier → newest and returns `tier`; Flash Deals row added to the homepage; tier select + pin rank in `/admin/listings`; Gold/Platinum badges on Trusted Sellers; Featured Deal page title renamed "Featured Deals" (was "Today's Deals").
- Placement durations unified: every path that sets a placement without an explicit expiry (admin approve, bulk feature, Mark Feature, store owners, auto-fill) now defaults to 30 days (`backend/src/utils/placement.ts`); admin modals default to 720 h.
