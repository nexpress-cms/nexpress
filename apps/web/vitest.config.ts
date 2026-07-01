import path from "node:path";
import { defineConfig } from "vitest/config";

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
    include: ["tests/**/*.integration.test.ts", "tests/**/*.integration.test.tsx"],
    environment: "node",
    globals: false,
    // Set env vars (NP_SECRET, etc.) before any test module's imports are
    // evaluated — nexpress.config.ts validates them at module load time.
    setupFiles: [
      "./tests/setup-env.ts",
      "./tests/setup-site-resolver.ts",
      // Stubs `next/cache` so route handlers that call
      // `revalidateTag` / `revalidatePath` after a write don't
      // crash when invoked outside Next's request context.
      "./tests/setup-next-cache-mock.ts",
    ],
    // Builds a migrated, run-namespaced template once before any worker
    // forks; workers then lazily clone it into per-worker `_wN` databases.
    // Lets fileParallelism: true stay safe — see
    // packages/core/src/integration/setup.ts for the wider rationale.
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: true,
    pool: "forks",
    // Reuse module evaluation across files in the same fork. The harness
    // already truncates between tests, and `migrated` / pool singletons
    // are deliberately process-wide; sharing them avoids re-importing
    // `@nexpress/core` (and its transitive graph) on every file.
    isolate: false,
    testTimeout: 30_000,
  },
});
