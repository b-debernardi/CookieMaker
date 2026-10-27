import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Geometry builds take a few seconds each on a slow CI machine.
    testTimeout: 60_000,
  },
});
