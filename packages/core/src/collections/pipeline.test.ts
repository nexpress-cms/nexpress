import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLogger, resetLogger, type NpLogger } from "../observability/logger.js";
import type { NpCollectionConfig } from "../config/types.js";
import {
  getCollectionRuntimeDiagnostics,
  resetCollectionRuntimeDiagnostics,
} from "./diagnostics.js";
import { npRunCollectionDocumentResultHooks, runPostCommit } from "./pipeline.js";

/**
 * Covers the swallow + log contract for `runPostCommit` (the
 * minimum-viable shim from #277). The full pipeline write path
 * is exercised by integration tests; this file just nails down
 * the contract a future refactor must not break.
 */

describe("runPostCommit (#277)", () => {
  let captured: Array<{
    level: string;
    message: string;
    data: Record<string, unknown> | undefined;
  }> = [];
  const mockLogger: NpLogger = {
    kind: "test",
    debug: () => {},
    info: () => {},
    warn: (message, data) => {
      captured.push({ level: "warn", message, data });
    },
    error: (message, data) => {
      captured.push({ level: "error", message, data });
    },
  };

  beforeEach(() => {
    captured = [];
    setLogger(mockLogger);
  });

  afterEach(() => {
    resetLogger();
  });

  it("calls the side-effect fn and resolves on success", async () => {
    const fn = vi.fn(() => Promise.resolve("ok"));
    await runPostCommit(
      "enqueue:content:afterSave",
      { collection: "posts", documentId: "doc-1", operation: "create" },
      fn,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(0);
  });

  it("swallows errors thrown from the side-effect fn", async () => {
    const boom = new Error("pg-boss connection refused");
    const fn = vi.fn(() => Promise.reject(boom));
    // Must NOT throw — the document is already durable; the caller
    // would otherwise see a successful save reported as a failure.
    await expect(
      runPostCommit(
        "enqueue:content:afterSave",
        { collection: "posts", documentId: "doc-1", operation: "create" },
        fn,
      ),
    ).resolves.toBeUndefined();
  });

  it("logs at error level with collection / documentId / label / message / stack", async () => {
    const boom = new Error("pg-boss connection refused");
    await runPostCommit(
      "enqueue:content:afterSave",
      { collection: "posts", documentId: "doc-1", operation: "create" },
      () => Promise.reject(boom),
    );
    expect(captured).toHaveLength(1);
    const entry = captured[0];
    expect(entry.level).toBe("error");
    expect(entry.message).toContain("post-commit");
    expect(entry.message).toContain("enqueue:content:afterSave");
    expect(entry.data).toMatchObject({
      collection: "posts",
      documentId: "doc-1",
      operation: "create",
      label: "enqueue:content:afterSave",
      error: "pg-boss connection refused",
    });
    expect(typeof entry.data?.stack).toBe("string");
  });

  it("handles non-Error throw values (string, object) without crashing", async () => {
    await runPostCommit(
      "hook:content:afterCreate",
      { collection: "posts", documentId: "doc-2" },
      // Reject with a string (not an Error) — the test asserts that
      // runPostCommit handles non-Error throw values without crashing.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      () => Promise.reject("plugin returned undefined"),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].data).toMatchObject({
      error: "plugin returned undefined",
      stack: undefined,
    });
  });

  it("does not invoke the logger when the side-effect succeeds", async () => {
    await runPostCommit(
      "hook:content:afterPublish",
      { collection: "posts", documentId: "doc-3", operation: "update" },
      () => Promise.resolve(undefined),
    );
    expect(captured).toHaveLength(0);
  });
});

describe("collection lifecycle result boundary", () => {
  const config: NpCollectionConfig = {
    slug: "flags",
    labels: { singular: "Flag", plural: "Flags" },
    timestamps: false,
    fields: [{ type: "checkbox", name: "enabled", required: true }],
  };
  const document = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "published",
    createdBy: null,
    updatedBy: null,
    visibility: "public",
    siteId: "default",
    enabled: true,
  };

  afterEach(() => resetCollectionRuntimeDiagnostics());

  it("runs an after-hook once and returns its exact document", async () => {
    const hook = vi.fn(() => Promise.resolve(document));
    await expect(
      npRunCollectionDocumentResultHooks(
        config,
        [hook],
        {
          data: document,
          user: null,
          principal: null,
          collection: "flags",
        },
        "write-result",
      ),
    ).resolves.toEqual(document);
    expect(hook).toHaveBeenCalledOnce();
  });

  it("rejects and diagnoses a malformed hook result", async () => {
    await expect(
      npRunCollectionDocumentResultHooks(
        config,
        [() => Promise.resolve({ ...document, extra: true })],
        {
          data: document,
          user: null,
          principal: null,
          collection: "flags",
        },
        "write-result",
      ),
    ).rejects.toThrow("Invalid collection document");
    expect(getCollectionRuntimeDiagnostics()).toEqual([
      expect.objectContaining({ collection: "flags", operation: "hook-result" }),
    ]);
  });
});
