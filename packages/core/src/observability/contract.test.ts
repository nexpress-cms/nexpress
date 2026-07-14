import { describe, expect, it } from "vitest";

import {
  NpObservabilityContractError,
  npAnalyzeErrorReportContext,
  npAnalyzeLogEvent,
  npObservabilityAdaptersMatchRuntimeConfig,
  npReadObservabilityRuntimeConfig,
  npRequireObservabilityAdapters,
  npRequireObservabilityRuntimeConfig,
} from "./contract.js";
import type { NpErrorReporter, NpLoggerAdapter } from "./types.js";

const logger: NpLoggerAdapter = {
  kind: "pino",
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const reporter: NpErrorReporter = {
  kind: "sentry",
  captureException: () => undefined,
};

describe("observability contract", () => {
  it("accepts bounded structured events while keeping nested values opaque", () => {
    expect(
      npAnalyzeLogEvent({
        level: "info",
        message: "content published",
        context: { documentId: "doc-1", nested: { arbitrary: [1, true] } },
      }),
    ).toEqual([]);
  });

  it("rejects unknown event fields and non-canonical context keys", () => {
    expect(
      npAnalyzeLogEvent({
        level: "info",
        message: "content published",
        timestamp: Date.now(),
        context: { "space key": true },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", path: "observability.log.timestamp" }),
        expect.objectContaining({
          code: "invalid-field",
          path: "observability.log.context.space key",
        }),
      ]),
    );
  });

  it("keeps error report context exact and validates bounded string metadata", () => {
    expect(
      npAnalyzeErrorReportContext({
        tags: { source: "api" },
        user: { id: "user-1" },
        extra: { route: "/api/posts" },
      }),
    ).toEqual([]);
    expect(npAnalyzeErrorReportContext({ tags: { source: " " }, request: {} })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "observability.errorReport.context.request" }),
        expect.objectContaining({ path: "observability.errorReport.context.tags.source" }),
      ]),
    );
  });

  it("parses only exact environment intent values", () => {
    expect(npReadObservabilityRuntimeConfig({})).toEqual({
      logger: "console",
      errorReporter: "noop",
    });
    expect(
      npReadObservabilityRuntimeConfig({
        NP_LOGGER_ADAPTER: "custom",
        NP_ERROR_REPORTER_ADAPTER: "custom",
      }),
    ).toEqual({ logger: "custom", errorReporter: "custom" });
    expect(() => npReadObservabilityRuntimeConfig({ NP_LOGGER_ADAPTER: "Pino" })).toThrow(
      NpObservabilityContractError,
    );
  });

  it("rejects unknown runtime and adapter option fields", () => {
    expect(() =>
      npRequireObservabilityRuntimeConfig({
        logger: "console",
        errorReporter: "noop",
        transport: "stdout",
      }),
    ).toThrow(/transport/u);
    expect(() => npRequireObservabilityAdapters({ logger, transport: {} })).toThrow(/transport/u);
  });

  it("matches declarative modes to concrete non-default adapter kinds", () => {
    expect(
      npObservabilityAdaptersMatchRuntimeConfig(
        { logger: "custom", errorReporter: "custom" },
        logger,
        reporter,
      ),
    ).toBe(true);
    expect(
      npObservabilityAdaptersMatchRuntimeConfig(
        { logger: "console", errorReporter: "noop" },
        logger,
        reporter,
      ),
    ).toBe(false);
  });
});
