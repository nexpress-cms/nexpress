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
 * explicitly keeps DATABASE_URL / NX_SECRET predictable.
 *
 * Then seeds the e2e admin user so spec files can rely on a
 * known login.
 */
export default async function globalSetup(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(here, "../../../../.env") });
  loadEnv({ path: resolve(here, "../../../.env"), override: false });

  await seedE2EAdmin();
}
