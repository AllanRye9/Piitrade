# MTN Mobile Money (MoMo) payments

Collection-only: the platform is the sole beneficiary of every payment (subscriptions, store rentals and
renewals, Gold/Platinum listing visibility, CV downloads). There is no escrow, no split payment and no
Disbursements API. **Everything is OFF by default** — until `MTN_ENABLED=true` the app behaves exactly as
before (payment reference typed by the user, confirmed by an admin).

## What it buys and how access is granted

| Purpose | Priced from | On confirmed payment (reuses the existing logic) |
|---|---|---|
| `SUBSCRIPTION_UPGRADE` | the request's snapshotted price (`upgradeMode` AFTER_EXPIRY / IMMEDIATE) | same activation path; IMMEDIATE cancels the plan it replaces |
| `SUBSCRIPTION` | package price | `adminUpdateSubscription(…, ACTIVE)` — same activation, chaining, notification and email as an admin confirming |
| `SUBSCRIPTION_RENEWAL` | package price | same; the new term starts when the current one ends |
| `STORE_RENTAL` (first application) | rental fee | marked paid and queued for admin approval — **KYC / content review is unchanged** |
| `STORE_RENEWAL` | pending renewal fee | `confirmPendingRenewal()` |
| `LISTING_TIER` | admin tier pricing (Site Settings) | listing tier + expiry set, request cleared |
| `CV_DOWNLOAD` | admin-set CV package (token amount) | token marked paid |

The browser never sends an amount. The server derives it, sends the MTN request, and only a payment that
**MTN itself reports SUCCESSFUL** (status, externalId, amount and currency all matching) unlocks anything.

## Lifecycle

1. `POST /api/payments/momo/initiate` — validates ownership/state, derives the price, pre-checks the number
   (`accountholder/msisdn/{n}/active`), records a `PaymentTransaction`, sends `requesttopay`.
2. The payer approves on their phone. We learn the result three ways, all funnelling into one idempotent
   `verifyPayment()` that always asks MTN: the payer's polling (`GET|POST /api/payments/:id[/status]`),
   MTN's callback (signed URL; the body is ignored), and a 30 s reconciler.
3. SUCCESSFUL → provisioning (leased, retried). Anything that cannot be provisioned safely (target cancelled
   before the money landed, amount mismatch, renewal changed mid-payment, expired CV token) becomes
   **NEEDS_REVIEW** and every admin is notified. Money is never silently kept.

Statuses: `PENDING` → `SUCCESSFUL` (+ `provisionedAt`) | `FAILED` | `EXPIRED` (given up after 5 min, still
re-checked for 24 h so a late approval is honoured) | `NEEDS_REVIEW`.

Expiry/downgrade of subscriptions, rentals and tiers is unchanged (`utils/lifecycleJobs.ts`, every 5 min).

## Setup — sandbox

1. Subscribe to the **Collections** product on the MTN MoMo developer portal; copy its primary key.
2. `MTN_SUBSCRIPTION_KEY=<key> npm run momo:sandbox:provision` (in `backend/`). It registers an API user,
   mints the API key (shown **once**), verifies it, and prints the env lines. Sandbox only.
3. Set the variables (see `backend/.env.example`): `MTN_ENABLED=true`, `MTN_ENVIRONMENT=sandbox`,
   `MTN_TARGET_ENVIRONMENT=sandbox`, `MTN_BASE_URL`, `MTN_SUBSCRIPTION_KEY`, `MTN_API_USER`, `MTN_API_KEY`,
   `MTN_CURRENCY=EUR` (**the sandbox only accepts EUR**; the real UGX price is still what is recorded).
4. Callbacks (optional): `MTN_CALLBACK_SECRET` (`openssl rand -hex 32`) and this **backend's** public https
   origin in `MTN_CALLBACK_URL` / `API_BASE_URL`. The host must match the callback host you registered with the
   API user (`--callback-host`). With `webhook.site` as the host, callbacks never reach you and payments settle
   by polling only — which is fully supported.
5. Restart. The startup log prints `MTN MoMo: enabled (sandbox, …)` or exactly what is wrong.

## Going live (production)

- MTN issues the production API user/key through the partner portal — **never reuse sandbox values**.
- `MTN_ENVIRONMENT=production`, `MTN_TARGET_ENVIRONMENT=<MTN's country value, e.g. mtnuganda>`,
  `MTN_BASE_URL=<URL from your MTN onboarding pack>`, no `MTN_CURRENCY` (defaults to UGX; anything else is refused),
  a real https callback URL + secret. The config refuses to enable if sandbox and production values are mixed.
- Run the sandbox end to end first (below), then switch one purpose at a time if you want a gradual rollout
  by watching the admin list.
- Settle CV downloads: with MoMo on, `/api/cv-payment/confirm` refuses browsers (unless the
  `CV_PAYMENT_WEBHOOK_SECRET` gateway secret is presented).

## Operating it

- Admin ledger (API): `GET /api/payments/admin/list?status=NEEDS_REVIEW`, `POST /api/payments/admin/:id/verify`
  (re-ask MTN now), `POST /api/payments/admin/:id/resolve {note}` (close a NEEDS_REVIEW payment you handled
  by hand, e.g. refunded outside the system). Full phone numbers never leave the server.
- Refunds are outside this integration (collection-only): resolve the payment with a note after refunding.
- Stuck "paid but no access": the reconciler retries every 30 s and escalates to NEEDS_REVIEW after 30 min.
- Disable instantly with `MTN_ENABLED=false`: new payments stop; anything in flight is not lost (re-enable and
  the reconciler settles it).

## Sandbox test numbers (verify against MTN's current docs)

MTN documents special sandbox numbers that force outcomes (e.g. ones that fail, are rejected, time out or
stay pending); any other number succeeds. Use the **Test mode** badge in the payment window to confirm you
are on the sandbox.

## Verification performed on this change

Backend: strict `tsc` and build clean; 159 unit tests; 108 integration tests against real PostgreSQL (all 43
pre-existing ones still pass). Frontend: `tsc`, ESLint (0 warnings) and `next build` clean; the payment window's
behaviour was exercised in jsdom (32 checks). The HTTP client and provisioning script were exercised against a
local server that enforces MTN's documented sandbox contract. **Not done here:** a run against MTN's real
sandbox (no network access) and a real-browser session — do both before enabling in production.


## Admin UI
`/admin/payments` lists the ledger with status/purpose filters, a **Re-check** (asks MTN now) and **Mark handled** for NEEDS_REVIEW payments.

## Pricing note
Listing-tier prices come from Site Config → Tier Pricing only; there are no built-in defaults. Subscriptions are charged at the price snapshotted when the request was made.

## Conformance with MTN's Collection API
- Auth: `POST /collection/token/` (Basic apiUser:apiKey + `Ocp-Apim-Subscription-Key` + `X-Target-Environment`), bearer token cached, refreshed before the 1 h expiry, one retry on 401.
- Charge: `POST /collection/v1_0/requesttopay` with `X-Reference-Id` (fresh UUID v4), `X-Target-Environment`, optional `X-Callback-Url`; body `amount` (string), `currency`, `externalId`, `payer {MSISDN}`, `payerMessage`, `payeeNote`. 202 = accepted. A 409 `RESOURCE_ALREADY_EXIST` for our own reference is the same payment (idempotent retry), not an error.
- Status: `GET /collection/v1_0/requesttopay/{referenceId}` (PENDING / SUCCESSFUL / FAILED + `reason`); amount, currency and externalId are cross-checked before anything is unlocked. Callbacks (PUT/POST) only trigger that check.
- Pre-check: `GET /collection/v1_0/accountholder/msisdn/{msisdn}/active`.
- Numbers: E.164 digits without `+`; outside the sandbox only MTN Uganda ranges (076/077/078/039) are accepted. UGX is sent as a whole-number string; the sandbox needs `EUR`.
- Failure codes (NOT_ENOUGH_FUNDS, PAYER_LIMIT_REACHED, APPROVAL_REJECTED, PAYMENT_NOT_APPROVED, TRANSACTION_CANCELED, EXPIRED, PAYER_NOT_FOUND, SERVICE_UNAVAILABLE, …) are translated into plain messages for the payer.
- Production: gateway defaults to `https://proxy.momoapi.mtn.com`, target environment is your country value (Uganda: `mtnuganda`); the API user/key come from MTN's partner portal, not the sandbox provisioning script. Register your callback host with MTN.

## Setting up the real MTN sandbox
1. `.env`: `MTN_SUBSCRIPTION_KEY` (primary key of the Collections product), `MTN_ENVIRONMENT=sandbox`, `MTN_TARGET_ENVIRONMENT=sandbox`, `MTN_BASE_URL=https://sandbox.momodeveloper.mtn.com`, `MTN_CALLBACK_URL=https://<your public host>` (a bare origin is enough; `/api/payments/momo/callback` is appended and, on piitrade.com, the frontend proxies `/api`).
2. `npm run momo:sandbox:provision` creates an API user + API key for your subscription key (shown once). `MTN_API_USER`/`MTN_API_KEY` cannot be invented or copied from examples — MTN issues them per subscription key.
3. Set `MTN_ENABLED=true` (and `MTN_CURRENCY=EUR`, the only sandbox currency, which is also the sandbox default).
4. `npm run momo:sandbox:check` runs the real client against MTN: token → account check → 1 EUR requesttopay → status. Sandbox numbers: 46733123450 succeeds, …51 fails, …52 rejected, …53 times out, …54 stays pending.
`MTN_CALLBACK_SECRET` is optional: when unset it is derived from `JWT_SECRET`.
