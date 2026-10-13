# Prisma migrations

The schema was originally authored and evolved via `prisma db push` during
early development, with no committed migration history. That has since been
baselined: `20260901140031_init` is the committed starting point, generated
against a database whose schema already matched `prisma/schema.prisma`. The
`migration_lock.toml` file above pins the provider to `postgresql`.

Every schema change from here on should go through:

```bash
npx prisma migrate dev --name <description>
```

and the generated SQL in `prisma/migrations/<timestamp>_<description>/` must
be committed. `docker-entrypoint.sh` and `src/index.ts` both run
`scripts/db-setup.ts` on container start, which runs `prisma migrate deploy`
to apply any pending migrations found here, in order.

## Deploying to a pre-existing database that predates this migration

Because `20260901140031_init` was baselined rather than run from an empty
database, any database that was bootstrapped via `prisma db push` *before*
this migration was committed won't have a `_prisma_migrations` history yet.
`scripts/db-setup.ts` detects that case (Prisma error P3005 — "database
schema is not empty, but has no migration history"), marks `init` as already
applied via `prisma migrate resolve --applied`, and then verifies the live
schema actually matches `prisma/schema.prisma` before letting the app boot
(see the comments in `db-setup.ts` for why that verification step matters).

## Fresh, truly empty databases

If `prisma/migrations` is ever empty (e.g. reverted locally), `db-setup.ts`
falls back to `prisma db push --accept-data-loss` so the app
still boots against a brand-new database. That fallback only runs when there
are zero committed migration directories, which is no longer the normal case
now that `init` is committed.
