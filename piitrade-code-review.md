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
