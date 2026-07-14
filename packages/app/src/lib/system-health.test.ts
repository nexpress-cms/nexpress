import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NpStorageModule from "@nexpress/core/storage";
import type * as NpObservabilityModule from "@nexpress/core/observability";

const runtime = vi.hoisted(() => ({
  config: null as NpStorageModule.NpStorageRuntimeConfig | null,
  kind: "memory",
  observabilityConfig: null as NpObservabilityModule.NpObservabilityRuntimeConfig | null,
  loggerKind: "console",
  reporterKind: "noop",
  loggerFailures: 0,
  reporterFailures: 0,
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

vi.mock("@nexpress/core/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof NpObservabilityModule>();
  const loggerMethods = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return {
    ...actual,
    getObservabilityRuntimeConfig: () => runtime.observabilityConfig,
    getLogger: () => ({ kind: runtime.loggerKind, ...loggerMethods }),
    getErrorReporter: () => ({
      kind: runtime.reporterKind,
      captureException: () => undefined,
    }),
    getObservabilityDiagnostics: () => ({
      loggerFailures: runtime.loggerFailures,
      errorReporterFailures: runtime.reporterFailures,
      lastFailure: null,
    }),
  };
});

vi.mock("@/lib/bootstrap", () => ({
  getDb: vi.fn(),
}));

const { checkObservabilityAdapters, checkStorageAdapter } = await import("./system-health.js");

afterEach(() => {
  vi.unstubAllEnvs();
  runtime.config = null;
  runtime.kind = "memory";
  runtime.observabilityConfig = null;
  runtime.loggerKind = "console";
  runtime.reporterKind = "noop";
  runtime.loggerFailures = 0;
  runtime.reporterFailures = 0;
});

describe("live observability health", () => {
  it("warns when error reporting intentionally remains noop", () => {
    expect(checkObservabilityAdapters()).toEqual(
      expect.objectContaining({
        id: "observability",
        state: "warn",
        detail: "console logger · noop error reporter",
      }),
    );
  });

  it("reports exact custom adapter kinds", () => {
    runtime.observabilityConfig = { logger: "custom", errorReporter: "custom" };
    runtime.loggerKind = "pino";
    runtime.reporterKind = "sentry";

    expect(checkObservabilityAdapters()).toEqual(
      expect.objectContaining({
        state: "ok",
        detail: "pino logger · sentry reporter",
      }),
    );
  });

  it("detects declared intent and live adapter mismatch", () => {
    runtime.observabilityConfig = { logger: "custom", errorReporter: "custom" };

    expect(checkObservabilityAdapters()).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "custom/custom requested, console/noop registered",
      }),
    );
  });

  it("surfaces contained dispatch failures without crashing health", () => {
    runtime.observabilityConfig = { logger: "custom", errorReporter: "custom" };
    runtime.loggerKind = "pino";
    runtime.reporterKind = "sentry";
    runtime.loggerFailures = 2;
    runtime.reporterFailures = 1;

    expect(checkObservabilityAdapters()).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: expect.stringContaining("3 process failures contained"),
      }),
    );
  });

  it("fails closed on malformed environment intent", () => {
    vi.stubEnv("NP_ERROR_REPORTER_ADAPTER", "sentry");

    expect(checkObservabilityAdapters()).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("NP_ERROR_REPORTER_ADAPTER"),
      }),
    );
  });
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
