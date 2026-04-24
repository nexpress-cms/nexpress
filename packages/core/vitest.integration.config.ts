import { defineConfig } from "vitest/config";

/**
 * Integration-test config, invoked via `pnpm test:integration`. Picks up
 * `*.integration.test.ts` files only and runs them sequentially so tests
 * that share tables don't step on each other. Unit tests live under the
 * default `vitest run` and use a separate shape.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Tests skip themselves when TEST_DATABASE_URL isn't set, so running
    // without Docker is non-fatal.
    env: {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
