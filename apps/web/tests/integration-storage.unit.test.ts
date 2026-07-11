import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NP_INTEGRATION_STORAGE_ROOT,
  configureIntegrationWorkerStorage,
  createIntegrationStorageRoot,
  type IntegrationStorageRoot,
} from "./integration-storage.js";

describe("integration storage isolation", () => {
  let storage: IntegrationStorageRoot | null = null;

  afterEach(async () => {
    await storage?.cleanup();
    storage = null;
  });

  it("allocates a disposable root under the operating-system temp directory", async () => {
    const env: NodeJS.ProcessEnv = {};
    storage = await createIntegrationStorageRoot(env);

    expect(relative(tmpdir(), storage.directory).startsWith("..")).toBe(false);
    expect(env[NP_INTEGRATION_STORAGE_ROOT]).toBe(storage.directory);
    await expect(access(storage.directory)).resolves.toBeUndefined();

    await storage.cleanup();
    expect(env[NP_INTEGRATION_STORAGE_ROOT]).toBeUndefined();
    await expect(access(storage.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("overrides inherited storage settings with a worker-specific local directory", () => {
    const env: NodeJS.ProcessEnv = {
      [NP_INTEGRATION_STORAGE_ROOT]: join(tmpdir(), "np-integration-run"),
      VITEST_POOL_ID: "7",
      NP_STORAGE_ADAPTER: "s3",
      NP_STORAGE_DIR: "./public/media",
      NP_STORAGE_URL: "https://cdn.example.com/media",
    };

    const directory = configureIntegrationWorkerStorage(env);

    expect(directory).toBe(join(tmpdir(), "np-integration-run", "worker-7"));
    expect(env.NP_STORAGE_ADAPTER).toBe("local");
    expect(env.NP_STORAGE_DIR).toBe(directory);
    expect(env.NP_STORAGE_URL).toBe("/media");
  });

  it("does not change unit-test environments without a global storage root", () => {
    const env: NodeJS.ProcessEnv = { NP_STORAGE_DIR: "./public/media" };

    expect(configureIntegrationWorkerStorage(env)).toBeNull();
    expect(env).toEqual({ NP_STORAGE_DIR: "./public/media" });
  });
});
