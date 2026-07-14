import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCacheInvalidationDiagnostics,
  resetCacheInvalidationDiagnostics,
} from "./diagnostics.js";
import {
  npInvalidateCache,
  npRunCacheInvalidation,
  npShutdownCacheInvalidationAdapter,
  resetCacheInvalidationAdapter,
  setCacheInvalidationAdapter,
} from "./runtime.js";

const request = {
  source: "site" as const,
  siteId: "default",
  tags: ["np:site:default"],
};

describe("cache invalidation runtime", () => {
  beforeEach(() => {
    resetCacheInvalidationAdapter();
    resetCacheInvalidationDiagnostics();
  });

  it("validates and records an exact adapter outcome", async () => {
    const invalidate = vi.fn(() => ({
      status: "applied" as const,
      paths: { requested: 0, succeeded: 0, failed: 0 },
      tags: { requested: 1, succeeded: 1, failed: 0 },
      cdn: { status: "not-configured" as const, adapterKind: null },
    }));
    setCacheInvalidationAdapter({ kind: "test", invalidate });

    await expect(npInvalidateCache(request)).resolves.toMatchObject({ status: "applied" });
    expect(invalidate).toHaveBeenCalledWith({
      source: "site",
      siteId: "default",
      paths: [],
      tags: ["np:site:default"],
    });
    expect(getCacheInvalidationDiagnostics()).toMatchObject({
      attempts: 1,
      applied: 1,
      partial: 0,
      unavailable: 0,
    });
  });

  it("contains dispatcher throws and reports unavailable", async () => {
    const adapter = {
      kind: "broken",
      invalidate: () => {
        throw new Error("provider exploded");
      },
    };

    await expect(npRunCacheInvalidation(adapter, request)).resolves.toMatchObject({
      status: "unavailable",
      tags: { requested: 1, succeeded: 0, failed: 1 },
    });
    expect(getCacheInvalidationDiagnostics()).toMatchObject({
      attempts: 1,
      unavailable: 1,
      dispatchFailures: 1,
      lastFailure: { operation: "dispatch", adapterKind: "broken" },
    });
  });

  it("fails closed on malformed adapter results", async () => {
    await expect(
      npRunCacheInvalidation(
        { kind: "broken", invalidate: () => ({ ok: true }) as never },
        request,
      ),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(getCacheInvalidationDiagnostics()).toMatchObject({
      dispatchFailures: 0,
      resultContractFailures: 1,
      shutdownFailures: 0,
      lastFailure: { operation: "result-contract" },
    });
  });

  it("reports an unconfigured host without throwing the write path", async () => {
    await expect(npInvalidateCache(request)).resolves.toMatchObject({ status: "unavailable" });
    expect(getCacheInvalidationDiagnostics().lastFailure?.adapterKind).toBe("unconfigured");
  });

  it("detaches failed adapter shutdown and records the lifecycle operation", async () => {
    setCacheInvalidationAdapter({
      kind: "test",
      invalidate: vi.fn(),
      shutdown: () => Promise.resolve("unexpected" as never),
    });

    await expect(npShutdownCacheInvalidationAdapter()).rejects.toThrow("must resolve to void");
    expect(getCacheInvalidationDiagnostics()).toMatchObject({
      dispatchFailures: 0,
      resultContractFailures: 0,
      shutdownFailures: 1,
      lastFailure: { operation: "shutdown" },
    });
    await expect(npInvalidateCache(request)).resolves.toMatchObject({ status: "unavailable" });
  });
});
