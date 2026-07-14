import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NpStorageModule from "@nexpress/core/storage";

const runtime = vi.hoisted(() => ({
  config: null as NpStorageModule.NpStorageRuntimeConfig | null,
  kind: "memory",
}));

vi.mock("@nexpress/core", () => ({
  getAllPluginIds: vi.fn(),
  getJobsPauseState: vi.fn(),
  getOptionalJobQueue: vi.fn(),
  listWorkerHealth: vi.fn(),
}));

vi.mock("@nexpress/core/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof NpStorageModule>();
  return {
    ...actual,
    getOptionalStorageRuntimeConfig: () => runtime.config,
    getStorageAdapter: () => ({
      kind: runtime.kind,
      upload: () => Promise.resolve(),
      getStream: () => Promise.resolve(new ReadableStream()),
      getUrl: () => Promise.resolve("/media/health-probe"),
      delete: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
    }),
  };
});

vi.mock("@/lib/bootstrap", () => ({
  getDb: vi.fn(),
}));

const { checkStorageAdapter } = await import("./system-health.js");

afterEach(() => {
  vi.unstubAllEnvs();
  runtime.config = null;
  runtime.kind = "memory";
});

describe("live storage health", () => {
  it("reports the exact custom adapter kind", async () => {
    vi.stubEnv("NP_STORAGE_ADAPTER", "custom");
    runtime.kind = "cloudflare-r2";

    await expect(checkStorageAdapter()).resolves.toEqual(
      expect.objectContaining({
        id: "storage",
        state: "ok",
        detail: "custom (cloudflare-r2)",
      }),
    );
  });

  it("detects runtime intent and registered adapter mismatches", async () => {
    vi.stubEnv("NP_STORAGE_ADAPTER", "custom");
    runtime.kind = "local";

    await expect(checkStorageAdapter()).resolves.toEqual(
      expect.objectContaining({
        state: "error",
        detail: "custom requested, local registered",
      }),
    );
  });

  it("prefers the bootstrap-validated config over unrelated environment defaults", async () => {
    vi.stubEnv("NP_STORAGE_ADAPTER", "local");
    runtime.config = {
      adapter: "s3",
      s3: { bucket: "site-media", region: "us-east-1" },
    };
    runtime.kind = "s3";

    await expect(checkStorageAdapter()).resolves.toEqual(
      expect.objectContaining({
        state: "ok",
        detail: "s3 · site-media (us-east-1)",
      }),
    );
  });

  it("fails closed on malformed environment intent", async () => {
    vi.stubEnv("NP_STORAGE_ADAPTER", "S3");

    await expect(checkStorageAdapter()).resolves.toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("NP_STORAGE_ADAPTER"),
      }),
    );
  });
});
