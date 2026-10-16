# Pre-migration steps

Run these **before** `prisma migrate deploy` on an existing production database.

| Script | Why |
|---|---|
| `archive-user-balances.sql` | `20261016000000_classifieds_only` drops `User.balance` without archiving it. |

Also take a full `pg_dump` first: the classifieds migration is destructive by design.
