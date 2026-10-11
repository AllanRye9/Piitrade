# Backend testing

## Run

    npm ci
    npm test            # unit tests (Vitest) — no database, no network
    npm run typecheck   # needs `npx prisma generate` first (see below)

`npm test` covers pure logic only: `src/**/*.test.ts` (files named
`*.integration.test.ts` are excluded; none exist yet).

## What is covered today

| File | What it proves |
|---|---|
| `src/utils/orderLifecycle.test.ts` | Legal order-status transitions and who may make them (incl. buyer confirming receipt); platform-fee parsing; fee/payout arithmetic. |
| `src/utils/orderStatusService.test.ts` | Seller credited exactly once; repeat and simultaneous DELIVERED calls cannot double-credit; full rollback on failure; fee applied and skipped for admin sellers; proof of delivery (right/wrong/malformed code, attempt counting that survives the failed request, lockout, race with a lock, fail-closed without a secret, buyer confirmation, audited admin override). Uses an in-memory fake of the Prisma calls. |
| `src/utils/deliveryCode.test.ts` | Code is 6 digits, deterministic, per-order, evenly spread; input normalisation; constant-time verify; secret resolution has no default. |
| `src/utils/paymentProof.test.ts` | Admin payment deadline (default 30, clamped 5–1440, blank = default); MTN transaction-ID / phone / amount validation; underpayment never confirmable; which payment methods are allowed (card/wallet refused, cash on delivery only for Piitrade's own listings). |
| `src/utils/paymentProofService.test.ts` | Manual MTN flow: proof submission rules (buyer only, deadline, one pending, max 3, one transaction ID per order even when simultaneous), admin confirm/reject (audit trail, no resurrecting a cancelled order, two admins at once), fresh window after a rejection, automatic expiry (never while a proof awaits review, safe on several instances). |
| `src/utils/checkoutPolicy.test.ts` | Checkout only for admin + active web stores in HYBRID mode; other modes; motors/property always contact-only; active-store lookup. |

The fake database is NOT proof of real-database behaviour. The checks below
were run once, by hand, against PostgreSQL 16.

## Database checks (manual, psql)

1. Apply every folder in `prisma/migrations/` in name order to an empty
   database with `psql -v ON_ERROR_STOP=1 -f .../migration.sql`.
2. Rollback of `20261011090000_order_platform_fee_and_payout`:
   `prisma/rollbacks/20261011090000_order_platform_fee_and_payout.down.sql`,
   then re-apply the forward migration and confirm the backfill marks
   DELIVERED orders as paid out and leaves others untouched.
3. Concurrency: two sessions each run, inside a transaction, the guarded
   `UPDATE "Order" ... WHERE id=$1 AND status=$2 AND "payoutCreditedAt" IS NULL`
   followed by `pg_sleep`; exactly one reports `UPDATE 1`.
4. Brute-force cap: 8 simultaneous sessions run
   `UPDATE "Order" SET "deliveryCodeAttempts" = "deliveryCodeAttempts"+1
   WHERE id=$1 AND "deliveryCodeAttempts" < 5`; exactly 5 report `UPDATE 1`.
5. `20261011110000_search_trigram_indexes`: (a) with pg_trgm available it
   creates 3 indexes and the existing `ILIKE '%term%'` search uses them
   (50k synthetic rows: ~246 ms seq scan -> ~0.4 ms); (b) run as a database
   user that may NOT create extensions it exits 0, creates nothing, and prints
   a NOTICE. Rollback: `prisma/rollbacks/20261011110000_*.down.sql`.
6. Run all `prisma/rollbacks/*.down.sql` in reverse order on a migrated
   database, then re-apply the forward migrations.

## Not yet covered (needs the Prisma engine + a real database)

Route-level tests with Supertest against `docker-compose.test.yml`
(PostgreSQL on :55432): `PUT /orders/:id/status`, `PUT /admin/orders/:id/status`.
These need `npx prisma generate` and `prisma migrate deploy` to work, which
requires network access to `binaries.prisma.sh`. Add them as
`*.integration.test.ts` and run them in CI.

## CI steps to wire up

    npm ci
    npx prisma generate
    npm run typecheck
    npm test

## Additional database checks for the manual MTN payment migration

7. `20261011120000_manual_mobile_money`: three simultaneous inserts of the same
   `transactionId` -> exactly one succeeds (partial unique index); after the
   first is marked REJECTED the same ID can be inserted again.
8. Legacy backfill: with fixtures of every order/payment combination, the
   migration marks only MOBILE_MONEY payments of CONFIRMED/PROCESSING/SHIPPED
   orders as COMPLETED (tagged `LEGACY_BACKFILL`); PENDING, cancelled,
   cash-on-delivery and already-completed payments are unchanged.
9. All four rollbacks in reverse order leave no new tables, columns or indexes.

## Frontend

    cd frontend && npm ci && npx tsc --noEmit -p . && npm run lint

`lib/deliveryQr.ts` + the `qrcode`/`jsqr` libraries were checked with a
round-trip script (encode -> render pixels at several sizes, with and without
noise -> decode with jsQR -> parse). Camera scanning itself (`getUserMedia`)
needs a real device over HTTPS and has NOT been tested.

## Refunds and late payments (added later)

`orderStatusService.test.ts` also covers **refund = payout reversal**: the seller
is debited exactly what was paid out (not the order total), once, even if two
admins click at once; the balance may go negative if they already withdrew;
the payment becomes REFUNDED; a written reason is required; both sides are
notified; a failure midway rolls everything back.
`paymentProofService.test.ts` / `paymentProof.test.ts` also cover **late
payments**: only an order the expiry sweep cancelled (CANCELLED + payment
FAILED + mobile money) can take a late proof, for 7 days; confirming it
reinstates the order (underpayment cannot); an order the buyer or an admin
cancelled can never be reinstated.

Database checks 10-11 (manual, psql, PostgreSQL 16):

10. Three simultaneous sessions run the guarded refund
    `UPDATE "Order" ... WHERE status='DELIVERED' AND "payoutReversedAt" IS NULL`
    plus the seller debit -> exactly one performs it; the balance drops once.
11. `scripts/reconcile-seller-balances.sql` on fixtures: a consistent seller is
    not listed; an inflated balance appears in query 1; a seller in debt in
    query 2; an order refunded before reversal existed in query 3.
12. All five new migrations roll back (reverse order) to zero leftovers and
    re-apply.

