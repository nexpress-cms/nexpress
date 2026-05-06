import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit-test config — runs the pure-logic tests in `apps/web/tests/`
 * (matched by `*.unit.test.ts(x)`) WITHOUT booting the bootstrap or
 * connecting to a database. The default `vitest.config.ts` is
 * integration-only and pins itself to a Postgres template; this
 * file lets `pnpm exec vitest --config vitest.unit.config.ts`
 * cover the data-free smoke tests in CI's `checks` job.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["tests/**/*.unit.test.ts", "tests/**/*.unit.test.tsx"],
    environment: "node",
    globals: false,
    isolate: true,
    pool: "forks",
    fileParallelism: true,
    testTimeout: 10_000,
  },
});
