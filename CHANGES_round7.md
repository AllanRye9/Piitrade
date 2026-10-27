# Round 7

## MoMo
MoMo payments, receipts and the live sandbox scripts were already complete in this code. Added an OFFLINE test so the
whole flow can be checked without MTN credentials:
- `backend/src/utils/momo/fakeMtn.ts` imitates the MTN sandbox (token, account check, requesttopay, status, the five
  sandbox test numbers, 409 idempotency, 401 refresh, 503).
- `npm run momo:selftest` (backend) runs 12 checks against it; `momoFlow.test.ts` is the same in vitest.
- Real sandbox stays `npm run momo:sandbox:check` (proves YOUR keys); selftest proves OUR code.
- The DB-backed momo*.integration tests (`npm run test:integration`) need Docker/Postgres and were not run here.

## Categories and per-ad-type fields
- `backend/src/utils/categoryTaxonomy.ts`: 17 top-level categories, ~190 subcategories (new: Health & Beauty, Pets,
  Business & Industrial, Food & Beverages, Education & Books, Events; many new subcategories in the old ones).
  Synced additively at start-up (never renames/removes anything an admin changed).
- Each kind of ad now asks its own fields (phones: brand/model/storage/RAM; shoes: size; pets: breed/vaccinated; services:
  area/pricing basis; solar: power/capacity, ...). Admin "Custom Fields" still override. Motors, Property, Jobs keep their
  dedicated forms. The server validates (required, select options, numbers, dates) and stores only the known answers.
- Category picker has search. Detail page shows the answers with units, headline specs first.

## Homepage layout
- Admin → Homepage Layout has two tabs: **Page sections** (order, show/hide, rename Featured Deal / Latest / Other /
  Recent, add your own collection rows from a category, a placement or hand-picked ads) and **Ads in rows**
  (existing ordering + new search-and-add into Featured Deal, Flash Deals, Latest Collections, Back to School).
- `GET /api/home-layout` (cached 30 s) drives the public page. New column `SiteConfig.homeLayout`
  (migration 20261026090000_home_layout) - run `prisma migrate deploy` and `prisma generate`.

## Speed
- Home page fetches everything in ONE parallel batch with a 4 s limit (was two sequential batches, no limit).
- Five home rows no longer re-request data the server already sent (about 8 fewer requests; also removes a flash of
  empty rows).
- Shared public GETs (categories, popular searches, stats, site media, counts) are de-duplicated and cached briefly in
  the browser; short public cache headers on the public feed endpoints.

## Search (follow-up check)
One engine (`backend/src/utils/search.ts`) serves search, type-ahead suggestions, popular searches and saved searches:
multi-word AND matching, "exact phrases", -exclusions, price phrases ("under 500k", "between 1m and 2m"), plurals,
synonyms, typo correction against live listing words, relevance ranking. Added:
- Searching also matches the ad-form details **brand / model / breed** (case-insensitive across the common letter cases)
  and ranks those matches; the same fix covers motor make/model, which was case-sensitive before.
- Searching a **district** ("wakiso", "gulu") also finds ads placed in its towns and neighbourhoods, the same
  matching the location filter uses.
- Suggestions include the details so ranking is consistent.
Browser-tested on phone and desktop with a mock API: suggestions (one debounced request), Enter -> /listings?q=,
location picker adds `location=` while keeping `q`, no overflow. Not tested against a real database.

## Location picker on phones
The bottom sheet is gone on phones (under 640px). The picker is now a compact dropdown that hangs from the Location
button (`frontend/components/listings/LocationDropdown.tsx`): search box, "All Locations", and the four regions as an
accordion (tap Northern to see its districts and counts). No dimmed overlay, no page scroll-lock; it closes on pick, a tap
outside, the x, Escape, tapping the button again, or scrolling the page. It opens upward when there is no room below.
Tablets and desktops keep the centred dialog with region tabs.
