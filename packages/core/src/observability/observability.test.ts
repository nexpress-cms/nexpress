import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consoleLogger,
  getLogger,
  getScopedLogger,
  resetLogger,
  setLogger,
} from "./logger.js";
import {
  getErrorReporter,
  noopErrorReporter,
  reportError,
  resetErrorReporter,
  setErrorReporter,
} from "./error-reporter.js";

describe("logger singleton", () => {
  afterEach(() => {
    resetLogger();
  });

  it("returns consoleLogger by default", () => {
    expect(getLogger()).toBe(consoleLogger);
  });

  it("setLogger replaces the active logger", () => {
    const calls: string[] = [];
    setLogger({
      debug: () => {},
      info: (msg) => calls.push(`info:${msg}`),
      warn: () => {},
      error: () => {},
    });
    getLogger().info("hello");
    expect(calls).toEqual(["info:hello"]);
  });

  it("getScopedLogger merges bindings with per-call context", () => {
    const captured: Array<{ msg: string; ctx: unknown }> = [];
    setLogger({
      debug: () => {},
      info: (msg, ctx) => captured.push({ msg, ctx }),
      warn: () => {},
      error: () => {},
    });
    const scoped = getScopedLogger({ pluginId: "seo-audit" });
    scoped.info("score computed", { score: 87 });
    expect(captured).toEqual([
      { msg: "score computed", ctx: { pluginId: "seo-audit", score: 87 } },
    ]);
  });

  it("getScopedLogger uses native child() when available", () => {
    const childCalls: Array<Record<string, unknown>> = [];
    const fakeChild = {
      debug: () => {},
      info: (_msg: string, ctx?: Record<string, unknown>) => {
        if (ctx) childCalls.push(ctx);
      },
      warn: () => {},
      error: () => {},
    };
    setLogger({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => fakeChild,
    });
    const scoped = getScopedLogger({ pluginId: "x" });
    scoped.info("hello", { extra: true });
    expect(childCalls).toEqual([{ extra: true }]);
  });
});

describe("error reporter", () => {
  afterEach(() => {
    resetErrorReporter();
  });

  it("returns noopErrorReporter by default", () => {
    expect(getErrorReporter()).toBe(noopErrorReporter);
  });

  it("setErrorReporter replaces the active reporter", () => {
    const captured: Error[] = [];
    setErrorReporter({
      captureException: (err) => {
        captured.push(err);
      },
    });
    const err = new Error("boom");
    void reportError(err, { tags: { source: "test" } });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(err);
  });

  it("reportError swallows reporter exceptions", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorReporter({
      captureException: () => {
        throw new Error("reporter is broken");
      },
    });
    await expect(reportError(new Error("original"))).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[nexpress] error reporter itself threw:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("forwards context to the reporter", async () => {
    const captured: Array<{ err: Error; ctx?: unknown }> = [];
    setErrorReporter({
      captureException: (err, ctx) => {
        captured.push({ err, ctx });
      },
    });
    await reportError(new Error("x"), {
      tags: { source: "api", route: "/api/foo" },
      user: { id: "u1" },
    });
    expect(captured[0]?.ctx).toEqual({
      tags: { source: "api", route: "/api/foo" },
      user: { id: "u1" },
    });
  });
});
