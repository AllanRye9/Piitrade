# Backend work: subscriptions, preferences, admin alerts, inbox, category counts, store activation

All changes are **additive and backward compatible** with the current frontend (existing response
fields are unchanged; new fields/endpoints are extra). One new migration, purely additive:
`20261017090000_subscription_lifecycle_prefs_counts` (two columns on `SellerSubscription`, one on
`User`, three indexes). Verified end-to-end against a real PostgreSQL: 39 integration tests
(`npm run test:integration`) + 123 unit tests.

## 1. Subscription management

Two systems, one model of "what you may do right now" (`utils/subscriptionService.ts`):
*Web Store owners* → `StoreRental` (see §6); *ordinary users* → `SellerSubscription`.

**Real time:** access is decided from the dates at the moment of the request, never from a status
column a job has to keep fresh. A subscription past its `endDate` stops granting access that second;
GET endpoints never write. A 5-minute sweep (`utils/lifecycleJobs.ts`) then flips the stored status,
notifies the owner (once), sends one "ending soon" reminder (≤3 days left) and freezes lapsed stores.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/packages/:id/subscribe` `{paymentRef?}` | user | Free → `ACTIVE`. Paid LISTING → `PENDING_PAYMENT` until an admin confirms. Atomic (6 simultaneous calls ⇒ 1 row). A free package can be taken **once per account**. `201 {subscription}` |
| `GET /api/packages/my-subscription?scope=LISTING\|CV` | user | `{subscription, pending}`. `subscription` = the one currently granting access (adds `status, isCurrent, daysRemaining`) or `null`; `pending` = awaiting-payment request. |
| `GET /api/packages/my-subscriptions?page&limit` | user | Full history, newest first, each with effective `status` (+ `storedStatus`). |
| `GET /api/packages/my-entitlements` | user | `{listing:{source:'STORE'\|'SUBSCRIPTION'\|'ORDINARY', maxListings (null=unlimited), used, remaining, expiresAt, daysRemaining, label}}` |
| `POST /api/packages/subscriptions/:id/renew` `{paymentRef}` | user | Paid only. Creates a `PENDING_PAYMENT` term that **starts when the current one ends** (no paid days lost). |
| `POST /api/packages/subscriptions/:id/cancel` | user | Ends access immediately (no auto-renewal exists). |
| `GET /api/admin/subscriptions?status&scope&page` | admin | `status=ACTIVE` excludes lapsed rows; `EXPIRED` includes them (real time). Rows carry `daysRemaining`. |
| `PUT /api/admin/subscriptions/:id` `{status?, endDate?}` | admin | Validated status machine (see below). Confirming a `PENDING_PAYMENT` chains after the current term. |
| `POST /api/admin/subscriptions/run-expiry` | admin | Run the sweep step now. |

Status machine: `PENDING_PAYMENT → ACTIVE \| CANCELLED`, `ACTIVE → EXPIRED \| CANCELLED`; admins may
also revive `EXPIRED/CANCELLED → ACTIVE` with a future `endDate`.

**Enforcement:** `POST /api/listings` caps live listings by entitlement — active store (rental
`maxListings`) → current subscription (package `maxListings`, null = unlimited) → ordinary baseline
(`ORDINARY_USER_MAX_LISTINGS`, default 10).

## 2. `/profile/listings` column preference
`GET /api/users/me/preferences` → `{preferences:{listingColumns:number|null}}`;
`PUT /api/users/me/preferences {listingColumns: 1-6 | null}` (null = site default; 400 otherwise).
Also returned as `listingColumns` on the user object from `/users/me`, so first paint needs no extra
call. Enforced by the API **and** a DB `CHECK` constraint.

## 3. Admin alerts / animations — `GET /api/admin/alerts[?since=<ISO>&activity=<n≤30>]`
Poll every 10–30 s. Sends `ETag`; reply with `If-None-Match` to get `304` when nothing changed.
```jsonc
{ "serverTime": "...", "since": "...|null",
  "totals": { "pending": 7, "newSince": 2, "overdueQueues": 1, "severity": "none|info|warning|critical" },
  "queues": [ { "key": "listings", "label": "...", "href": "/admin/listings", "count": 3,
                "newSince": 2, "oldestAt": "...", "overdue": true, "severity": "critical", "pulse": true } ],
  "watch": { "expiringStoreRentals7d": 1, "expiringSubscriptions3d": 0 },
  "activity": [ { "type": "listing", "id": "...", "title": "...", "at": "...", "href": "/admin/listings", "isNew": true } ] }
```
Queues: `listings, images, kyc, storeRentals, renewals, subscriptions, reports, reviews, support`.
Store `serverTime` and send it back as `since` next poll; animate queues where `pulse` is true.
`overdue` = oldest waiting item older than 24 h (→ `critical`). (Partner approvals have no
"pending request" state in the data model, so there is no queue for them.)

## 4. Messages inbox
* `GET /api/messages/conversations?limit=30&cursor=&unreadOnly=` → `{conversations, nextCursor, hasMore, unreadTotal}`.
  One SQL query (latest message per person+listing, unread counted in the DB, only the **first**
  listing image returned). Keyset-paginated; pass `nextCursor` back for the next page (max limit 100).
  Existing fields kept; added `lastMessageId`, `lastMessageFromMe`. A conversation that gets new mail
  mid-paging jumps ahead of the cursor — refresh page 1 to see it (normal for a live inbox).
* `GET /api/messages/thread/:userId?listing=&limit=50&before=<messageId>` → `{messages, hasMore, nextBefore}`.
  Newest `limit` messages (default 100), ascending; `before` loads older. Previously returned the
  *entire* history. `before` must belong to the same conversation.
* `GET /thread/:userId/status` and `GET /unread-count` are unchanged.

## 5. Category counts — `GET /api/categories/counts[?country=UGANDA]`
`{counts, direct, new24h, total, country, generatedAt}`: `counts` rolls up through all descendants;
`direct` is per exact category; `new24h` powers "new" highlights; a **missing key means 0**;
`counts.jobs` = open job posts. Counts exactly what a visitor can see (ACTIVE and not past
`expiresAt`). Real time: any successful write to listings/admin/stores/jobs/reports/users/uploads
(and the expiry job) invalidates the cache, so the next request is fresh; a 5 s TTL covers other
server instances. Supports `ETag`/`304`. `/rollup-counts` and `/active-counts` keep their shapes and
now share this computation.

## 6. Store status → Active — `PATCH /api/store-rentals/admin/:id`
One database transaction, serialised per rental (a second admin click waits): validates the change,
then for **ACTIVE** — role granted, internal store subscription tied to the rental end date, Store
record created or re-opened (`isActive`), owner's listings re-tiered, notification — or, when a
store **ends** (EXPIRED / CANCELLED / back to PENDING) — store frozen, store subscription ended,
listings reset to FREE and store-only zones released (listings stay live). All-or-nothing
(proven by forcing a mid-activation failure) and idempotent (re-sending ACTIVE repairs a half-applied
state, never duplicates). Rejected with 400: unknown status/tier, non-numeric fee/maxListings,
invalid dates, activation without passed KYC, activation with an **end date already in the past**
(the sweep would instantly undo it — send a new `endDate` in the same request).
Response keeps `{rental}` and adds `store`, `entitlement`, `effect:{activated,deactivated,listingsUpdated}`.
Access takes effect immediately: the listing cap and role read live data on the next request.
`confirm-renewal` and the expiry sweep use the same transactional code (the sweep previously marked
a rental EXPIRED *before* freezing the store, so a failure left a lapsed store online forever).

## Bugs fixed on the way
* **Ending a paid subscription locked the customer out of their account**: the admin handler cleared
  `User.isVerified`, which is *email confirmation* (login requires it). It no longer touches it.
* `pg_advisory_xact_lock` via `$queryRaw` fails in Prisma (`void` column) — would have broken every
  subscribe; found only by running against real PostgreSQL.
* Store activation used to reuse *any* unlimited paid package, so the revenue report counted that
  package's price for every approved store; it now uses a dedicated inactive zero-price package.
* Activating a store no longer expires a user's separately purchased subscription.

## Decisions for you (behaviour changes worth confirming)
1. A current subscription's `maxListings` now **raises** the cap (the signup trial package is
   "unlimited", so trial users can post beyond 10 while it lasts). Before, subscriptions didn't affect
   the cap at all. If trials should not lift the cap, set the trial package's `maxListings` to 10.
2. Paid **CV** packages still activate immediately on `subscribe` (legacy; no payment gateway exists).
3. Renewal confirmations are admin-driven; no renewal e-mail is sent yet.

## Operations
* Run the new migration (additive). Env: `ORDINARY_USER_MAX_LISTINGS` (default 10).
* Caches are per process (counts: invalidate on write + 5 s TTL; account status: 15 s) — correct on a
  single instance, bounded-stale across several.
* The inbox query is O(that user's messages); fine into the tens of thousands per user. If a power
  user ever outgrows it, add a denormalised `Conversation` table.

## Saved searches (added in the merge)
- `GET /api/saved-searches` → `{ searches: [{ id, name, params, notify, createdAt, lastCheckedAt, newCount }], max }`
- `POST /api/saved-searches { params, name?, notify? }` → 201 `{ id, name }` · 200 `{ id, duplicate: true }` · 400 when empty or over the cap
- `PATCH /api/saved-searches/:id { name?, notify?, seen? }` (`seen: true` moves the "new" watermark to now)
- `DELETE /api/saved-searches/:id`
- Allowed `params`: `q, category, location, condition (NEW|USED), priceMin, priceMax, verifiedOnly, withPhotos`.
- Alerts are created by the lifecycle sweep as `SYSTEM` notifications with `data: { kind: 'SAVED_SEARCH', savedSearchId, count, href }`.
