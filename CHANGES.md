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

## Photo search — verification & fixes
- **Zero-result queries:** listings search requires every word to match, so AI descriptions like "silver Samsung Galaxy S21 smartphone" often found nothing. `searchByImage` now returns ordered `candidates` (full phrase → colour/material words dropped → brand/model → head noun → common synonym such as "phone"). `/listings` auto-steps down that list when `photo=1` returns 0 results, and the "Photo search" banner says which term it fell back to. Helpers: `nextPhotoCandidate`, `readImageCandidates` in `frontend/lib/imageSearch.ts`.
- **Classifier labels** (ImageNet wording such as "cellular telephone") are mapped to marketplace terms ("phone", "shoes", "tv", "fridge", …).
- **Unreachable photo URL:** the AI worker downloads the photo itself, so the URL must be absolute and public. `assertPublicImageUrl` now fails fast with an actionable message (localhost / private IP / missing `NEXT_PUBLIC_API_URL`) instead of a vague worker error. Photo search therefore only works against a publicly reachable backend, not `localhost`.
- **Timeouts:** upload 45 s, each AI call 30 s. If one model fails or times out the other still produces a query. 429 / 400 responses from `/upload/search` show their real message.
- **`POST /api/upload/search`:** dedicated multer config — stored extension comes from the validated MIME type (camera/clipboard uploads with no extension used to produce files the `/api/images` proxy rejects); image is resized to 1024 px before storage (faster for the AI); stale `uploads/search-temp/*` files are swept on boot and every 15 min (local-disk mode). **Ops note:** with S3 storage add a bucket lifecycle rule expiring the `search-temp/` prefix after 1 day, because the 15-minute delete timer is lost on restart.
