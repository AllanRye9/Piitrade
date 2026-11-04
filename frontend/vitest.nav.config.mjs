// Navigation and related frontend unit tests.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': process.cwd() } },
  test: { environment: 'jsdom', include: ['navtest/**/*.test.{ts,tsx}'], globals: true },
});
