import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NP_INTEGRATION_STORAGE_ROOT = "NP_INTEGRATION_STORAGE_ROOT";

export interface IntegrationStorageRoot {
  directory: string;
  cleanup: () => Promise<void>;
}

/**
 * Allocate storage outside the repository for one apps/web integration run.
 * The returned cleanup is safe to call more than once and removes files left
 * behind by failed tests as well as successful uploads.
 */
export async function createIntegrationStorageRoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<IntegrationStorageRoot> {
  const directory = await mkdtemp(join(tmpdir(), "nexpress-web-integration-storage-"));
  env[NP_INTEGRATION_STORAGE_ROOT] = directory;

  return {
    directory,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
      if (env[NP_INTEGRATION_STORAGE_ROOT] === directory) {
        delete env[NP_INTEGRATION_STORAGE_ROOT];
      }
    },
  };
}

/**
 * Point the current Vitest worker at its own local-storage directory. Global
 * setup publishes the per-run root through the environment before workers are
 * forked, so this runs early enough for nexpress.config.ts to read the override.
 */
export function configureIntegrationWorkerStorage(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const root = env[NP_INTEGRATION_STORAGE_ROOT];
  if (!root) return null;

  const workerId = (env.VITEST_POOL_ID ?? env.VITEST_WORKER_ID ?? String(process.pid)).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  const directory = join(root, `worker-${workerId}`);

  // Never inherit an operator's S3 or repository-local storage settings in
  // integration tests. The suite owns this disposable local adapter entirely.
  env.NP_STORAGE_ADAPTER = "local";
  env.NP_STORAGE_DIR = directory;
  env.NP_STORAGE_URL = "/media";

  return directory;
}
