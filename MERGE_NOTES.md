# Merge notes: main.zip (round 7) + phase_changes.zip (Uganda categories, category layout, alerts)

Base = main.zip. Phase work was re-applied on top; main-only features were kept.

## How each file was resolved
- **Phase replaces main** (phase's version is a strict superset or main had nothing unique): saved-search util/route/test, `lib/savedSearch.ts`, `SaveSearchButton`, `lifecycleJobs`, `categoryVisibility`, `sitemap`, `CategoryBar`, `AccountTopBar`, admin layout, root layout, `Header`, `megaMenu`, `FilterSidebar`, `HeaderSearch`, `SiteConfigContext`, `siteSettings`, `seed.ts`, `CategoryPicker`, `HomeCategoryTiles`, `MobileCategoryGrid`, `/profile/saved-searches` (now redirects to `/profile/alerts`).
- **Both sides combined**: `schema.prisma`, `app.ts`, `index.ts`, `email.ts`, `admin.ts`, `listings.ts`, `types.ts`, `notifications/page.tsx`, `profile/page.tsx`, `browse/all/page.tsx`, `bulk-post/page.tsx`, `categories.ts`, `categoryTaxonomy.ts`.
- **Main wins, phase bits re-added**: `listings/create/page.tsx` (main's version + Uganda slug lists).
- `homeCategories.ts`: main's `alwaysShow` (Services, Classifieds) kept, now honoured in `lib/homeTiles.ts`; `mobile` flag made optional (mobile grid uses top-ranked tiles + "More").

## Taxonomy reconciliation
Main's `categoryTaxonomy.ts` and the phase's `ugandaTaxonomy.ts` were independent designs. Now:
- `categoryTaxonomy.ts` is the single registry: main's tree + Uganda data, slugs globally unique. `categories.ts`, auto-sync and the migrations all agree.
- 79 Uganda entries removed because main already has them (30 identical slugs; 49 same idea, different slug, e.g. `dogs-puppies` -> `dogs`). Old->new slug map is in code history of `frontend/lib/categorySynonyms.ts` (synonyms now point at main's slugs).
- Five shared top-level categories (food-groceries, industrial-business, pets-animals, education-training, events-entertainment) use main's names/icons everywhere (data module and SQL).
- Overlap kept on purpose (different top-level pages): `energy-power` vs `electronics > solar-power`, `building-construction` vs `industrial-business > construction-materials`, `arts-collectibles` vs `classifieds > art-collectibles`. Merge or drop later if you do not want both.
- Field presets added for the five new parents (building-construction, energy-power, travel-tourism, fine-jewellery, arts-collectibles).
- Final tree: 22 top-level categories, 278 subcategories.

## Migrations (renumbered so they sort after main's latest, 20261026090000)
20261027100000_uganda_subcategories_existing_parents, 110000_uganda_standalone_categories, 120000_category_display_fields,
130000_notification_type_listing_alert, 140000_listing_alerts. All of main's migrations are byte-identical to the original.
Matching rollbacks are in `backend/prisma/rollbacks/`; the standalone rollback never deletes the five shared top-level categories.

## Tests moved
Phase's frontend tests are merged into `frontend/navtest/` (one runner, `npm run test:nav`). `tests/e2e` kept.

## Verified here
- Frontend: `tsc --noEmit` clean, `next build` succeeds, 130/130 `test:nav` tests pass.
- Backend: type-check shows no errors beyond those caused by the Prisma client not being generated; unit tests that do not touch the DB pass (taxonomy, Uganda data, etc).

## NOT verified (sandbox could not download Prisma engines)
`prisma generate` / `prisma validate`, applying migrations to a real Postgres, and the 8 backend test files that import the Prisma client (they fail identically without a generated client). Before deploying run:
`npx prisma generate && npx prisma migrate deploy && npm test && npm run test:integration`.

## Round 2: all.zip edits + Site Logo tab icon folded in
- all.zip (= main + 13 edits) applied by three-way merge (base main.zip): Site Logo wiring (BrandLogo, BrandTagline, Header/Footer mobile, admin layout,
  media page, exactly-one-image upload), banner removal on /motors, category pages, /listings and /jobs, and migration
  20261027204940_finalization_of_migration (DROPs the seven _archive_* tables: irreversible, check them first). No conflicts.
- Browser-tab / iOS / installed-app icon = Site Logo (see SITE_LOGO_CHANGES.md). app/icon.svg and app/favicon.ico moved to public/.
- Verified: frontend tsc clean, next build OK, 130/130 nav tests; backend type-check unchanged from the previous merge, DB-free tests pass
  (the remaining failing files need a generated Prisma client, which this sandbox cannot download).
