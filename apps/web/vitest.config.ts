import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/**/*.integration.test.ts"],
    environment: "node",
    globals: false,
    // Set env vars (NX_SECRET, etc.) before any test module's imports are
    // evaluated — nexpress.config.ts validates them at module load time.
    setupFiles: ["./tests/setup-env.ts"],
    // DB-touching suites serialise themselves via the harness, but multiple
    // files running in parallel would still share the same test DB. Force
    // single-file execution so truncate-between-tests stays correct.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
