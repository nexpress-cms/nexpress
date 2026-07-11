// eslint-disable-next-line import-x/no-relative-packages
import { prepareTemplateDatabase } from "../../../packages/core/src/integration/setup.js";
import { createIntegrationStorageRoot } from "./integration-storage.js";

/**
 * Vitest globalSetup hook. Runs once in the parent process before any
 * worker forks. Builds (or rebuilds) a run-namespaced template with
 * migrations applied, then drops any leftover worker DBs from that namespace
 * so each run starts clean. Workers lazily clone the template into their own
 * `_wN` DB on first connect — see setup.ts:ensureWorkerDatabase.
 */
export default async function () {
  const storage = await createIntegrationStorageRoot();

  let teardownDatabase: () => Promise<void>;
  try {
    teardownDatabase = await prepareTemplateDatabase();
  } catch (error) {
    try {
      await storage.cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Integration database setup and storage cleanup failed",
      );
    }
    throw error;
  }

  return async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(teardownDatabase),
      storage.cleanup(),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Integration database and storage cleanup failed");
    }
  };
}
