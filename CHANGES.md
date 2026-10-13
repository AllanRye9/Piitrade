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
