import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/setup/e2e-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'sandbox',
          include: ['test/sandbox/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
