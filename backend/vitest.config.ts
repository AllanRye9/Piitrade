import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database or network. Anything that needs a real
// PostgreSQL + generated Prisma client belongs in `*.integration.test.ts`,
// which is excluded here and run separately (see backend/TESTING.md).
export default defineConfig({
  test: {
    environment: 'node',
    // Several pure-logic modules (savedSearches, backupService…) import utils/prisma.ts, which throws at import
    // time when no database URL is set. This placeholder only lets them load: the Prisma pg adapter connects
    // lazily, so a unit test never opens a connection (one that tried would fail fast, not touch real data).
    env: { DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:5432/unit_tests_never_connect', DATABASE_PRIVATE_URL: '' },
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules', 'dist'],
  },
});
