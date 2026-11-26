import { defineConfig } from "vitest/config";

// The CLI suite owns filesystem capsules and real child-process fixtures.
// Bound file concurrency while workspace builds/tests share the same host;
// preserve every assertion and each existing per-test deadline.
export default defineConfig({
  test: { maxWorkers: 2 },
});
