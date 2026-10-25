# Piitrade code review: login to payment, plus the admin site

Scope: backend auth, payments (MTN MoMo), subscriptions, store rentals, CV downloads, listings, admin router, and frontend auth/payment components. Findings come from reading the code, not running it. Items marked *verify* deserve a quick manual test.

**Not covered:** most admin page UIs, messaging, jobs, farmer marketplace, support chat, the image pipeline, tests.

## Critical: fix before taking real money

1. ✅ **FIXED** — **Users can write their own store pricing and approve themselves.**
   - `POST /store-rentals` copies client `placements` into the rental JSON; `PATCH /store-rentals/my/placements` merges any keys into the same column.
   - That column also holds server payment state (`pendingRenewal` with `fee`, `tier`, `newEndDate`, `maxListings`, `packageId`).
   - `STORE_RENEWAL` pricing reads `pendingRenewal.fee`; `confirmPendingRenewal()` applies its tier/duration/cap and sets `status: 'ACTIVE'` with no status check, no KYC check, no admin approval.
   - Likely exploit (*verify*): apply with a forged `pendingRenewal` (fee 1, PLATINUM, end 2099), pay UGX 1, get an active Platinum store.
   - Fix: keep payment bookkeeping out of client-writable JSON, or strip server-owned keys on every client write.
   - **Done:** client `placements` are whitelisted (`categories`, `positions`, `storeName`, `storeDescription`, `storeCategory`, `contactPhone`) on create and on `PATCH /my/placements`; server-owned keys can no longer be written. `confirmPendingRenewal` also validates tier, fee and `maxListings`.
2. ✅ **FIXED** — **Cancelled or suspended stores can be revived by paying a renewal.** `POST /store-rentals/renew` takes the latest rental in any status; `resolveStoreRenewal` and `confirmPendingRenewal` never check status. *Done:* only ACTIVE or EXPIRED rentals can renew (route, payment quote and confirmation); an EXPIRED store also needs ID verification to reopen.
3. ✅ **FIXED** — **`POST /api/stores` creates a public store with no rental, payment or KYC.** `Store.isActive` defaults true and the public list filters only on that. It also promotes BUYER to SELLER. *Done:* it now requires a live ACTIVE rental and no longer changes the user's role.
4. 🟡 **PARTIALLY FIXED** — **CV payment protects nothing server-side.** The CV is printed in the browser; the server only returns `valid: true`. `/validate` is not single-use despite comments, so one payment gives unlimited downloads for 24h. Download limits use a client-supplied `deviceId`, which guests can rotate.
   - **Done:** `/validate` is now `POST` (token out of URLs and logs) and atomically releases at most `CV_MAX_DOWNLOADS_PER_TOKEN` downloads (default 3) per payment, migration `20261022130000_cv_token_download_count`. **Still open:** the CV is rendered in the browser, so real enforcement needs server-side rendering; guest limits still key on a rotatable `deviceId`.

## High

5. ✅ **FIXED** — **Duplicate payments are silently absorbed.** Server marks a payment EXPIRED after 5 min but honours late approval for 24h. The modal says "You have not been charged" and offers Try again. If both succeed, the second hits "Already active/paid/unlocked" and is marked DONE, not NEEDS_REVIEW.
   - **Done:** a second successful payment for an item another payment already granted now goes to NEEDS_REVIEW ("Duplicate payment"). Starting a new attempt first re-checks recent EXPIRED attempts with MTN and refuses with 409 if one was approved late. The modal no longer claims "You have not been charged" and warns after a timeout. (An admin confirming manually before the payment lands still records DONE, as before.)
6. ✅ **FIXED** — **"Resolve" conflates granted with refunded.** `resolveReviewedPayment` sets `SUCCESSFUL` + `provisionedAt` even for refunds; the payer UI then shows `completed: true`. No REFUNDED/RESOLVED state.
   - **Done:** new `REFUNDED` status (migration `20261022120000_payment_refunded`). Resolve now requires `outcome: GRANTED | REFUNDED`; a refund keeps `provisionedAt` null and never shows as completed. Admin page asks which one.
7. 🟡 **PARTIALLY FIXED** — **The "Revenue" page isn't revenue and ignores MoMo.** It reads StoreRental, SellerSubscription and CvDownloadToken, never `PaymentTransaction`. Unpaid quotes count; tier purchases never appear; user deletion cascades and shrinks history; merged views cap at 300 rows per source and CSV at 5,000 silently; comments reference a removed `Payment` table.
8. ✅ **FIXED** — **CSV formula injection** in the transactions export (`escapeCsv` ignores leading `= + - @`; names and guest `holder.name` are attacker-controlled).
9. 🟡 **PARTIALLY FIXED** — **Anyone can push MoMo prompts to any MTN number.** Payer number ownership is never proven, there is no per-number throttle, CV downloads need no login, and limits are per IP (carrier NAT).
10. ✅ **FIXED** — **Production guards depend on `NODE_ENV`**, which the cookie code itself says is unreliable on Railway: secrets guard, `admin-register` disable, auto-migrate. `errorHandler` leaks stacks when `NODE_ENV=development` (the shipped backend example default).
11. ✅ **FIXED** — **Operator injection via request body in registration.** `rejectObjectQuery` covers only `req.query`; `registrationNumber`/`agentLicense` are unvalidated and used in `findFirst`. A `{"startsWith": ...}` body gives a 409/500 oracle over other users' registration numbers. Same fields are unvalidated in `PUT /users/me`; `website` has no scheme check (*verify* whether rendered as a link).
12. 🟡 **PARTIALLY FIXED** — **PII defaults.**
    - `UserDocument.isPublic` defaults true; non-CV public documents are streamable by any logged-in user.
    - `GET /users/candidate/:id` returns full public-document rows (with `fileUrl`) to any authenticated user, contradicting comments that CVs are shared only via job applications.
    - MoMo numbers are stored in plaintext with no retention policy; guest CV holder name/email/phone stored unvalidated.

**Notes on 7 to 12 (done):**
- **7:** the Revenue page (now "Platform Transactions") has a new *MoMo Payment* source read from `PaymentTransaction` (all statuses, so failed/refunded/needs-review show). Unpaid store, subscription and CV quotes are flagged `unpaid quote`. Both the list and the CSV now tell the admin when rows were cut off at the cap. *Still open:* merged paging is still in memory, and a real ledger table would be the root fix; MoMo-paid items still show in both a MoMo row and their record row.
- **8:** text cells starting with `= + - @` tab or CR get a leading `'`; plain numbers (including negatives) are untouched.
- **9:** at most 5 prompts per mobile number per hour (429 after that), across all accounts, devices and IPs. *Still open:* number ownership is not proven (an OTP or MoMo name check would be needed), and CV downloads still need no login.
- **10:** one `isProductionRuntime()` (NODE_ENV production **or** a Railway deployment) now drives the secrets guard, auto-migrate default, `admin-register` disable, farmer demo data, and stack-trace suppression.
- **11:** registration and `PUT /users/me` force `companyName`, `registrationNumber`, `agentLicense`, `agentType`, `website` and `businessDescription` to length-limited plain strings; `website` must be http(s).
- **12:** documents are now private by default (upload default and DB default; migration `20261022140000_document_private_by_default`, existing rows unchanged). `GET /users/candidate/:id` and the candidate search no longer return `fileUrl` or CVs. *Still open:* MoMo numbers are stored in plaintext with no retention policy; guest CV holder fields are unvalidated.

## Medium: logic that doesn't make sense

### Auth and login
- 🟡 **PARTIALLY FIXED** No change-password, email-change, self-delete or data-export endpoints. *Done:* `PUT /users/me/password` (proves the current password, ends other sessions, keeps this browser signed in), `GET /users/me/export` (JSON download, no secrets) and `POST /users/me/delete` (password + typing DELETE). Deletion anonymises the account instead of removing the row, because messages, reviews and payments point at it: personal data is wiped, login is closed, listings are hidden, financial records stay. It is refused for admins, and while a payment is in progress or a Webstore is active. All three are rate-limited. *Still open:* email change (needs a pending-email column and a confirmation email, so a migration) and the buttons for these in the account page (backend only).
- 🟡 **PARTIALLY FIXED** Registration reveals whether an email or phone is taken (409); login/resend/forgot are careful not to. Phones aren't normalised. *Done:* phones are stored as `+256XXXXXXXXX` (all Ugandan spellings match, older un-normalised rows are still found by the duplicate check), invalid numbers are rejected, and `PUT /users/me` now rejects a phone already used by someone else with 409 instead of a 500. *Still open:* the 409 on register is kept on purpose: removing it needs an email-confirmation sign-up flow, otherwise people cannot tell why sign-up failed.
- ⏸ **LEFT AS IS** Per-IP limits on register, forgot, resend and payment initiate, despite the code's own comment that carrier NAT is the norm. Payment initiate is already also capped per mobile number. Loosening or re-keying the others is a tuning decision for you (the risk is shared-IP users locking each other out).
- 🟡 **PARTIALLY FIXED** Login limiter keyed on `ip|email`: rotating IPs bypassed it for one admin. *Done:* added a per-account ceiling of 40 failed sign-ins per hour regardless of IP. Note it can also lock a victim out for that hour under sustained guessing, which is why it is set high. *Still open:* no 2FA.
- Free-trial farming via plus-addressing; phone optional; unlimited listings during trial.
- 🟡 **PARTIALLY FIXED** One refresh token per user: login anywhere kills the other session. *Done:* the admin login page sends `portal: 'admin'` and a non-admin is refused before any session is issued, so they are no longer logged out elsewhere. *Still open:* one session per user for everyone else; multiple devices need a separate sessions table.
- ✅ **FIXED** Admin portal showed a Register link in production while the endpoint 404s. *Done:* the link is hidden in production builds (set `NEXT_PUBLIC_SHOW_ADMIN_REGISTER=true` to show it).
- ✅ **FIXED** Refresh, reset and verification tokens stored in plaintext. *Done:* all three are stored as SHA-256 hashes (`utils/tokenHash.ts`). Tokens already in the database still work until they expire or rotate, so nobody is logged out by the deploy. No migration needed.
- ✅ **FIXED** Forgot-password enumerated accounts by timing and 503'd only for existing accounts. *Done:* forgot-password and resend-verification now reply with the same message at the same point whether or not the account exists, and create and send the token afterwards. A failed send is only logged, so a user whose email did not arrive just asks again.
- In-memory refresh grace replay hands a fresh token pair to anyone presenting the old token for 15s; not multi-instance safe.
- Access tokens can't be revoked on logout (up to 1h); sessions never time out, including admins.

### Payments
- ✅ **FIXED** `subscribeToPackage` creates a `PENDING_PAYMENT` row before number/MTN/duplicate checks. Failures leave orphans; the reconciler treats rows without payments as "manual flow" and never cleans them, blocking the user's next purchase. *Done:* if starting the payment fails before a payment row exists, the just-created request is cancelled.
- ✅ **FIXED** `detectMismatch` checked amount/currency only when MTN returned them. *Done:* a SUCCESSFUL status with no amount or no currency now goes to NEEDS_REVIEW instead of provisioning. `externalId` stays optional because some MTN environments do not echo it (the `referenceId` already ties the status to the row).
- ✅ **FIXED** A pending attempt with a wrong number couldn't be corrected for up to 5 minutes (silent "resume"). *Done:* paying again from a different number while a prompt is pending now returns 409 saying which number the prompt went to and roughly how many minutes until a new one can be sent. (Nothing can cancel a prompt already with MTN.)
- 🟡 **PARTIALLY FIXED** Tier purchases: listing status not re-checked at provisioning; paying for a listing still in moderation; Gold-to-Platinum charges full price with no credit. *Done:* only ACTIVE listings can be promoted, and provisioning re-checks the status (otherwise NEEDS_REVIEW). *Still open:* no credit for upgrades.
- ✅ **FIXED** `syncStoreListingsTier` wiped paid per-listing tiers on store activation and expiry. *Done:* a listing with a running paid tier (`tierExpiresAt` in the future) keeps it when it is at least as high as the tier being applied.
- ✅ **FIXED** Store term starts at application, not approval/payment; late review fails activation and needs a manual date edit. *Done:* approving a PENDING application starts the term now (`startDate=now`, `endDate=now+durationDays`) unless the admin sends an explicit `endDate`.
- ✅ **FIXED** Renewal end date fixed at request time, not payment time. *Done:* the new end date is computed when the renewal is confirmed.
- ✅ **FIXED** First store application isn't required to be paid before admin activation. *Done:* activating a paid, unpaid application returns 409 unless the admin sends `allowUnpaid: true` (the admin Webstores page asks and retries).
- ✅ **FIXED** `POST /store-rentals` promoted the role before KYC/duplicate checks; role lists disagreed. *Done:* the role change now happens only after the KYC, duplicate-application and free-package checks pass; the route uses the same seller-role list as the service (SELLER included); BUYER/SELLER/USER applicants default to AGENT instead of getting a 400. The 3-zone cap now also applies when applying, not only on later edits.
- ✅ **FIXED** (one part not reproduced) Docs vs code. *Done:* the `subscribeToPackage` comment now matches `startsActiveImmediately`; the pending-payment card says "payment is confirmed" instead of "an admin confirms"; the 410 message no longer mentions a CV subscription. *Not reproduced:* I could not find code that closes the manual reference-and-admin flow when MoMo is off (`subscribeToPackage` still accepts a payment reference), so the docs are accurate as far as I can see; tell me where you saw it close if you still do.
- 🟡 **PARTIALLY FIXED** Admin can approve a paid subscription or set a tier with no `PaymentTransaction` link; `endDate` on approve isn't checked for the past. *Done:* an `endDate` sent with an approval must now be in the future (approval already records `approvedById` and the admin note). *Still open:* manual approvals are still not linked to a `PaymentTransaction`.
- IMMEDIATE upgrades cancel the old plan with no credit.
- ✅ **FIXED** Store Owner package matched by `startsWith('Store Owner')`. *Done:* exact match on `STORE_OWNER_PACKAGE_NAME` in the reminder logic and the admin alerts.
- ⏸ **LEFT AS IS** `/payments/config` reveals sandbox vs production. The pay modal uses it to show a visible "sandbox" banner so nobody pays real money into a test setup; it exposes nothing exploitable. Say if you want it removed.
- ✅ **FIXED** Callback signature (query string) and CV `rawToken` (`/validate?rawToken=`) are logged by `morgan 'combined'`. *Done:* the access log redacts `s`, `sig`, `signature`, `rawToken`, `token` and `code` query values, and CV `/validate` is now POST.

### Admin site
- ✅ **FIXED** Admin-approval audit was a Notification row the promoted admin could delete; promoting via `PUT /users/:id` wrote no audit. *Done:* new append-only `AdminAuditLog` table with no foreign keys (migration `20261022160000_admin_audit_log`). Both promotion routes write to it in the same transaction, as do role, ban and verify changes made through `PUT /users/:id`. The audit list reads the new table first and then older notification rows.
- ✅ **FIXED** One admin can ban, demote or delete the other admins; no last-admin or peer protection. *Done:* admins can no longer change or delete another admin through the admin API.
- ✅ **FIXED** Admin cap check was racy and the "3" was hardcoded in three places. *Done:* one `MAX_ADMINS` constant, and `PUT /users/:id`, `approve-admin` and `admin-register` now count and write inside one transaction holding a Postgres advisory lock.
- ✅ **FIXED** Users page could toggle `isVerified` (email verification), which locks users out of login. *Done:* the API refuses `isVerified: false` (an admin can still confirm an account by hand, or ban it).
- ✅ **FIXED** Owners can reactivate moderator-hidden listings (`HIDDEN → ACTIVE` allowed), defeating the stated purpose of `listingStatus.ts`. *Done:* new `Listing.hiddenByModerator` flag (migration `20261022150000_listing_hidden_by_moderator`; existing HIDDEN rows count as moderator-hidden). Owners can un-hide only what they hid themselves.
- ✅ **FIXED** Edit-after-approval swap: re-moderation only on text changes, only if an LLM is configured. *Done:* independent of any LLM, an owner edit to a live listing that changes the category, moves the price by 50% or more, or replaces every photo sends it back to the review queue. Wording edits, small price changes and added photos stay live.
- ✅ **FIXED** Placement zones ignored the "max 3 zones" setting; each call re-extended 30 days. *Done:* the 3-zone cap is enforced on application as well as on later edits, and re-saving a placement a listing already holds no longer pushes its end date out another 30 days.
- ✅ **FIXED** `GET /stores` loaded up to 2,000 full rows into memory to sort. *Done:* it ranks using only light sort keys (id, pin order, date, owner), then loads full rows for just the requested page. The 2,000 cap is gone (safety limit 20,000 keys). Response shape is unchanged.
- ✅ **FIXED** `/store-rentals` public list returns raw rental rows including `fee` and `placements` (`paymentRef`, `paidAt`). *Done:* explicit field whitelist.
- ✅ **CHECKED, NO CHANGE** `DEFAULT_TIER_PRICING` in `admin.ts` holds only `null` prices and `UGX`, so there are no built-in prices; an unset tier is simply not offered. It matches the MoMo docs.
- ✅ **FIXED** Admin pagination: `parseInt` without a default gives NaN and fails the query. *Done:* shared `parsePaging` helper on all admin list routes.

### Ops
- 🟡 **PARTIALLY FIXED** `docker-compose.yml` publishes Postgres on host port 55432 with a default password fallback. *Done:* bound to 127.0.0.1. *Still open:* the default password fallback (dev convenience, and the port is now localhost-only). Production should set `POSTGRES_PASSWORD`; I left the fallback because removing it would break `docker compose up` for local setups.
- ⏸ **LEFT AS IS** `uncaughtException` is swallowed and the process keeps running. Deliberate in the code (stray stream errors); exiting would turn those into outages, so this needs a decision from you.
- 🟡 **PARTIALLY FIXED** Every instance runs the same cron jobs and startup migrations. *Done:* the listing-expiry, tier-expiry, renewal-reminder, lifecycle and payment-reconciler jobs now run under a Postgres advisory lock (`utils/jobLock.ts`), so with several instances only one runs each tick and reminders are not duplicated. *Not changed:* startup migrations (`prisma migrate deploy` serialises itself, but the extra hotfix steps in `scripts/db-setup.ts` are not locked; fine for one instance, worth a look before scaling).
- `/admin/*` has no edge protection, only client guards plus correct API checks.

## What's done well
- Core MoMo design: server-derived amounts, ownership checks, idempotent leased provisioning, reconciler.
- Live ban/role re-check on every authenticated request.
- Constant-time comparisons and type checks on reset/verify bodies.
- KYC image access control.
- Subscription snapshots so package edits can't reprice a running plan.

## Frontend UI work: top navigation, MoMo checkout, homepage rows

Scope: `CategoryBar`, `MomoPayModal`, and the homepage listing rows. Checked with `tsc --noEmit` (clean) and ESLint on the changed files, and confirmed Tailwind generates the new width classes. **Not checked in a browser or on a real phone**, so the *verify* items below need a quick look.

### Top navigation
- ✅ **FIXED** Top category bar text was 10.5 to 11px with 2px vertical padding, hard to read and hard to tap. *Done:* text 12.5 to 13px, taller tap area (`py-2`, `px-3`), larger icons (15px), thicker active underline, larger count badges (10px), and larger mega-menu headings and links. Same sizes in the loading fallback.
- ✅ **FIXED** The centred scroll row could cut off the first tabs on narrow phones once the tabs got bigger. *Done:* left-aligned and scrollable on phones, centred from `md` up.
- ⏸ **LEFT AS IS** The main header row (logo, search, account) was not resized; only the category strip you called "navigation at the top" was. Say if you want the header row scaled too.

### MTN MoMo payment screen (modelled on betPawa / FortebET mobile-money checkout)
- ✅ **FIXED** Network picker: **MTN MoMo** is selected; **Airtel Money** is shown greyed out with a *Coming soon* label and cannot be chosen.
- ✅ **FIXED** Amount card, fixed **+256** prefix with a 9-digit number field (typing `0772...`, `256772...` or `772...` all work), a 3-step progress strip (Enter number, Approve on phone, Done), and a Pay button that stays disabled until the number is valid.
- ✅ **FIXED** Waiting screen: shows the masked number and timer, and a *Did not get the prompt?* box (dial `*165#`, open Approvals) plus a warning not to approve or pay twice. The existing polling, late-approval and duplicate-payment behaviour is unchanged.
- ✅ **FIXED** Airtel-looking numbers (070, 074, 075) are flagged inline before any request is sent; the backend already rejects non-MTN prefixes outside the sandbox.
- ✅ **FIXED** Sandbox mode keeps a free-form number box (test numbers are not Ugandan), so testing still works.
- ⏸ **UNFINISHED: Airtel Money payments.** Only the *Coming soon* placeholder exists. There is no Airtel backend (client, callback, reconciler, status mapping) and no `AIRTEL` payment provider. This is a separate integration.
- 🟡 *verify* The `*165#` > Approvals wording follows public MTN Uganda guides; menu option numbers vary, so the text names the menu rather than a number. Confirm it with MTN's current flow.
- 🟡 *verify* `MomoUnavailableModal` and the CV and subscription pages still say "MTN Mobile Money" in their own copy; only the shared modal was redesigned.

### Homepage rows
- ✅ **FIXED** Flash Deals cards were oversized on phones. *Done:* new `compact` mode for `ListingCard` and `FeaturedProductCard` (smaller padding and type; description, store line and "Listed at" note hidden below `sm`), and a fixed 3-across layout on phones.
- ✅ **FIXED** Flash Deals on larger screens is now **one row** (4, 5, then 6 across) with the **View all** link and **back/forward arrows**.
- ✅ **FIXED** **Browse by category** (tablet and desktop) is now one row with **View all** and back/forward arrows; 11 categories scroll instead of wrapping into two rows.
- ✅ **FIXED** Back/forward arrows added to every other homepage row: Today's Deals, Farm Produce, Back to School, Trusted Sellers, Latest Motors/Electronics/Property/Fashion, Latest Collections and Featured Deal. One shared component (`RowCarousel`) replaces the old phone-only `MobileCardCarousel` (deleted). Arrows show on all screen sizes, hide at each end, and hide when everything fits.
- ✅ **FIXED** **Other Collections** was left as a normal grid with no arrows, as requested.
- ✅ **FIXED** Rows now load 12 items instead of 6 (homepage server fetch and client refetch), otherwise desktop rows of 6 would have nothing to scroll.
- ⏸ **LEFT AS IS** The phone **Browse by category** grid (4 x 2 icons) is unchanged; your request was for larger screens.
- ⏸ **LEFT AS IS** Category and `/listings` pages keep their own grids (not homepage rows).
- 🟡 *verify* Check Flash Deals at 360px, 390px, tablet and desktop widths, and with 1, 3 and 12 listings, to confirm card size and arrow behaviour.
- ✅ **FIXED** One existing type error in `app/admin/users/page.tsx` (nullable email passed to `title`) that would have failed `next build`.

## Merge: offers, push/WhatsApp, category navigation, CI (from `all_1_unique_merge_changes.zip`)

Source: the 67-file merge and its `CHANGES.md` (kept in the project as `CHANGES_all_1_merge.md`). It was built on the original `all_1` code, so it did not contain the work done since (MoMo payment screen, receipts, homepage cards, slideshow dots, Services/Classifieds tiles).

### How it was combined
- ✅ **ADDED (24 new files, copied as they were):** price offers (backend routes and logic, offer dialog, chat offer cards, owner switch), Web Push and WhatsApp delivery with the 15-second dispatcher, the alert settings card, `sw.js`, suggestion limits, the navigation tests, and `lib/offers.ts`, `lib/push.ts`.
- ✅ **TAKEN FROM THE MERGE (additive only, nothing of mine lost):** `app.ts`, `index.ts`, `routes/messages.ts`, the messages and notifications pages, `ListingDetailClient`, `types.ts`, `next.config.mjs`, `.dockerignore`, `ci.yml`, frontend `package.json` and lockfile.
- ✅ **ALREADY IN THE CODE (24 files, identical):** the category navigation overhaul, photo-mismatch check, and listing grid changes.
- ✅ **KEPT MINE (5 files where my later work is newer):** `ListingCard` (equal card sizes), `RowCarousel` (fixed card widths), `HomeCategoryTiles` and `MobileCategoryGrid` (Services and Classifieds always shown), `listings/create/page.tsx` (no reload while the form is on screen). The only differences in these five were my later changes.
- ✅ **MERGED BY HAND:** `schema.prisma` (their offers/push tables plus my receipt columns), `.env.example` (their VAPID/WhatsApp block plus my go-live block), backend `package.json` and lockfile (both `web-push` and `pdfkit`, regenerated and `npm ci` works).
- ✅ Migrations apply in order from an empty database: 46 in total, the offers/push one before my receipts one.

### Verified on the merged tree
- ✅ Backend: typecheck clean; **238 unit tests** and **123 integration tests** (real PostgreSQL) pass (their 234 and 116 plus my 4 and 7).
- ✅ Frontend: typecheck clean, lint clean across the whole project, **33 navigation tests** pass, production build passes (103 pages).
- ✅ **Offers clicked through in a real browser** (production build, real backend, real database), which the merge notes said had not been done: buyer sees "Make an offer" on a 360px phone; a too-low offer is rejected with a message; a valid offer lands the buyer in the chat; the listing then shows the open-offer strip instead of the button; the seller gets a notification and sees Accept / Counter / Decline; the counter-offer is delivered; the buyer accepts. No page errors. Screenshots `26` to `32`.
- ✅ The alert settings card stays hidden until push/WhatsApp is configured (checked).
- 🟡 *verify* A first run in the development server bounced back to the listing page after sending an offer (the dev server's "Fast Refresh" reload). It did not happen on the production build, so it is a development-only quirk, but watch for it if you test with `npm run dev`.
- 🟡 *verify* Not tested here (needs real accounts and devices): real browser push on Chrome, Firefox and Safari; real WhatsApp messages (templates must be approved in Meta first); the four-button mobile sticky bar while scrolling (the contact card on a 360px phone was checked).
- 🟡 *verify* The merge's own end-to-end offer and push scripts (114 checks) were not in the zip, so only their unit and integration tests were re-run.

### Still to do on your side (from the merge notes)
1. Run `prisma migrate deploy` (and `prisma migrate dev` once to confirm no drift).
2. To turn on browser push: `npx web-push generate-vapid-keys`, then set the three `VAPID_*` variables.
3. To turn on WhatsApp: set the two credentials and get both templates approved (exact shapes are in `.env.example`).
4. Optional: add a PNG notification icon (some Android devices do not show the SVG).
5. Behaviour choices to review: 48-hour offer expiry, 10% minimum offer, 24-hour re-offer wait, WhatsApp limits (20 a day, one chat alert per 30 minutes). All are constants in `utils/priceOffers.ts` and `utils/notificationDispatch.ts`.

## MoMo: digital receipts, profile copy, page refresh, and sandbox-to-live path

Checked three ways: unit tests (4 files, 40 tests), integration tests against PostgreSQL with a fake MTN (5 files, 78 tests, 7 of them new for receipts), and a **full browser run through the real backend** (browser, Next.js, the actual Express app, a fake MTN sandbox, PostgreSQL, and a local mail catcher). `tsc --noEmit` is clean on both sides. Screenshots `22` to `25`.

### What happens now after a successful payment
- ✅ **FIXED / NEW** Once a payment is SUCCESSFUL **and** access has been granted, the server issues a **receipt with a unique tracking code** (live: `PTR-XXXX-XXXX-XXXX`, sandbox: `TST-XXXX-XXXX-XXXX`; 12 characters with no look-alikes such as 0/O/1/I/L; unique in the database). Issuing is race-safe and happens once, however many callers arrive together (callback, polling, background job, admin grant).
- ✅ **NEW** **PDF receipt** (pdfkit): Piitrade header, tracking code, PAID badge, item, payer name and email, masked phone number, method, date and time (EAT), MTN transaction ID, payment reference, total, and a verify link. Sandbox receipts carry a TEST banner and watermark so they can never pass as real ones. The PDF is rebuilt from the payment record on demand, so it always matches the ledger.
- ✅ **NEW** **Emailed to the payer** with the PDF attached (Resend or SMTP). A failed email never affects the payment; the background job retries up to 5 times (verified).
- ✅ **NEW** **Copy stays on the profile**: Profile now has a *Payment receipts* section (code with copy button, amount, date, TEST badge, emailed status, **PDF download**, **Email me** again). Older paid payments get their receipt the first time the profile is opened (no email sent for those).
- ✅ **NEW** **Public verification**: `/receipts/verify` (also `?code=`) confirms a code is genuine and shows only item, amount and date, never names or phone numbers; rate limited. Typing the code in lower case or without dashes works.
- ✅ **FIXED** **Page refresh after success**: the success screen shows the receipt code and a PDF download; the page data is re-fetched immediately and the page **fully reloads when the payer presses Done**, so the plan, tier or store state is current. Verified in the browser run. Two flows opt out on purpose: buying a subscription (it sends the payer on to "post a listing" itself) and the listing-tier payment on the post form (a reload would lose the on-screen form).
- ✅ **FIXED** All three progress steps now tick on the success screen.
- ✅ **VERIFIED** Browser run: payment, approval on the "phone", receipt code on screen, downloaded PDF contains the same code and amount, the captured email has the PDF attached with the same code, page reloaded on Done, profile lists the receipt, verify page says genuine, a made-up code is rejected.
- ⏸ **LEFT AS IS** Guest CV-download payments (no account) get a tracking code but no email, because there is no address on file.
- 🟡 *verify* Receipt email wording and the PDF layout are designed by me; check them against your branding and any tax or invoicing requirements (the receipt is not a VAT invoice; there is no tax line or TIN).
- 🟡 *verify* Real email delivery was tested with a local mail catcher, not Resend or your SMTP. Send one real receipt to yourself.
- ⏸ **UNFINISHED** Admin ledger does not yet show the receipt code column or a "resend" button; support can search by code through the database for now.

### Upgrading the sandbox to live
The switch is configuration only; no code changes. Everything below was already enforced by the config loader, which refuses to run with sandbox values in production, a non-https callback, a short secret, or a currency other than UGX.
- ✅ **NEW** `npm run momo:live:check` (run with `MTN_ENVIRONMENT=production`): a pre-flight that **moves no money**. It checks the production configuration, gets an access token with your production credentials, reads the collection balance, confirms an email provider and `FRONTEND_URL`, and confirms the database has the receipt columns. It prints **GO** or **NO-GO** with reasons (checked: it correctly reports NO-GO with missing values).
- ✅ **NEW** `.env.example` now has a step by step "GOING LIVE" block.
- ✅ **VERIFIED** Sandbox and live payments are kept apart: each payment records its environment, and sandbox receipts are always `TST-` and marked TEST, so test data cannot be mistaken for real receipts after you switch.
- ⏸ **YOURS TO DO** Production credentials come from MTN after their onboarding (the Collections product plus a production API user and key; the sandbox provisioning script deliberately refuses to create them). Then: set the production values, a public https `API_BASE_URL`, a 32+ character `MTN_CALLBACK_SECRET`, an email provider and `FRONTEND_URL`; run `momo:live:check` until it says GO; make **one small real payment yourself** and check the receipt email, PDF and profile copy.
- 🟡 *verify* The production gateway address (`https://proxy.momoapi.mtn.com`) and target value (for example `mtnuganda`) must be confirmed against MTN's onboarding pack.
- 🟡 *verify* Existing sandbox payments stay in the database labelled sandbox; decide whether to keep them (they do no harm) or clear them before launch.
- ⏸ **UNFINISHED** Airtel Money payments (placeholder only).

## Homepage: Services and Classifieds tiles, slideshow dots, equal cards

Checked in a real browser against sample data at phone, tablet and desktop widths (screenshots `15` to `21`), plus `tsc --noEmit` and ESLint (clean).

### Services and Classifieds missing under "Back to the good deals"
- **Verified: they were missing, by design of an old rule, not by accident.** The home tiles hid any category with 0 live listings, so Services and Classifieds disappeared whenever nothing was posted in them (as in the sample data).
- ✅ **FIXED** Both tiles now always show on the phone grid and the tablet/desktop row (`alwaysShow` in `lib/homeCategories.ts`). With no listings they read "No listings yet" instead of a count, and link to their pages as before. Other categories keep the hide-when-empty rule.
- 🟡 *verify* Their pages (`/services`, `/classifieds`) will be empty until someone posts; decide whether those pages need an empty-state "Post the first ad" prompt.

### Slideshow dots
- ✅ **FIXED** Clicking a dot did nothing until that slide's image had loaded; now every dot works immediately.
- ✅ **FIXED** The dots were tiny, nearly invisible on light images, and had a very small tap area. They now sit on a dark pill, each has a 24px tap area, and failed slides are dimmed and disabled.
- ✅ **FIXED** The current slide's dot is wide and fills over the time left before the next change (stops for reduced-motion users), and is marked as the current item for screen readers ("Slide 2 of 4" is also announced).
- ✅ **FIXED** The auto-advance clock restarted every time an image loaded. It now restarts only when the slide changes, so a manual change always gets a full interval. All slides load up-front so arrows and dots never land on an empty slide.
- ✅ **FIXED** Pause on hover or keyboard focus (desktop). Touch taps do not pause, so phones do not freeze on the slide after a dot is tapped (verified: it moved on after about 5 seconds).

### All listing and ad cards equal
- ✅ **FIXED** Card width is now fixed per screen size, not a share of whatever row it sits in. Before, Flash Deals, Back to School and Today's Deals sit in padded panels and came out narrower than the other rows.
- ✅ **FIXED** `ListingCard`, `FeaturedProductCard` and the Today's Deals tile share the same image shape, text-area height and price position (price pinned to the bottom).
- ✅ **VERIFIED** Measured on the page: every card in every carousel is 112 x 201 px on a phone, 160 x 297 px on a tablet and 184 x 295 px on desktop, in all ten sections (Flash Deals, Today's Deals, Farm Produce, Back to School, Latest Motors/Electronics/Property/Fashion, Latest Collections, Featured Deals).
- ⏸ **LEFT AS IS** The "Other Collections" grid (2 per row on phones, larger cards for readability) and the Trusted Sellers store cards keep their own sizing; they are a different layout, not a carousel.
- 🟡 *verify* Cards have a minimum text height, so a listing with unusually many stamps (Gold plus year plus mileage plus store) can still grow its row taller. Check with your most crowded real listing.

## MTN MoMo backend and sandbox: audit

Audited in `eni.zip` (`backend/`). Result: **the backend exists and is wired in; nothing had to be built.** It could not be run against MTN's real sandbox from here (no internet access to `sandbox.momodeveloper.mtn.com`), so that one step is yours.

- ✅ **EXISTS** Config with sandbox mode (`utils/momo/config.ts`): off unless `MTN_ENABLED=true`; defaults to the **sandbox** (`https://sandbox.momodeveloper.mtn.com`, target `sandbox`, currency EUR as MTN's sandbox requires); refuses to start with placeholder keys, a non-UUID API user, or sandbox values mixed with production.
- ✅ **EXISTS** MTN client (`client.ts`): token from `/collection/token/`, `requesttopay` with a fresh reference per attempt, status lookup, callback URL header.
- ✅ **EXISTS** Routes (`routes/payments.ts`, mounted at `/api/payments`): `GET /config` (tells the frontend whether MoMo is on and if it is the sandbox), `POST /momo/initiate` (rate limited), signed `POST /momo/callback/:referenceId`, `POST /:id/status`, plus admin list, verify and resolve.
- ✅ **EXISTS** Payment service (`paymentService.ts`), a 30 second reconciler started at boot (`index.ts`), the `PaymentTransaction` table with its migrations, and CV-download payment switched to server confirmation when MoMo is on.
- ✅ **EXISTS** Sandbox tooling: `npm run momo:sandbox:provision` creates the API user and key from your subscription key; `npm run momo:sandbox:check` verifies them; a local mock MTN server (`testing/mockMtnServer.ts`) backs the integration tests.
- ✅ **VERIFIED** 36 MoMo unit tests pass (client, config, rules). The number format the new payment screen sends (`256` plus 9 digits) is accepted for MTN prefixes 077/078/076/039 and rejected for Airtel (075), matching the screen's Airtel warning. Sandbox test numbers are accepted because the server is lenient in sandbox only.
- ✅ **VERIFIED (against MTN's sandbox rules, not MTN itself)** The four MoMo integration test files ran against a real PostgreSQL 16 with all 46 migrations applied: **4 files, 71 tests, all passed** (wire, payments, routes, reconciler). The real MTN client talks HTTP to a local server that enforces MTN's documented sandbox contract. Covered: token fetched once and reused, refreshed once when MTN revokes it; account check before the prompt; request-to-pay, approve and status, then access granted; a declined prompt arrives as FAILED with a plain-language reason; an inactive MoMo number is stopped before any prompt; wrong credentials leave no payment stuck PENDING and leak nothing; the sandbox provisioning script; the background reconciler settling a payment nobody polled and no callback reached, and two overlapping runs never double-crediting. (Log noise about "email delivery not configured" is expected in tests: no SMTP is set, so activation emails are only logged.)
- 🟡 *verify* **Not run: a payment against MTN's real sandbox** (`sandbox.momodeveloper.mtn.com` is unreachable from here). Do the "go live in the sandbox" steps below once with your own subscription key and a sandbox test number.
- 🟡 *verify* The new payment screen was tested in a browser against a mock payments API, and the backend was tested separately as above. The two were not run together end to end (browser, then backend, then MTN stand-in); one real sandbox payment from the deployed site covers that.
- ⏸ **TO DO (yours): go live in the sandbox.** In `backend/.env`: set `MTN_SUBSCRIPTION_KEY` (Collections product, from momodeveloper.mtn.com), run `npm run momo:sandbox:provision`, put the printed `MTN_API_USER` and `MTN_API_KEY` in, set `MTN_ENABLED=true`, then `npm run momo:sandbox:check`. Set `API_BASE_URL` (or `MTN_CALLBACK_URL`) to the backend's public https address if you want callbacks; otherwise it falls back to polling only.
- ⏸ **UNFINISHED: Airtel Money backend.** Only the "Coming soon" screen exists; there is no Airtel client, routes or provider value yet.
- 🟡 *verify* Production base URL (`https://proxy.momoapi.mtn.com`) and the target value (`mtnuganda`) should be confirmed against MTN's onboarding pack before going live.

## Image mismatch detection: every posting flow (priority item)

Applied on the `eni.zip` snapshot. Checked with `tsc --noEmit` and ESLint (clean) and driven in a real browser against a mock backend and mock image-AI service (sample photos, not the live classifier). Screenshots: `screenshots/5` to `screenshots/8`.

### Audit: was detection implemented?
| Flow | Before | Now |
|---|---|---|
| Main posting form `/listings/create` | Only at Post (and only badges/banner earlier); never asked the seller anything | ✅ **FIXED** checks right after photos upload, and again at Post if not yet confirmed |
| Farm produce quick-post `/listings/create-produce` | ❌ none | ✅ **FIXED** per product, on upload and again at submit |
| Admin bulk-post `/admin/bulk-post` | ❌ none | ⏸ **UNFINISHED** (see below) |
| Backend (listing create / upload routes) | ❌ none | ⏸ **UNFINISHED** (see below) |

### What was done
- ✅ **FIXED** One shared check, `lib/photoMismatch.ts`: compares each photo with the first photo, caches results per photo, and fails open (service down or one photo unreadable means no block).
- ✅ **FIXED** Popup (`PhotoMismatchModal`) shows the first photo next to each flagged photo, tap to zoom, with **Remove flagged photos**, **These photos are correct**, and **Go back**. Wording differs for upload-time ("keep") and Post-time ("continue"), and names the product on the bulk produce form.
- ✅ **FIXED** No nagging: a confirmed or clean photo set is not re-checked; closing the popup without deciding does not reopen it until the photos change. Editing an existing listing does not pop the warning until the seller adds photos.
- ✅ **FIXED** Post/submit is held while photos are being checked ("Checking photos…") and cannot go through with an unanswered mismatch. Verified on the produce form: 0 listings posted until the seller confirmed, then exactly 1.
- ✅ **FIXED** Bug found by the browser test: on phones the bottom navigation covered the popup's buttons on the main form. The popup is now rendered at the page root (above all page layers).
- 🟡 *verify* Tested with a mock image service whose labels depend on file names. Run a real posting against the live image-AI worker with a genuinely wrong photo and a genuinely matching one.

### Still unfinished
- ⏸ **UNFINISHED: admin bulk-post.** Photos are local files until publish and the image service can only read hosted URLs, so it needs a pre-upload step first, then the same popup.
- ⏸ **UNFINISHED: server-side check.** All checks run in the browser and can be bypassed with a direct API call. A server check would need the listing-create route to classify uploaded photos (and a decision on whether to block or only flag for the admin review queue).
- ⏸ **UNFINISHED: stronger matching.** The detector compares classifier labels, so an unusual angle or an accessory close-up can be flagged wrongly (the popup lets the seller overrule it), and two different items with overlapping labels can pass.
- ⏸ **UNFINISHED:** the popup text is English only; the produce form's other text is translated.
- ⏸ **UNFINISHED:** the produce form has no way to remove a photo except through this popup.

## Homepage alignment check (phone, tablet, desktop)

Checked on `eni` with sample listings at 390, 768 and 1280 px: no sideways scrolling and no arrow outside the screen at any of them.
- ✅ **FIXED** Carousel arrows poked past the screen edge at tablet width (768px). They now sit inside until `lg`.
- ✅ **FIXED** Cards in one row had different heights on phones. They now fill the row height with the price pinned to the bottom.
- ✅ **FIXED** Small cards showed three overlapping badges. On phones they now show one badge, a smaller heart, and hide the verified pill and extra stamps (full set from `sm` up).
- ✅ **FIXED** Farm Produce was indented more than the other sections and its header squeezed on narrow phones.
- 🟡 *verify* 360px and large 1536px desktop were checked earlier on the previous snapshot only; look once on a real phone.

## Posting: photo mismatch warning

Scope: the image detector on the create/edit listing page (`app/listings/create/page.tsx`, new `components/listings/PhotoMismatchModal.tsx`). Checked with `tsc --noEmit` and ESLint (clean). Screenshots are in `screenshots/`.

**What existed before:** photos 2+ were compared with photo 1 using the image-AI classifier (`lib/categoryMatch.ts`), but only after the seller had run AI analysis, and the result was a small red badge and a text banner. It never stopped or asked anything, so a seller who skipped "Auto-fill" was never warned, and a warned seller could post anyway without looking.

- ✅ **FIXED** Pressing **Review & Post** with 2 or more uploaded photos now runs the check itself, whether or not AI auto-fill was used. Photos already checked are not re-sent.
- ✅ **FIXED** If a photo looks unrelated, a **popup shows the photos** (first photo as the reference, each flagged photo marked "NO MATCH", tap to zoom) before the review step. The seller must choose: **Remove flagged photos**, **These photos are correct, continue**, or **Go back and review photos** (Esc also goes back).
- ✅ **FIXED** Confirming "correct" is remembered for that exact photo set, so the seller is not asked again on the next press; adding, removing or replacing a photo asks again.
- ✅ **FIXED** The button shows **Checking photos…** while the check runs, and the per-photo MATCH / UNMATCHED badges now appear in manual mode too (they were AI-mode only).
- ✅ **FIXED** The popup works on phones (bottom sheet) and desktop (centred), checked at 390px and 1280px. A first mobile layout had the flagged photos squeezed to slivers; the screenshots caught it and it is fixed.
- 🟡 **PARTIALLY FIXED** The warning is advisory, not a hard block, on purpose: the detector is a keyword comparison of classifier labels, not true image similarity, so angle changes and close-ups of accessories can be flagged wrongly. *Still open:* a server-side check at submit (the browser step can be bypassed with a direct API call), and a stronger similarity model.
- 🟡 **PARTIALLY FIXED** It fails open: if the image-AI service is down or a photo cannot be classified, the listing is not blocked. *Still open:* the service is an external Cloudflare Worker (`NEXT_PUBLIC_IMAGE_AI_URL`, with a hard-coded default URL), which should be confirmed or replaced before relying on this.
- 🟡 *verify* Screenshots show the popup in a temporary test page with sample drawings (removed afterwards), not the live form: the live form needs a signed-in seller, the backend and the image-AI worker. Please run one real posting with a mismatched photo (for example a phone photo on a laptop listing) and one with matching photos.
- ⏸ **LEFT AS IS** Edit mode uses the same check; existing listings are not re-checked unless the seller presses Review & Save.

## Progress
Fixed: 1, 2, 3, 5, 6, 8, 10, 11. Partially fixed: 4, 7, 9, 12. Medium list: five batches done (see the items marked above). A regression from batch three was found and fixed in batch four: the admin-cap check had been added to public `/register` instead of `/admin-register`, which would have blocked all sign-ups once three admins existed. Still open in the medium list: email change, trial farming via plus-addressing, the in-memory refresh grace replay, access-token revocation and session timeouts, upgrade credit, one session per user, 2FA, the unlocked startup hotfixes, edge protection on `/admin/*` (an infrastructure setting, not code), and linking manual approvals to a `PaymentTransaction`. Frontend UI batch (navigation, MoMo checkout, homepage rows): done except Airtel Money payments (placeholder only) and a browser check. Code changes are untested: `prisma generate` was blocked in the build sandbox, so run `tsc --noEmit` and the integration tests before deploying. Next: the items listed as still open above; trial farming and access-token revocation each need a schema change.

## Suggested fix order
1. Findings 1 to 3 (store state and activation).
2. Findings 5 and 6 (duplicate payments and ledger), before enabling MoMo in production.
3. Finding 4 (CV gating): needs server-side rendering or a redesign.
4. Findings 7 to 12.
5. The medium list.
