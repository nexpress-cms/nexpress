// eslint-disable-next-line import-x/no-relative-packages
import { prepareTemplateDatabase } from "../../../packages/core/src/integration/setup.js";

/**
 * Vitest globalSetup hook. Runs once in the parent process before any
 * worker forks. Builds (or rebuilds) `${TEST_DATABASE_URL}_template` with
 * migrations applied, then drops any leftover `_wN` worker DBs so each
 * run starts clean. Workers will lazily clone the template into their
 * own `_wN` DB on first connect — see setup.ts:ensureWorkerDatabase.
 */
export default async function () {
  const teardown = await prepareTemplateDatabase();
  return teardown;
}
