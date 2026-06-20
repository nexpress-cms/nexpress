import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { seedE2EAdmin } from "./fixtures/seed.js";

/**
 * Playwright global setup (Phase 23.6).
 *
 * Runs once before any spec, in the same Node process Playwright
 * uses to launch the test runner. We load the repo `.env` here
 * because Playwright's webServer block doesn't inherit the parent
 * shell's env consistently across local + CI invocations; loading
 * explicitly keeps DATABASE_URL / NP_SECRET predictable.
 *
 * Then seeds the e2e admin user so spec files can rely on a
 * known login. Finally pre-warms the dev server's slow routes
 * — the first spec to hit `/admin/login` was racing the dev
 * compile vs React hydration, leading to flaky `button.click`
 * behavior where the click landed before the form's onSubmit
 * handler attached and fell through to the browser's default
 * (empty form action → GET to current URL → no navigation).
 */
export default async function globalSetup(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(here, "../../../../.env") });
  loadEnv({ path: resolve(here, "../../../.env"), override: false });

  await seedE2EAdmin();

  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
  const baseURL = `http://localhost:${port}`;
  // Trigger compile of the routes the spec suite hits first.
  // Errors are tolerated — webServer is up by the time globalSetup
  // runs (Playwright orders it that way), but a stray initial
  // failure shouldn't block the run.
  await Promise.allSettled([
    fetch(`${baseURL}/admin/login`),
    fetch(`${baseURL}/admin/collections/pages/create`),
    fetch(`${baseURL}/admin/settings`),
    fetch(`${baseURL}/admin/plugins`),
    fetch(`${baseURL}/admin/plugins/reading-time`),
  ]);
}
