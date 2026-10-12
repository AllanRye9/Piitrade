# Changes in this drop

1. **Uganda + UGX only** – country/currency pickers removed (listing form, register, profile, checkout, shipping, packages, admin settings, jobs, categories, media, tier pricing); `Country`/`Currency` frontend types narrowed to `UGANDA`/`UGX`; middleware no longer geo-detects; backend validators/forced values (listings create/update/bulk, auth, jobs, stores, store rentals, doc parser, stats timezone). Prisma enums are untouched (no destructive migration).
2. **Special Offers** – new `Listing.originalPrice`; `GET /api/listings/special-offers` (admin switch + window + min-discount, paginated, search/sort/category); home section, `/special-offers` page, popup now uses the endpoint. **Back to School** – responsive (was mobile-only), paginated endpoint, `/back-to-school` page, countdown.
3. **Tier Pricing (Free/Gold/Platinum)** – now the last section of the posting form (review modal only echoes it).
4. **/jobs image** – job poster now shown full-size in the job dialog (was only a 64px cropped thumbnail); logos use `object-contain`.

## Migrations (run `prisma migrate deploy`)
- `20261012120000_listing_original_price`
- `20261012121000_uganda_ugx_only` – converts any non-UGX listing prices to UGX (default rates, rounded to 100) and sets country to UGANDA. Review rates before deploying if you have non-UGX data.
