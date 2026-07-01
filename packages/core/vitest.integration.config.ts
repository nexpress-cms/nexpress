import { defineConfig } from "vitest/config";

/**
 * Integration-test config, invoked via `pnpm test:integration`. Picks up
 * `*.integration.test.ts` files only. Each fork lazily clones a
 * pre-migrated, run-namespaced template DB into its own `_wN` database
 * (see src/integration/setup.ts), so fileParallelism stays safe. Unit
 * tests live under the default `vitest run` and use a separate shape.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: true,
    // Reuse module evaluation across files in the same fork. setup.ts
    // singletons (pool, db, migrated) are deliberately process-wide so
    // sharing them is correct — no need to repay the `@nexpress/core`
    // import cost on every file.
    isolate: false,
    globalSetup: ["./src/integration/global-setup.ts"],
    // Tests skip themselves when TEST_DATABASE_URL isn't set, so running
    // without Docker is non-fatal.
    env: {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
