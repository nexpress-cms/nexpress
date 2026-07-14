import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobLog = vi.hoisted(() => ({
  currentJobId: null as string | null,
  recordJobLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../jobs/job-log.js", () => ({
  getCurrentJobId: () => jobLog.currentJobId,
  recordJobLog: jobLog.recordJobLog,
}));

import { NpObservabilityContractError } from "./contract.js";
import { getObservabilityDiagnostics, resetObservabilityDiagnostics } from "./diagnostics.js";
import {
  getErrorReporter,
  noopErrorReporter,
  reportError,
  resetErrorReporter,
  setErrorReporter,
} from "./error-reporter.js";
import { consoleLogger, getLogger, getScopedLogger, resetLogger, setLogger } from "./logger.js";
import {
  configureObservability,
  configureObservabilityFromEnv,
  getObservabilityRuntimeConfig,
  resetObservability,
  shutdownObservability,
} from "./runtime.js";
import type { NpErrorReporter, NpLoggerAdapter } from "./types.js";

function logger(overrides: Partial<NpLoggerAdapter> = {}): NpLoggerAdapter {
  return {
    kind: "test",
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    ...overrides,
  };
}

describe("logger runtime boundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetLogger();
    resetObservabilityDiagnostics();
    jobLog.currentJobId = null;
    jobLog.recordJobLog.mockReset();
    jobLog.recordJobLog.mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("uses the validated console logger by default", () => {
    expect(getLogger()).toBe(consoleLogger);
    expect(getLogger().kind).toBe("console");
  });

  it("rejects malformed adapters at registration", () => {
    expect(() =>
      setLogger({
        kind: "Bad Kind",
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      }),
    ).toThrow(NpObservabilityContractError);
  });

  it("dispatches through a safe facade and merges scoped context", () => {
    const captured: Array<{ message: string; context?: Record<string, unknown> }> = [];
    setLogger(
      logger({
        info: (message, context) => {
          captured.push({ message, context });
        },
      }),
    );

    getScopedLogger({ pluginId: "seo-audit" }).info("score computed", { score: 87 });

    expect(captured).toEqual([
      { message: "score computed", context: { pluginId: "seo-audit", score: 87 } },
    ]);
  });

  it("uses a valid native child adapter", () => {
    const childInfo = vi.fn();
    setLogger(
      logger({
        child: () => logger({ info: childInfo }),
      }),
    );

    getScopedLogger({ pluginId: "analytics-lite" }).info("ready", { siteId: "site-1" });

    expect(childInfo).toHaveBeenCalledWith("ready", { siteId: "site-1" });
  });

  it("falls back to inline bindings when a native child violates the contract", () => {
    const parentInfo = vi.fn();
    setLogger(
      logger({
        info: parentInfo,
        child: () => logger({ kind: "different" }),
      }),
    );

    getScopedLogger({ pluginId: "webhook-relay" }).info("ready");

    expect(parentInfo).toHaveBeenCalledWith("ready", { pluginId: "webhook-relay" });
    expect(getObservabilityDiagnostics()).toMatchObject({ loggerFailures: 1 });
  });

  it("contains synchronous, rejected, and non-void adapter results", async () => {
    const invalidResult = logger({
      debug: (() => "unexpected") as unknown as NpLoggerAdapter["debug"],
      info: () => Promise.reject(new Error("async failure")),
      warn: () => {
        throw new Error("sync failure");
      },
    });
    setLogger(invalidResult);

    expect(() => getLogger().debug("one")).not.toThrow();
    expect(() => getLogger().info("two")).not.toThrow();
    expect(() => getLogger().warn("three")).not.toThrow();

    await vi.waitFor(() => {
      expect(getObservabilityDiagnostics().loggerFailures).toBe(3);
    });
  });

  it("contains rejection values that cannot be converted to strings", async () => {
    const unprintable = new Error("unprintable");
    Object.defineProperty(unprintable, "message", {
      get() {
        throw new Error("message getter failed");
      },
    });
    setLogger(logger({ info: () => Promise.reject(unprintable) }));

    expect(() => getLogger().info("one")).not.toThrow();

    await vi.waitFor(() => {
      expect(getObservabilityDiagnostics().lastFailure?.message).toBe(
        "Observability adapter failed with an unprintable value.",
      );
    });
  });

  it("keeps the validated adapter kind stable after installation", () => {
    const mutable = logger({ warn: () => Promise.reject(new Error("late failure")) });
    setLogger(mutable);
    (mutable as { kind: string }).kind = "mutated";

    getLogger().warn("one");

    return vi.waitFor(() => {
      expect(getObservabilityDiagnostics().lastFailure?.adapterKind).toBe("test");
    });
  });

  it("contains malformed events before calling the adapter", () => {
    const info = vi.fn();
    setLogger(logger({ info }));

    expect(() => getLogger().info("", { "invalid key": true })).not.toThrow();

    expect(info).not.toHaveBeenCalled();
    expect(getObservabilityDiagnostics().lastFailure).toMatchObject({
      component: "logger",
      operation: "contract",
      adapterKind: "test",
    });
  });

  it("tees custom logger events to the active job without recursive writes", async () => {
    const info = vi.fn();
    const error = vi.fn();
    setLogger(logger({ kind: "pino", info, error }));
    jobLog.currentJobId = "job-1";
    jobLog.recordJobLog.mockImplementationOnce(() => {
      getLogger().error("job log write failed");
      return Promise.resolve();
    });

    getLogger().info("processing", { documentId: "doc-1" });

    await vi.waitFor(() => {
      expect(jobLog.recordJobLog).toHaveBeenCalledOnce();
    });
    expect(jobLog.recordJobLog).toHaveBeenCalledWith("info", "processing", {
      documentId: "doc-1",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("job log write failed", undefined);
  });
});

describe("error reporter runtime boundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetErrorReporter();
    resetObservabilityDiagnostics();
    vi.restoreAllMocks();
  });

  it("uses the validated noop reporter by default", () => {
    expect(getErrorReporter()).toBe(noopErrorReporter);
    expect(getErrorReporter().kind).toBe("noop");
  });

  it("rejects malformed adapters at registration", () => {
    expect(() => setErrorReporter({ kind: "test" } as NpErrorReporter)).toThrow(
      NpObservabilityContractError,
    );
  });

  it("forwards validated errors and context", async () => {
    const captureException = vi.fn();
    setErrorReporter({ kind: "test", captureException });
    const error = new Error("boom");
    const context = { tags: { source: "api" }, user: { id: "user-1" } };

    await reportError(error, context);

    expect(captureException).toHaveBeenCalledWith(error, context);
  });

  it("contains throws, rejections, and non-void results", async () => {
    const reporters: NpErrorReporter[] = [
      {
        kind: "sync",
        captureException: () => {
          throw new Error("sync");
        },
      },
      { kind: "async", captureException: () => Promise.reject(new Error("async")) },
      {
        kind: "result",
        captureException: (() => "unexpected") as unknown as NpErrorReporter["captureException"],
      },
    ];

    for (const reporter of reporters) {
      setErrorReporter(reporter);
      await expect(reportError(new Error("original"))).resolves.toBeUndefined();
    }

    expect(getObservabilityDiagnostics()).toMatchObject({ errorReporterFailures: 3 });
    expect(console.error).toHaveBeenCalled();
  });

  it("contains malformed report context before calling the adapter", async () => {
    const captureException = vi.fn();
    setErrorReporter({ kind: "test", captureException });

    await expect(
      reportError(new Error("original"), { tags: { source: " " } }),
    ).resolves.toBeUndefined();

    expect(captureException).not.toHaveBeenCalled();
    expect(getObservabilityDiagnostics().errorReporterFailures).toBe(1);
  });
});

describe("observability runtime configuration and lifecycle", () => {
  beforeEach(() => {
    resetObservability();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetObservability();
    resetObservabilityDiagnostics();
    vi.restoreAllMocks();
  });

  it("reads exact built-in defaults from the environment", () => {
    expect(configureObservabilityFromEnv({})).toEqual({
      logger: "console",
      errorReporter: "noop",
    });
    expect(getObservabilityRuntimeConfig()).toEqual({
      logger: "console",
      errorReporter: "noop",
    });
  });

  it("rejects unknown environment values without mutating active adapters", () => {
    expect(() => configureObservabilityFromEnv({ NP_LOGGER_ADAPTER: "pino" })).toThrow(
      NpObservabilityContractError,
    );
    expect(getLogger()).toBe(consoleLogger);
    expect(getErrorReporter()).toBe(noopErrorReporter);
    expect(getObservabilityRuntimeConfig()).toBeNull();
  });

  it("requires custom intent and installed adapter kinds to agree transactionally", () => {
    const customLogger = logger({ kind: "pino" });
    expect(() =>
      configureObservability(
        { logger: "custom", errorReporter: "custom" },
        { logger: customLogger },
      ),
    ).toThrow(/do not match runtime intent/u);
    expect(getLogger()).toBe(consoleLogger);
    expect(getObservabilityRuntimeConfig()).toBeNull();
  });

  it("rejects adapter injection for built-in intent before mutating either component", () => {
    expect(() =>
      configureObservability(
        { logger: "console", errorReporter: "noop" },
        {
          logger: logger({ kind: "console" }),
          errorReporter: { kind: "noop", captureException: () => undefined },
        },
      ),
    ).toThrow(/may only be injected when logger intent is custom/u);

    expect(getLogger()).toBe(consoleLogger);
    expect(getErrorReporter()).toBe(noopErrorReporter);
    expect(getObservabilityRuntimeConfig()).toBeNull();
  });

  it("preserves process failure evidence across adapter replacement", async () => {
    setLogger(logger({ info: () => Promise.reject(new Error("old logger failed")) }));
    getLogger().info("before replacement");
    setLogger(logger({ kind: "replacement" }));

    await vi.waitFor(() => {
      expect(getObservabilityDiagnostics().lastFailure).toMatchObject({
        adapterKind: "test",
        message: "old logger failed",
      });
    });
    expect(getObservabilityDiagnostics().loggerFailures).toBe(1);
  });

  it("installs custom adapters and shuts both down even when one fails", async () => {
    const reporterShutdown = vi.fn();
    const loggerShutdown = vi.fn(() => Promise.reject(new Error("flush failed")));
    configureObservability(
      { logger: "custom", errorReporter: "custom" },
      {
        logger: logger({ kind: "pino", shutdown: loggerShutdown }),
        errorReporter: {
          kind: "sentry",
          captureException: () => undefined,
          shutdown: reporterShutdown,
        },
      },
    );

    await expect(shutdownObservability()).rejects.toThrow(AggregateError);

    expect(reporterShutdown).toHaveBeenCalledOnce();
    expect(loggerShutdown).toHaveBeenCalledOnce();
    expect(getLogger()).toBe(consoleLogger);
    expect(getErrorReporter()).toBe(noopErrorReporter);
    expect(getObservabilityRuntimeConfig()).toBeNull();
  });

  it("runs shutdown hooks for directly registered adapters that reuse built-in kind names", async () => {
    const loggerShutdown = vi.fn();
    const reporterShutdown = vi.fn();
    setLogger(logger({ kind: "console", shutdown: loggerShutdown }));
    setErrorReporter({
      kind: "noop",
      captureException: () => undefined,
      shutdown: reporterShutdown,
    });

    await expect(shutdownObservability()).resolves.toBeUndefined();

    expect(loggerShutdown).toHaveBeenCalledOnce();
    expect(reporterShutdown).toHaveBeenCalledOnce();
  });
});
