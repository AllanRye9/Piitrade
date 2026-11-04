import { defineConfig } from 'vitest/config';

// Integration tests: need a real PostgreSQL with all migrations applied.
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/piitrade_test npm run test:integration
// Files skip themselves when TEST_DATABASE_URL is unset, so this is safe to run anywhere.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    exclude: ['node_modules', 'dist'],
    // One database, shared tables: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
