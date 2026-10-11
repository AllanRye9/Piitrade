import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database or network. Anything that needs a real
// PostgreSQL + generated Prisma client belongs in `*.integration.test.ts`,
// which is excluded here and run separately (see backend/TESTING.md).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules', 'dist'],
  },
});
