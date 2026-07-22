import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSearchAdapter,
  getSearchAdapterDiagnostics,
  npRecordSearchAdapterFailure,
  npRecordSearchIndexFailure,
  resetSearchAdapter,
  setSearchAdapter,
  shutdownSearchAdapter,
} from "./search-adapter.js";

afterEach(() => {
  resetSearchAdapter();
});

describe("search adapter runtime", () => {
  it("installs one canonical descriptor and resets stale diagnostics on replacement", () => {
    const first = setSearchAdapter({
      kind: "algolia",
      audience: "document-v1",
      search: vi.fn(() => null),
    });
    npRecordSearchAdapterFailure("algolia", "dispatch", new Error("offline"));
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({ adapterKind: "algolia", dispatchFailures: 1 }),
    );

    const second = setSearchAdapter({
      kind: "meilisearch",
      audience: "document-v1",
      search: vi.fn(() => null),
    });
    expect(second).not.toBe(first);
    expect(getSearchAdapterDiagnostics()).toEqual({
      adapterKind: "meilisearch",
      audienceContract: "document-v1",
      indexingContract: null,
      dispatchFailures: 0,
      resultContractFailures: 0,
      indexWriteFailures: 0,
      indexReplaceFailures: 0,
      shutdownFailures: 0,
      lastFailure: null,
      lastIndexFailure: null,
    });
  });

  it("records hostile thrown values without breaking fallback diagnostics", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
        get() {
          throw new Error("coercion trap");
        },
      },
    );

    expect(() => npRecordSearchAdapterFailure("hostile", "dispatch", hostile)).not.toThrow();
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({
        dispatchFailures: 1,
        lastFailure: expect.objectContaining({ message: "Unknown search adapter failure." }),
      }),
    );
  });

  it("reports the installed indexing contract and separate write/replace failures", () => {
    setSearchAdapter({
      kind: "meilisearch",
      audience: "document-v1",
      search: vi.fn(() => null),
      indexing: {
        contract: "document-v1",
        write: vi.fn(),
        replaceCollection: vi.fn(),
      },
    });
    npRecordSearchIndexFailure("meilisearch", "index-write", new Error("write failed"));
    npRecordSearchIndexFailure("meilisearch", "index-replace", new Error("replace failed"));

    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({
        indexingContract: "document-v1",
        indexWriteFailures: 1,
        indexReplaceFailures: 1,
        lastFailure: null,
        lastIndexFailure: expect.objectContaining({ operation: "index-replace" }),
      }),
    );
  });

  it("detaches before terminal cleanup and enforces a void result", async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const installed = setSearchAdapter({
      kind: "meilisearch",
      audience: "document-v1",
      search: vi.fn(() => null),
      shutdown,
    });

    await shutdownSearchAdapter(installed);
    expect(getSearchAdapter()).toBeNull();
    expect(shutdown).toHaveBeenCalledOnce();

    const malformed = setSearchAdapter({
      kind: "malformed",
      audience: "document-v1",
      search: vi.fn(() => null),
      shutdown: () => Promise.resolve("not-void" as never),
    });
    await expect(shutdownSearchAdapter(malformed)).rejects.toThrow(/resolve to void/u);
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({ adapterKind: null, shutdownFailures: 1 }),
    );
  });

  it("does not detach a replacement when an older owner shuts down", () => {
    const first = setSearchAdapter({
      kind: "algolia",
      audience: "document-v1",
      search: vi.fn(() => null),
    });
    const second = setSearchAdapter({
      kind: "meilisearch",
      audience: "document-v1",
      search: vi.fn(() => null),
    });

    resetSearchAdapter(first);
    expect(getSearchAdapter()).toBe(second);

    resetSearchAdapter(second);
    expect(getSearchAdapter()).toBeNull();
  });
});
