# Database Setup Troubleshooting

## PostgreSQL P1000 authentication failure

`npm run db:setup` can fail with Prisma `P1000` when the `DATABASE_URL` loaded
from `backend/.env` has credentials that differ from the root `.env` values used
by Docker Compose to initialize PostgreSQL. In this case, PostgreSQL was
reachable at `localhost:55432`, but rejected the password in `DATABASE_URL`.

Prisma now applies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` to a
configured URL only when it targets the local Compose endpoint
(`localhost:55432`). This keeps Prisma migrations aligned with the credentials
used by the Compose database. URLs for other hosts are left unchanged.

After updating the configuration, rerun:

```sh
npm run db:setup
```

This fix does not reset or delete the PostgreSQL data volume.