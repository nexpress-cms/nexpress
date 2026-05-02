import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 23.6 — golden-path E2E coverage.
 *
 * Lives at `apps/web/tests/e2e/`. Distinct from the integration suite
 * (`apps/web/tests/*.integration.test.ts` driven by vitest) so the
 * runners don't fight over file globs:
 *   - vitest matches `*.integration.test.{ts,tsx}` only.
 *   - Playwright is rooted at `tests/e2e/` and only reads `.spec.ts`.
 *
 * The webServer block boots `next dev` on port 3001 (separate from the
 * developer's 3000) so a developer can run e2e while their dev server
 * is up. CI passes `PLAYWRIGHT_USE_BUILD=1` to switch to `next start`
 * against a pre-built app — production-shaped output, no transpile
 * cost during the run.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const useBuild = process.env.PLAYWRIGHT_USE_BUILD === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false, // Tests share a single DB; serialize to keep state legible.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    // Cookies + Postgres are the source of session truth; no need to
    // persist storage across tests.
    storageState: undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: useBuild
      ? `pnpm exec next start --port ${port}`
      : `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // Cold next dev boot is slow on first compile; give it a generous
    // window. CI has a faster cold path with `next start`.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
