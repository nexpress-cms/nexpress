import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration suites share Postgres tables and must run with
    // `singleFork` (see vitest.integration.config.ts). Exclude them from
    // `pnpm test` so the default fast/parallel run only covers unit tests.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    environment: "node",
    globals: false,
  },
});
