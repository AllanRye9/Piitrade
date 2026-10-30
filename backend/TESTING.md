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
| `src/utils/search.test.ts` | Search query parsing and the Prisma `where` it builds. |

The fake database is NOT proof of real-database behaviour. The checks below
were run once, by hand, against PostgreSQL 16.

## Database checks (manual, psql)

1. Apply every folder in `prisma/migrations/` in name order to an empty
   database with `psql -v ON_ERROR_STOP=1 -f .../migration.sql`.
2. `20261016000000_classifieds_only`: seed an order, payment, coupon, a listing
   with `stock = 5` and notifications (one `ORDER_PLACED`), apply the
   migration twice (it is idempotent), then confirm: `_archive_Order` holds the
   order, the commerce tables and enums are gone, the listing has
   `quantity = 5`, the `ORDER_PLACED` notification is deleted, and every
   column in `schema.prisma` exists in the database.
3. `20261011110000_search_trigram_indexes`: (a) with pg_trgm available it
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

Database checks (manual, psql, PostgreSQL 16):

10. All five new migrations roll back (reverse order) to zero leftovers and
    re-apply.

## Integration tests (real PostgreSQL)

`*.integration.test.ts` exercise the real database: subscription lifecycle and concurrency, store
activation (including rollback when a step fails), category counts and cache invalidation, admin
alerts, inbox pagination and the column preference. They are **excluded from `npm test`** and run with:

```bash
# 1. a throwaway database with every migration applied (prisma migrate deploy, or db-setup)
# 2. WARNING: the tests TRUNCATE every table in it
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/piitrade_test npm run test:integration
```

Without `TEST_DATABASE_URL` each file skips itself. CI runs them against its Postgres service.
Note `$queryRaw` cannot return PostgreSQL `void` (e.g. `pg_advisory_xact_lock`) — use `$executeRaw`;
only a real database catches that class of bug.
