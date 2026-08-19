import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests share one real database with no per-worker
    // isolation (no schema-per-worker, no transactional rollback) — test
    // files run sequentially so concurrent files can't race on shared
    // state. Revisit once the suite has real per-worker DB isolation.
    fileParallelism: false,
  },
});
