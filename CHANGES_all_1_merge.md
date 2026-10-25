# Piitrade: Complete Change Log (revised)

Everything added to the `all_1` codebase across four rounds of work, merged into one tree and delivered as
`all_1_unique_merge_changes.zip` (67 files: only the files that differ from your original `all_1.zip`).

All changes are **additive**: nothing was removed, and every new behaviour is opt-in or defaults to the previous behaviour.

| Round | Source | What it delivered |
|---|---|---|
| 1 | `all_1.zip` fixes | 4-column "All" grid, listing-image fix, compact `/dashboard` |
| 2 | `all_1_offers_push_full.zip` | Make an offer / negotiate, Web Push + WhatsApp notifications |
| 3 | `eni-updated.zip` + `pii-phase0-changes.zip` | Category navigation overhaul, photo-mismatch check, CI workflows, navigation tests |
| 4 | Review pass on the merged code | Five fixes (section 8) and a Docker-safety tweak |

`eni.zip` is an older snapshot of `eni-updated.zip` and adds nothing of its own. `pii-phase0-changes.zip` is a subset of
`eni-updated.zip` plus a test suite that exists nowhere else.

---

## 1. Listing grid, images and dashboard

### 1.1 Four columns on "All"
- `ListingGrid` has a new optional `maxColumns?: 4` prop. When set, the grid never exceeds 4 cards per row.
  Default behaviour is unchanged, so favorites and offer pages keep their grids.
  - Compact density: 2 / 3 / 4 columns. Comfortable density: 2 / 2 / 3 / 4 columns.
- `/listings` (the nav "All" tab) passes `maxColumns={4}` when no category is selected. Other categories keep their grid.
- `/browse/all`: main grid, loading skeleton and Recent Listings are now 4 columns (previously up to 6, and 7 on very wide screens).
- `RecentListingsSection` has a new optional `gridClassName` prop, defaulting to the original 6-column layout.

### 1.2 Listing image display fix (`ListingCard`)
- The card builds a list of every usable image (approved CDN images first, then legacy `images[]`), de-duplicated.
- On a load failure it retries the same file **without** the Next.js image optimizer, then tries the next image,
  and only then shows the placeholder.
- It re-checks after mount, because an image that fails before hydration never fires React's `onError`.
- It resets when a card is reused for a different listing.

### 1.3 `/dashboard`
- **Image fix:** Top Listings thumbnails now use the approved CDN image first (they previously read only `images[0]`).
- **Compaction:** tighter spacing, padding, radii and heading sizes. Stat cards are a single row (icon beside value).
  No section, text, link or logic was removed.

---

## 2. Make an offer / negotiate

### 2.1 How it works
A buyer proposes a lower price on a listing. The seller can **accept**, **counter** or **decline**; the buyer can
**withdraw** an open offer. Every step is a `PriceOffer` row, a chat message (shown as an offer card in the thread)
and a notification for the other party.

### 2.2 Rules (enforced on the server)
| Rule | Value |
|---|---|
| First offer must be below asking and at least | 10% of asking price |
| Counter must land | strictly between the offer being answered and the responder's own previous position |
| Offer lifetime | 48 hours (an overdue pending offer reads as `EXPIRED` and is saved as such) |
| Open offers per buyer per listing | 1 |
| After a seller declines | buyer waits 24 hours to re-offer on that listing |
| After an offer is accepted | no further offers from that buyer on that listing |
| Negotiation steps per buyer per listing | 12 |
| New offers per account per day | 30 |
| Note length | 300 characters |
| Rate limits | 10 offers/min and 30 responses/min per user |

Each (listing, buyer) chain is serialized with a Postgres advisory lock, so simultaneous taps cannot create two open
offers or answer one offer twice. Accepting an offer records the agreed price in the chat; it does **not** change the
listing price or mark it sold.

### 2.3 API (`/api/price-offers`)
| Method and path | Purpose |
|---|---|
| `POST /` | Buyer makes a first offer |
| `POST /:id/respond` | `{action: ACCEPT, DECLINE or COUNTER, amount?, note?}` by the party who did not make the offer |
| `POST /:id/withdraw` | The maker withdraws their own open offer |
| `GET /listing/:listingId/mine` | State the listing page needs (can offer, existing offer, owner view) |
| `PUT /listing/:listingId/settings` | Owner switches `acceptsOffers` on or off |

Strangers get 404, not 403, so offer ids cannot be probed.

### 2.4 Frontend
- **Listing page:** a **Make an offer** button in the contact card (desktop and mobile) and an **Offer** button in the
  mobile sticky bar. If the buyer has an open or accepted offer, a status strip with an "Open chat" link replaces the button.
  After a decline, the contact card explains why offering is unavailable.
- **Make-an-offer dialog:** asking price, quick-pick amounts (5/10/15/20% below), optional note, client-side validation,
  Escape and backdrop close. On success the buyer lands in the chat.
- **Chat:** offer messages render as cards with the amount, note, status badge, time left, and only the actions the
  viewer is allowed (Accept / Counter / Decline, or Withdraw). Cards refetch after every action.
- **Owner switch:** listing owners see an **Accept price offers** toggle and a count of offers waiting for them.
- **Notifications page:** icons for the four new notification types and a configurable link label ("Open chat").

---

## 3. Push and WhatsApp notifications

### 3.1 Delivery design
- **Immediate:** new chat messages and offer events are dispatched right after the notification is created.
- **Background sweep (every 15 s):** notifications created anywhere else in the app (listing approvals, KYC,
  subscriptions, saved-search alerts and so on) are delivered too, without touching those code paths. Only notifications
  from the last 5 minutes are considered, so a deploy never replays history. The sweep does nothing (and opens no
  database transaction) until push or WhatsApp is configured.
- **Exactly once:** a `NotificationDelivery` row is claimed under a unique `(notificationId, channel)` key before sending,
  so several server instances cannot double-send. A crash between claim and send loses one alert rather than duplicating it.
- **No replay to new devices or numbers:** a newly added device, or a newly verified WhatsApp number, never receives
  notifications created before it was added or verified.
- Delivery log rows are pruned after 30 days.

### 3.2 Browser push (Web Push, VAPID)
- Disabled until `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set.
- Payloads are encrypted (`aes128gcm`) with a 24-hour TTL. Dead subscriptions (HTTP 404/410) are deleted automatically.
  Up to 10 devices per user.
- `public/sw.js` handles push only (no offline caching, so it can never serve stale pages). It skips the notification when
  the site is focused on screen, opens only same-site relative URLs, focuses an existing tab instead of opening a
  duplicate, and sets `renotify` only when a valid tag exists.
- On iPhone, push works only for sites added to the Home Screen; the settings card says so.

### 3.3 WhatsApp (Meta WhatsApp Cloud API)
- Disabled until `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set.
- Uses two pre-approved templates: an alert template (UTILITY, three variables: title, message, link) and a
  one-time-code template (AUTHENTICATION, with copy-code button).
- A number receives alerts **only after the user verifies it** with a 6-digit code sent over WhatsApp. The code is stored
  hashed, valid 10 minutes, 5 attempts, at most 5 codes per hour with a 60-second gap.
- Eligible types: new chat message, the four offer events, listing approved, listing rejected.
- **Held, not dropped, while the user is on the site:** if the user was active in the last 2 minutes the alert is held and
  retried every 15 s; it is sent once they have been away, or dropped if they stay on the site for the whole 5-minute
  window (they saw it in the app).
- Skipped (and the reason recorded) when 20 messages were already sent in 24 hours, and for chat messages when one was
  sent in the last 30 minutes. Chat messages can be muted entirely.
- Template variables are sanitized (no newlines, tabs or long space runs; length-capped).

### 3.4 API (`/api/push`)
| Method and path | Purpose |
|---|---|
| `GET /settings` | One call for everything the settings card needs |
| `PUT /settings` | `{notifyMessages}` silences chat-message alerts only (offers and other updates still arrive) |
| `POST /subscribe`, `POST /unsubscribe` | Register or remove this browser (https endpoint and key shapes validated) |
| `POST /test` | Sends a real test push to the user's devices (3 per minute) |
| `POST /whatsapp/send-code`, `POST /whatsapp/verify` | Number verification flow |
| `DELETE /whatsapp` | Stop WhatsApp alerts and forget the number |

### 3.5 Frontend
- **Alert settings card** at the top of `/notifications`: browser alerts on/off for this device with a test button,
  WhatsApp number + code verification, and a "new chat messages" switch. The card stays hidden until the server has push or
  WhatsApp configured, so the site looks unchanged until then.
- `lib/push.ts`: support detection, subscribe/unsubscribe, and a silent re-sync of an existing subscription.
- `next.config.mjs`: `/sw.js` is served with `no-cache` headers so updates reach users promptly.

---

## 4. Category navigation and visibility (from `eni-updated` / `pii-phase0`)

Goal: let the large category tree exist without producing empty pages for buyers. Seller surfaces (post form, bulk post,
admin) still show the full tree.

### 4.1 Core rules (`lib/categoryVisibility.ts`)
- A buyer sees a category only if it has live listings (counts include subcategories).
- Fails **open** while counts are loading or if they fail, so a network blip never hides everything.
- The **Jobs** and **CV Services** trees are never gated (they are not listing-driven).
- A default display rank orders top-level categories; unlisted slugs sort after by live count.
- A strict variant (`isConfirmedLive`) is used for additive "extra" entries, which stay hidden until counts confirm
  they have listings.

### 4.2 Surfaces
- **Header category bar (`CategoryBar`):** "priority+" fitting. From the `lg` breakpoint it fits as many tabs as the row
  allows and moves the rest into a **More** menu (measured with a hidden copy of the strip, recomputed on resize, font
  load and count changes). The active tab always stays visible. Below `lg` it stays a swipeable row. Live top-level
  categories that have no hand-made tab are appended as extra tabs (strictly gated) and fit or overflow like any other.
- **Mega menu (`lib/megaMenu.ts`):** curated columns are kept (capped), plus one extra column ("More in {category}") of
  live subcategories the curated list does not already link, most populated first. Panels are kept inside the bar's right edge.
- **Header search (`HeaderSearch`):** the category dropdown is built from the API tree (buyer-visible categories in rank
  order, selected one always kept), with a hand-made list as the fallback while data loads or if it fails.
- **Filter sidebar:** parent and subcategory cascade with counts, buyer gating, and the selected category always preserved.
- **`/browse/all`:** top-level categories with no live listings are hidden (the selected one always stays).
- **Home tiles, mobile category grid, hero side cards:** entries are filtered by the same live-count rule.
- **`hooks/useCategoryTree.ts`:** one shared, cached request for the category tree.
- **Backend search suggestions (`utils/suggestCategories.ts`, wired into `routes/listings.ts`):** header-search category
  suggestions are limited to categories with live listings (jobs and CV trees exempt). It over-fetches 24 candidates,
  keeps 4, and fails open if counts cannot be loaded.

---

## 5. Photo-mismatch check while posting (from `eni-updated`)

- **Shared logic (`lib/photoMismatch.ts`):** compares the image-AI labels of each extra photo with the first photo,
  caches labels per photo, and **fails open** (if the AI service is down or a photo cannot be classified, nothing is
  flagged and nobody is blocked).
- **Create listing and bulk produce forms:** the check runs as soon as photos finish uploading, not only on Post. It does
  not nag when editing an existing listing or restoring a draft, and it remembers photo sets the seller already
  confirmed or dismissed.
- **`PhotoMismatchModal`:** shows the first photo beside the flagged ones. The seller can remove them, confirm they are
  correct, or go back. It renders in a portal on `<body>` (so the mobile bottom nav can never cover its buttons), has an
  `input` mode ("keep") and a `submit` mode ("continue"), and can name which product in a bulk form it concerns.

---

## 6. Other UI polish (from `eni-updated`)
- `ListingCard` compact mode: flex-column layout so prices align at the bottom, fewer stacked badges on small screens,
  scaled favorite button, verified-seller badge hidden on very small cards.
- `HomeAgriculturalSection`: aligned with other home sections (fade-up animation, wrapping header).
- `RowCarousel`: arrow buttons move to the outer edge from the `lg` breakpoint.

---

## 7. CI, tests and tooling

### 7.1 GitHub Actions (`.github/workflows/`)
| File | Purpose |
|---|---|
| `ci.yml` | Backend: db setup, hotfix validation, Prisma generate, typecheck, unit tests, real-PostgreSQL integration tests, build. Frontend: typecheck, lint, **navigation tests (step added in this merge)**, build |
| `sync-lockfiles.yml` | Detects `package.json` / `package-lock.json` mismatches and repairs them |
| `update-dependencies.yml` | Weekly dependency-update pull request |

### 7.2 Tests
- **Backend unit tests added:** 39 for offers, dispatch policy, WhatsApp payloads and push parsing (`priceOffers`,
  `notificationDispatch`, `whatsapp`, `webPush`, `push`), plus 4 for `suggestCategories`.
- **Frontend navigation tests (33):** `frontend/navtest/` covers category visibility, priority+ fitting, mega-menu columns,
  `CategoryBar` and `FilterSidebar`. Run with `npm run test:nav`.
- **Tooling added to `frontend/package.json`:** `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`,
  `@vitejs/plugin-react`, and the `test:nav` script. The lockfile change is purely additive (177 packages added, none
  removed or changed) and plain `npm ci` works. Installing with `--legacy-peer-deps`, as the original `phase0` config
  suggested, would have dropped `webpack` from the lockfile and broken CI's `npm ci`, so it was installed normally.
- `frontend/.dockerignore` now excludes `navtest` and `vitest.nav.config.mjs`, so the production image never type-checks
  test code (verified: the app type-checks cleanly without them).

---

## 8. Review pass (round 4): fixes made to the new code

| # | Problem found | Fix |
|---|---|---|
| 1 | A WhatsApp alert for a user who had just left the site was marked "skipped" and lost for good | The alert is now held and retried until the user has been away, then sent exactly once (end-to-end test added) |
| 2 | The dispatcher opened a database transaction every 15 s even with push and WhatsApp unconfigured | The sweep now returns immediately when nothing is configured |
| 3 | `sw.js` could throw a `TypeError` on a push whose `tag` was not a string (`renotify` without a tag) | `renotify` is set only when a valid string tag exists (2 tests added) |
| 4 | The offer dialog re-focused the amount field whenever the parent page re-rendered, which could pull focus away mid-note | Focus and key handling now run once on mount, with the latest handlers kept in refs |
| 5 | After a seller declined, the buyer saw nothing on the listing page | The contact card now shows the reason and when offering is possible again |
| 6 | Test files sat inside the production Docker build context | Excluded in `.dockerignore` (see 7.2) |

---

## 9. Database changes

One migration, **`20261023100000_price_offers_and_push_delivery`**, purely additive.

| Change | Detail |
|---|---|
| `NotificationType` values | `OFFER_RECEIVED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`, `OFFER_COUNTERED` |
| New enum `OfferStatus` | `PENDING`, `ACCEPTED`, `DECLINED`, `COUNTERED`, `WITHDRAWN`, `EXPIRED` |
| `Listing.acceptsOffers` | `BOOLEAN NOT NULL DEFAULT true` (existing listings accept offers) |
| `Message.offerId` | nullable FK to `PriceOffer` (`ON DELETE SET NULL`) plus index |
| New table `PriceOffer` | One row per negotiation step |
| New table `PushSubscription` | Browser subscriptions (`endpoint` unique) |
| New table `NotificationPreference` | Per-user chat-alert switch and WhatsApp number/verification state |
| New table `NotificationDelivery` | Claim and audit log for every external send |
| New index | `Notification(createdAt)` for the dispatcher's recent-window scan |

The migration was written by hand (Prisma's schema engine cannot be downloaded in the build sandbox). Run
`prisma migrate dev` once on your side to confirm it reports no drift.

---

## 10. Environment variables (all optional; features stay off until set)

Documented in `backend/.env.example`.

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Enable browser push. Generate with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | A `mailto:` or `https:` contact for push services |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Enable WhatsApp (the token is secret) |
| `WHATSAPP_TEMPLATE_NAME` | Alert template (default `piitrade_alert`) |
| `WHATSAPP_AUTH_TEMPLATE_NAME` | Code template (default `piitrade_verification`) |
| `WHATSAPP_AUTH_TEMPLATE_COPY_CODE` | Set `false` if the code template has no copy-code button |
| `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_API_VERSION` | Defaults `en`, `v21.0` |
| `WHATSAPP_API_BASE` | Only override for testing against a mock |

The existing `FRONTEND_URL` is used to build absolute links in WhatsApp messages.

---

## 11. File inventory (67 files)

**Added (A) / modified (M) relative to the original `all_1.zip`. Nothing deleted.**

### CI
`A` `.github/workflows/ci.yml`, `sync-lockfiles.yml`, `update-dependencies.yml`

### Backend
| | File |
|---|---|
| M | `.env.example`, `package.json`, `package-lock.json` (adds `web-push`, `@types/web-push`) |
| A | `prisma/migrations/20261023100000_price_offers_and_push_delivery/migration.sql` |
| M | `prisma/schema.prisma` |
| M | `src/app.ts` (mounts `/api/price-offers` and `/api/push`), `src/index.ts` (starts the dispatcher) |
| M | `src/routes/messages.ts` (offer cards in threads, immediate push on a new message), `src/routes/listings.ts` (live-only category suggestions) |
| A | `src/routes/priceOffers.ts`, `src/routes/push.ts`, `src/routes/push.test.ts` |
| A | `src/utils/priceOffers.ts`, `notificationDispatch.ts`, `webPush.ts`, `whatsapp.ts` |
| A | `src/utils/priceOffers.test.ts`, `notificationDispatch.test.ts`, `webPush.test.ts`, `whatsapp.test.ts` |
| A | `src/utils/suggestCategories.ts`, `suggestCategories.test.ts` |

### Frontend
| | File |
|---|---|
| M | `.dockerignore`, `package.json`, `package-lock.json`, `next.config.mjs`, `lib/types.ts` |
| A | `public/sw.js`, `vitest.nav.config.mjs`, `navtest/CategoryBar.test.tsx`, `navtest/FilterSidebar.test.tsx`, `navtest/lib.test.ts` |
| A | `lib/offers.ts`, `lib/push.ts`, `lib/categoryVisibility.ts`, `lib/megaMenu.ts`, `lib/priorityFit.ts`, `lib/photoMismatch.ts`, `hooks/useCategoryTree.ts` |
| A | `components/offers/ListingOfferAction.tsx`, `MakeOfferModal.tsx`, `OfferCard.tsx`, `OwnerOfferSetting.tsx`, `components/notifications/NotificationSettings.tsx` |
| M | `app/browse/all/page.tsx`, `app/dashboard/page.tsx`, `app/listings/ListingsPageClient.tsx`, `app/listings/[id]/ListingDetailClient.tsx`, `app/listings/create/page.tsx`, `app/listings/create-produce/page.tsx`, `app/messages/page.tsx`, `app/notifications/page.tsx` |
| M | `components/layout/CategoryBar.tsx`, `components/layout/HeaderSearch.tsx` |
| M | `components/listings/FilterSidebar.tsx`, `ListingCard.tsx`, `ListingGrid.tsx`, `PhotoMismatchModal.tsx`, `RecentListingsSection.tsx` |
| M | `components/ui/HeroSideCards.tsx`, `HomeAgriculturalSection.tsx`, `HomeCategoryTiles.tsx`, `MobileCategoryGrid.tsx`, `RowCarousel.tsx` |

### Merge reconciliation
A file-by-file three-way comparison (using the round-1 deliverable as the common ancestor) found **0 conflicts**:
24 files came from `eni-updated`, 32 from the offers/push work, and 455 were identical. The `eni` work already contained
the round-1 fixes verbatim, and none of the round-2 files overlap with it.

---

## 12. Verification (final tree, after the review pass)

| Check | Result |
|---|---|
| Backend `tsc --noEmit` and build | Pass |
| Backend unit tests | 234 passed (29 files) |
| Backend integration tests (real PostgreSQL, all 45 migrations applied: the 44 existing plus the new one) | 116 passed (9 files) |
| Offers / push / WhatsApp end-to-end (real Express app + Postgres, mock WhatsApp, mock encrypted push service) | 114 of 114 passed |
| Service worker logic (mocked browser APIs) | 13 of 13 passed |
| Frontend `tsc --noEmit` (with and without the test files) | Pass |
| Frontend lint (covers the new tests too) | No warnings or errors |
| Frontend navigation tests | 33 passed |
| Frontend production build | Pass, no warnings |
| Plain `npm ci` with the updated lockfile | Pass |
| Zip applied over the original `all_1.zip` | Reproduces the tested tree exactly (515 files, 0 differences) |

Bugs found and fixed by testing before delivery: an expired offer's status was rolled back instead of saved, and WhatsApp
alerts replayed older notifications right after a number was verified (both in round 2), plus the six items in section 8.

---

## 13. Setup checklist

1. Apply the migration (`prisma migrate deploy`) and run `prisma migrate dev` once to confirm no drift.
2. Generate VAPID keys and set the three `VAPID_*` variables to turn on browser push.
3. For WhatsApp: set the two credentials and get both templates approved in Meta Business Manager (exact shapes are in
   `backend/.env.example`).
4. Run `npm ci` in `frontend/` so the navigation tests and tooling are available.
5. Optional: add a PNG notification icon (push uses `/icon.svg`, which some Android devices do not display).

---

## 14. Known limitations and unverified items

- **Not run in a real browser:** the offer dialog and cards, the alert settings card, and the new navigation components
  were type-checked, built and unit-tested, but not clicked through in a live browser. The mobile sticky bar now holds up
  to four buttons (Message, Call, WhatsApp, Offer), so check it on a narrow phone.
- **WhatsApp** was tested only against a mock server. Send one real message after the templates are approved.
- **Web Push** was verified against a mock push service that decrypts payloads, not through real Chrome, Firefox or Safari
  push services.
- **CI's `db:setup:hotfixes` step** could not run in the build sandbox (Prisma downloads an engine from a blocked host).
  The same hotfix SQL was applied directly with `psql` against the merged schema, twice, and succeeded.
- **Behaviour choices you may want to change:** 48-hour expiry, 10% minimum offer, 24-hour re-offer cooldown, the
  counter-offer range rule, WhatsApp limits (20 per day, one chat alert per 30 minutes) and the WhatsApp-eligible types.
  All are constants in `backend/src/utils/priceOffers.ts` and `backend/src/utils/notificationDispatch.ts`.
- Accepting an offer does not mark a listing sold or change its price.
