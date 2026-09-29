import 'dotenv/config';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const prismaDir = path.join(projectRoot, 'prisma');
const hotfixesDir = path.join(prismaDir, 'hotfixes');

const log = (message: string) => console.log(`[db-setup] ${message}`);
const warn = (message: string) => console.warn(`[db-setup] ${message}`);

const ensureDatabaseUrl = () => {
  if (!process.env.DATABASE_URL && process.env.DATABASE_PRIVATE_URL) {
    process.env.DATABASE_URL = process.env.DATABASE_PRIVATE_URL;
    log('DATABASE_URL not set — using DATABASE_PRIVATE_URL for Prisma CLI calls.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'No database URL found. Set DATABASE_URL (or DATABASE_PRIVATE_URL on Railway) before running Prisma migrations or hotfixes.'
    );
  }
};

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 'unknown'}`);
  }
};

// Like `run`, but captures stdout/stderr instead of streaming them directly,
// so callers can inspect the output (e.g. to detect a specific Prisma error
// code) while still echoing it to the console for visibility in logs.
const runCapture = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result;
};

const getMigrationDirCount = (): number => {
  const migrationsDir = path.join(prismaDir, 'migrations');
  if (!fs.existsSync(migrationsDir)) return 0;

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('.'))
    .length;
};

// Marks every committed migration as already applied, without running their
// SQL. This is the standard Prisma "baseline" procedure for an existing
// database whose schema already matches prisma/schema.prisma but which has
// no _prisma_migrations history — exactly the state this app's DBs are in,
// since earlier deployments (see the `migrationCount === 0` branch below)
// bootstrapped the schema with `prisma db push` before any migration files
// existed. See: https://pris.ly/d/migrate-baseline
const baselineExistingMigrations = () => {
  const migrationsDir = path.join(prismaDir, 'migrations');
  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  for (const name of migrationNames) {
    log(`Baselining migration as already applied: ${name}`);
    run('npx', ['prisma', 'migrate', 'resolve', '--applied', name]);
  }
};

// Verifies that the live database's actual schema matches
// prisma/schema.prisma, by diffing the real database against the schema
// file (NOT against the migration history) via `prisma migrate diff
// --exit-code`: exit code 0 means no diff, 2 means a diff was found, and
// anything else is a CLI/connection error.
//
// This is the safety net for baselineExistingMigrations(): `prisma migrate
// resolve --applied` marks a migration as done purely by writing a row into
// `_prisma_migrations` — it never checks that the migration's SQL actually
// matches what's in the database. If the migration history is squashed
// (collapsed into a single new "init" migration, as this project's history
// currently is) *after* a database was already bootstrapped via `db push`
// from an older version of schema.prisma, baselining will happily mark that
// squashed migration "applied" even though a column it introduces was never
// actually created. Without this check, that drift stays invisible until a
// request hits the missing column and the API returns a 503 in production
// (Prisma error P2022, see src/middleware/errorHandler.ts). With this check,
// the same drift fails the deploy itself, with a message that tells you
// exactly how to inspect and fix it.
//
// IMPORTANT: this must run AFTER runHotfixes() at every call site below.
// prisma/hotfixes/*.sql is the mechanism that can actually repair the exact
// drift this function detects (missing tables/columns from a migration
// that's marked "applied"), so if verification ran first it would just
// throw before a repair hotfix ever got a chance to run — which is exactly
// what happened in production once a real drifted database hit this path.
const verifySchemaMatchesDatabase = () => {
  log('Verifying live database schema matches prisma/schema.prisma...');

  const result = runCapture('npx', [
    'prisma',
    'migrate',
    'diff',
    '--from-url', process.env.DATABASE_URL as string,
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--exit-code',
  ]);

  if (result.status === 0) {
    log('Database schema matches prisma/schema.prisma.');
    return;
  }

  if (result.status === 2) {
    throw new Error(
      'Database schema does NOT match prisma/schema.prisma (see the diff logged above). ' +
        'The database is likely missing column(s) that a squashed or baselined migration ' +
        'claims to have applied. To fix: run `npx prisma migrate diff --from-url ' +
        '"$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` to see the ' +
        'exact SQL needed, review it, apply it (e.g. via `npx prisma db push`), then redeploy.'
    );
  }

  throw new Error(`npx prisma migrate diff exited with unexpected code ${result.status ?? 'unknown'}`);
};

const runMigrations = () => {
  const migrationCount = getMigrationDirCount();

  if (migrationCount === 0) {
    log("No committed migrations found — bootstrapping schema with 'prisma db push'.");
    run('npx', ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate']);
    log('Schema bootstrap complete.');
    runHotfixes();
    verifySchemaMatchesDatabase();
    return;
  }

  log(`Running prisma migrate deploy (${migrationCount} migration(s) found)...`);
  const result = runCapture('npx', ['prisma', 'migrate', 'deploy']);

  if (result.status === 0) {
    log('Migrations applied successfully.');
    runHotfixes();
    verifySchemaMatchesDatabase();
    return;
  }

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const isUnbaselinedSchema = combinedOutput.includes('P3005');

  if (!isUnbaselinedSchema) {
    throw new Error(`npx prisma migrate deploy exited with code ${result.status ?? 'unknown'}`);
  }

  log(
    'Detected P3005 (database schema is not empty, but has no migration history) — ' +
      'this matches a database that was previously bootstrapped with `prisma db push`. ' +
      'Baselining existing migrations instead of failing startup.'
  );
  baselineExistingMigrations();

  log('Retrying prisma migrate deploy after baseline...');
  run('npx', ['prisma', 'migrate', 'deploy']);
  log('Migrations applied successfully after baseline.');

  // The retry above only confirms the migration ROWS are marked applied —
  // it does not confirm the underlying columns actually exist (see the
  // function doc comment above). Give hotfixes a chance to repair any such
  // drift, then verify for real before letting the app boot.
  runHotfixes();
  verifySchemaMatchesDatabase();
};

const runHotfixes = () => {
  if (!fs.existsSync(hotfixesDir)) {
    log('No hotfix directory found — skipping compatibility SQL files.');
    return;
  }

  const files = fs
    .readdirSync(hotfixesDir)
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    log('No hotfix SQL files found — skipping compatibility SQL files.');
    return;
  }

  log(`Applying ${files.length} compatibility hotfix(es)...`);

  for (const file of files) {
    const relativePath = path.join('prisma', 'hotfixes', file);
    log(`Applying hotfix: ${file}`);

    try {
      run('npx', ['prisma', 'db', 'execute', '--file', relativePath, '--schema', 'prisma/schema.prisma']);
    } catch (error) {
      warn(`Hotfix failed: ${file}. Continuing with remaining hotfixes.`);
      console.error(error);
    }
  }

  log('Compatibility hotfixes complete.');
};

const args = new Set(process.argv.slice(2));

try {
  ensureDatabaseUrl();

  if (args.has('--hotfixes-only')) {
    runHotfixes();
    process.exit(0);
  }

  // runMigrations() now runs hotfixes internally, before verification, on
  // every path (bootstrap / clean deploy / post-baseline retry) — see the
  // comment on verifySchemaMatchesDatabase() for why the ordering matters.
  runMigrations();
  log('Database setup complete.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[db-setup] Database setup failed.');
  console.error(message);
  process.exit(1);
}
