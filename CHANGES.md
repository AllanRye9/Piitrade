# piitrade — Visitor Stats, Logo/Image, Profile Fix & Admin Settings Fix

## Cluster 1 — Visitor Statistics Logic Enhancement

**Files:** `backend/src/routes/stats.ts`, `frontend/components/ui/SiteAnalytics.tsx`,
`backend/prisma/schema.prisma`, new migration `20260731010000_visitor_stats_and_logo_link_fields`,
`backend/prisma/hotfixes/ensure_site_stat_table.sql`

- Labels renamed: "Visitors" → **"Total Visitors"**, "Today" → **"Today's Visitors"**.
- Total Visitors logic unchanged (cumulative unique device IDs) — untouched, all
  previously stored data preserved.
- Today's Visitors reset logic enhanced: previously compared server-local `Date`
  objects; now compares a `YYYY-MM-DD` day-key computed in the local timezone of
  the visitor's selected/detected country (UAE → Asia/Dubai, Uganda →
  Africa/Kampala, Kenya → Africa/Nairobi, China → Asia/Shanghai), via a new
  `SiteStat.lastResetDayKey` column. Both the write path (`POST /stats/track`)
  and the read path (`GET /stats/public`, which now accepts `?country=`) use
  this logic, so the number displayed resets correctly at local midnight even
  if no new visitor has hit `/track` yet.
- No data was cleared or replaced — this is additive to the existing schema/logic.

## Cluster 2 — Logo & Image Replacements

**Files:** `backend/prisma/schema.prisma`, `backend/src/routes/admin.ts`,
`backend/src/app.ts`, `frontend/context/SiteConfigContext.tsx`,
`frontend/components/ui/SiteAnalytics.tsx`, `frontend/app/admin/settings/page.tsx`

- Added `SiteConfig.logoLinkUrl` and `SiteConfig.logoDisplayMode` ("inline" | "replace").
- **Inline mode** (default, item 3): the admin-uploaded logo now renders inside a
  real `<a>` link pointing to `logoLinkUrl` next to "piitrade EXCHANGE · Money
  Transfer Rates" — previously the image had no click target at all.
- **Replace mode** (item 4): a new admin toggle lets the image fully replace the
  "piitrade EXCHANGE · Money Transfer Rates" text section; the same link behavior
  applies.
- Admin Settings → Logo Management gained a "Logo Link URL" field and an
  "Inline / Replace" mode picker.

## Cluster 3 — Profile Image Upload Fix

**File:** `frontend/components/ui/UserAvatar.tsx`

- Root cause: the component had its own `resolveAvatarUrl()` helper that only
  rewrote `localhost` URLs. The upload endpoint actually returns **relative**
  paths (`/uploads/...`, `/api/images/...`), which were never rewritten to the
  backend origin — so uploaded avatars 404'd against the frontend's own domain.
- Fix: swapped in the shared `resolveImageUrl()` helper (already used correctly
  for listing/logo images elsewhere in the app) and added an `onError` fallback
  to the initials placeholder if an image URL ever fails to load.
- `UserAvatar` is the single shared component used across profile, dashboard,
  jobs, listings, and reviews pages, so this fixes display for both users and
  admins wherever avatars appear.
- Storage/retrieval on the backend (`PUT /users/me`) was already correct — no
  backend changes needed for this cluster.

## Cluster 4 — Admin Settings Save Fix

**Files:** `backend/src/index.ts`, `backend/prisma/hotfixes/ensure_site_config_columns.sql`

- Root cause: `ensure_site_config_columns.sql` — written specifically to add
  any `SiteConfig` columns missing due to migration drift, so a settings save
  never fails with "column does not exist" — was **never executed**. `index.ts`
  only ever ran `ensure_listing_inventory_columns.sql` at startup. Any
  environment where `logoSize` (or another newer column) wasn't actually
  applied would 500 on every `/admin/settings` and `/admin/site-config/*` call.
- Fix: generalized the startup hotfix runner (`runAllHotfixes()`) to execute
  **every** `.sql` file in `prisma/hotfixes/`, not just one, both in the
  Railway migrate-deploy-failure fallback and the always-run compatibility
  check.
- Also updated `ensure_site_config_columns.sql` to include the previously
  missing `logoSize` column, plus the new `logoLinkUrl`/`logoDisplayMode`
  columns from Cluster 2.
- The `/admin/settings` route logic itself (validation, allowed keys, DB
  writes) was already correct and required no changes.

## Verification

- Frontend: `npx tsc --noEmit -p tsconfig.json` passes with zero errors across
  the whole project, including all files touched above.
- Backend: could not run `prisma generate` in this sandbox (network egress to
  `binaries.prisma.sh` is blocked here), so a full backend `tsc` pass wasn't
  possible. Recommend running `npx prisma generate && npx tsc --noEmit` in your
  normal dev/CI environment before deploying — the SQL/schema/route changes
  were reviewed manually and follow the exact patterns already used elsewhere
  in `admin.ts`.
- Run `npx prisma migrate deploy` (or let the app's existing auto-migrate-on-start
  logic run it) to apply migration `20260731010000_visitor_stats_and_logo_link_fields`.
