import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          // Geometry builds take a few seconds each on a slow CI machine.
          testTimeout: 60_000,
        },
      },
      {
        // Needs DATABASE_URL: a database with the migrations applied (supabase/tests/README.md).
        test: {
          name: 'db',
          include: ['supabase/tests/**/*.test.ts'],
          testTimeout: 30_000,
          // One connection pool per file; files run one after another to keep the database calm.
          fileParallelism: false,
        },
      },
    ],
  },
});
