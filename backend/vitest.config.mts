import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database or network. Anything that needs a real
// PostgreSQL + generated Prisma client belongs in `*.integration.test.ts`,
// which is excluded here and run separately (see backend/TESTING.md).
export default defineConfig({
  test: {
    environment: 'node',
    // Utility modules may import Prisma at module load; this placeholder allows
    // unit tests to load them without connecting to a real database.
    env: { DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:5432/unit_tests_never_connect', DATABASE_PRIVATE_URL: '' },
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules', 'dist'],
  },
});
