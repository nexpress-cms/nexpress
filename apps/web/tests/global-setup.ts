// eslint-disable-next-line import-x/no-relative-packages
import { prepareTemplateDatabase } from "../../../packages/core/src/integration/setup.js";

/**
 * Vitest globalSetup hook. Runs once in the parent process before any
 * worker forks. Builds (or rebuilds) a run-namespaced template with
 * migrations applied, then drops any leftover worker DBs from that namespace
 * so each run starts clean. Workers lazily clone the template into their own
 * `_wN` DB on first connect — see setup.ts:ensureWorkerDatabase.
 */
export default async function () {
  const teardown = await prepareTemplateDatabase();
  return teardown;
}
