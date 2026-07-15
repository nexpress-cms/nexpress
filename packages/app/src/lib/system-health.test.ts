import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NpStorageModule from "@nexpress/core/storage";
import type * as NpObservabilityModule from "@nexpress/core/observability";
import type * as NpCacheModule from "@nexpress/core/cache";
import type * as NpSearchModule from "@nexpress/core/search";
import type * as NpI18nModule from "@nexpress/core/i18n";
import type * as NpCommunityModule from "@nexpress/core/community";

interface HealthTestRuntime {
  config: {
    adapter: "s3";
    s3: { bucket: string; region: string };
  } | null;
  kind: string;
  observabilityConfig: {
    logger: "custom";
    errorReporter: "custom";
  } | null;
  loggerKind: string;
  reporterKind: string;
  loggerFailures: number;
  reporterFailures: number;
  cacheAdapterKind: string | null;
  cacheAttempts: number;
  cachePartial: number;
  cacheUnavailable: number;
  searchAdapterKind: string | null;
  searchDispatchFailures: number;
  searchResultFailures: number;
  searchShutdownFailures: number;
  i18nConfigured: boolean;
  i18nLocales: number;
  i18nCompileFailures: number;
  i18nFormatFailures: number;
  communityFailures: number;
}

const runtime = vi.hoisted<HealthTestRuntime>(() => ({
  config: null,
  kind: "memory",
  observabilityConfig: null,
  loggerKind: "console",
  reporterKind: "noop",
  loggerFailures: 0,
  reporterFailures: 0,
  cacheAdapterKind: "next",
  cacheAttempts: 0,
  cachePartial: 0,
  cacheUnavailable: 0,
  searchAdapterKind: null,
  searchDispatchFailures: 0,
  searchResultFailures: 0,
  searchShutdownFailures: 0,
  i18nConfigured: true,
  i18nLocales: 2,
  i18nCompileFailures: 0,
  i18nFormatFailures: 0,
  communityFailures: 0,
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

vi.mock("@nexpress/core/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof NpCacheModule>();
  return {
    ...actual,
    getOptionalCacheInvalidationAdapter: () =>
      runtime.cacheAdapterKind ? { kind: runtime.cacheAdapterKind, invalidate: vi.fn() } : null,
    getCacheInvalidationDiagnostics: () => ({
      attempts: runtime.cacheAttempts,
      applied: runtime.cacheAttempts - runtime.cachePartial - runtime.cacheUnavailable,
      partial: runtime.cachePartial,
      unavailable: runtime.cacheUnavailable,
      dispatchFailures: 0,
      resultContractFailures: 0,
      shutdownFailures: 0,
      lastFailure: null,
    }),
  };
});

vi.mock("@nexpress/core/search", async (importOriginal) => {
  const actual = await importOriginal<typeof NpSearchModule>();
  return {
    ...actual,
    getSearchAdapterDiagnostics: () => ({
      adapterKind: runtime.searchAdapterKind,
      dispatchFailures: runtime.searchDispatchFailures,
      resultContractFailures: runtime.searchResultFailures,
      shutdownFailures: runtime.searchShutdownFailures,
      lastFailure:
        runtime.searchDispatchFailures +
          runtime.searchResultFailures +
          runtime.searchShutdownFailures >
        0
          ? {
              adapterKind: runtime.searchAdapterKind ?? "unknown",
              operation:
                runtime.searchShutdownFailures > 0
                  ? "shutdown"
                  : runtime.searchResultFailures > 0
                    ? "result-contract"
                    : "dispatch",
              message: "simulated search failure",
              occurredAt: "2026-07-15T00:00:00.000Z",
            }
          : null,
    }),
  };
});

vi.mock("@nexpress/core/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof NpI18nModule>();
  return {
    ...actual,
    getI18nRuntimeDiagnostics: () => ({
      configured: runtime.i18nConfigured,
      locales: runtime.i18nLocales,
      baseStrings: 4,
      pluginStrings: 3,
      effectiveBundleCacheEntries: 0,
      compiledMessageCacheEntries: 0,
      compileFailures: runtime.i18nCompileFailures,
      formatFailures: runtime.i18nFormatFailures,
      lastFailure:
        runtime.i18nCompileFailures + runtime.i18nFormatFailures > 0
          ? {
              operation: runtime.i18nCompileFailures > 0 ? "compile" : "format",
              locale: "en",
              key: "demo.title",
              message: "simulated i18n failure",
              occurredAt: "2026-07-15T00:00:00.000Z",
            }
          : null,
    }),
  };
});

vi.mock("@nexpress/core/community", async (importOriginal) => {
  const actual = await importOriginal<typeof NpCommunityModule>();
  return {
    ...actual,
    getCommunityRuntimeDiagnostics: () =>
      Array.from({ length: runtime.communityFailures }, () => ({
        source: "spam" as const,
        message: "simulated adapter failure",
        occurredAt: "2026-07-15T00:00:00.000Z",
      })),
  };
});

vi.mock("@/lib/bootstrap", () => ({
  getDb: vi.fn(),
}));

const {
  checkCacheInvalidation,
  checkObservabilityAdapters,
  checkI18nRuntime,
  checkCommunityRuntime,
  checkSearchAdapter,
  checkStorageAdapter,
} = await import("./system-health.js");

afterEach(() => {
  vi.unstubAllEnvs();
  runtime.config = null;
  runtime.kind = "memory";
  runtime.observabilityConfig = null;
  runtime.loggerKind = "console";
  runtime.reporterKind = "noop";
  runtime.loggerFailures = 0;
  runtime.reporterFailures = 0;
  runtime.cacheAdapterKind = "next";
  runtime.cacheAttempts = 0;
  runtime.cachePartial = 0;
  runtime.cacheUnavailable = 0;
  runtime.searchAdapterKind = null;
  runtime.searchDispatchFailures = 0;
  runtime.searchResultFailures = 0;
  runtime.searchShutdownFailures = 0;
  runtime.i18nConfigured = true;
  runtime.i18nLocales = 2;
  runtime.i18nCompileFailures = 0;
  runtime.i18nFormatFailures = 0;
  runtime.communityFailures = 0;
});

describe("live i18n health", () => {
  it("reports the validated registry inventory", () => {
    expect(checkI18nRuntime()).toEqual(
      expect.objectContaining({ state: "ok", detail: "2 locale(s) · 7 registered string(s)" }),
    );
  });

  it("surfaces contained ICU failures", () => {
    runtime.i18nFormatFailures = 1;
    expect(checkI18nRuntime()).toEqual(
      expect.objectContaining({ state: "warn", hint: expect.stringContaining("demo.title") }),
    );
  });

  it("keeps an intentional monolingual runtime healthy", () => {
    runtime.i18nConfigured = false;
    runtime.i18nLocales = 0;
    expect(checkI18nRuntime()).toEqual(
      expect.objectContaining({ state: "ok", detail: "disabled (monolingual)" }),
    );
  });
});

describe("live community health", () => {
  it("reports a healthy validated runtime", () => {
    expect(checkCommunityRuntime()).toEqual(
      expect.objectContaining({ state: "ok", detail: "registries and adapters valid" }),
    );
  });

  it("surfaces contained adapter contract failures", () => {
    runtime.communityFailures = 2;
    expect(checkCommunityRuntime()).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: "2 contained runtime contract failures",
        hint: expect.stringContaining("spam"),
      }),
    );
  });
});

describe("live search health", () => {
  it("reports the built-in Postgres path when no external adapter is installed", () => {
    expect(checkSearchAdapter()).toEqual(
      expect.objectContaining({ state: "ok", detail: "built-in Postgres tsvector" }),
    );
  });

  it("reports an exact healthy external adapter kind", () => {
    runtime.searchAdapterKind = "meilisearch";
    expect(checkSearchAdapter()).toEqual(
      expect.objectContaining({ state: "ok", detail: "external (meilisearch)" }),
    );
  });

  it("surfaces contained adapter result failures", () => {
    runtime.searchAdapterKind = "meilisearch";
    runtime.searchResultFailures = 2;
    expect(checkSearchAdapter()).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: "meilisearch · 2 failures contained",
        hint: expect.stringContaining("result-contract"),
      }),
    );
  });

  it("surfaces terminal cleanup failures in the same diagnostic row", () => {
    runtime.searchAdapterKind = "meilisearch";
    runtime.searchShutdownFailures = 1;
    expect(checkSearchAdapter()).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: "meilisearch · 1 failure contained",
        hint: expect.stringContaining("shutdown"),
      }),
    );
  });
});

describe("live cache invalidation health", () => {
  it("reports the installed host and successful attempts", () => {
    runtime.cacheAttempts = 3;
    expect(checkCacheInvalidation()).toEqual(
      expect.objectContaining({ state: "ok", detail: "next · 3/3 attempts applied" }),
    );
  });

  it("warns on contained partial or unavailable outcomes", () => {
    runtime.cacheAttempts = 3;
    runtime.cachePartial = 1;
    runtime.cacheUnavailable = 1;
    expect(checkCacheInvalidation()).toEqual(
      expect.objectContaining({ state: "warn", detail: "next · 1 partial · 1 unavailable" }),
    );
  });

  it("fails closed when bootstrap did not install a host", () => {
    runtime.cacheAdapterKind = null;
    expect(checkCacheInvalidation()).toEqual(
      expect.objectContaining({ state: "error", detail: "no host adapter registered" }),
    );
  });
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
