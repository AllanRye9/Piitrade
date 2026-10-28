import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@': process.cwd() } }, test: { include: ['e2e/**/*.e2e.test.ts'], globals: true } });
