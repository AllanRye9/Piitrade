// Phase 0 frontend tests. The frontend has no test runner configured yet, so these are shipped
// separately. To run them from the frontend folder:
//   npm i -D vitest@2 jsdom @testing-library/react@16 @testing-library/dom @vitejs/plugin-react@4 --legacy-peer-deps
//   npx vitest run --config vitest.nav.config.mjs
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': process.cwd() } },
  test: { environment: 'jsdom', include: ['navtest/**/*.test.{ts,tsx}'], globals: true },
});
