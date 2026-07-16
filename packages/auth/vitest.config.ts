import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : undefined,
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
