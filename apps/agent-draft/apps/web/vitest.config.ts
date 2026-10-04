import { defineConfig } from 'vitest/config';

// Browser tests live in e2e/ and run with Playwright (pnpm test:ui); unit tests go in src/.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], passWithNoTests: true } });
