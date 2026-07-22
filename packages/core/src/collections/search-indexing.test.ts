import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  document: null as Record<string, unknown> | null,
}));
const hydrate = vi.hoisted(() => vi.fn());

vi.mock("./registry.js", () => ({
  getCollectionConfig: () => ({ community: { audience: true } }),
  getCollectionTable: () => ({ searchVector: {} }),
}));
vi.mock("./pipeline.js", () => ({
  npGetPersistedCollectionDocumentById: hydrate.mockImplementation(() => runtime.document),
}));
vi.mock("../observability/logger.js", () => ({
  getLogger: () => ({ error: vi.fn() }),
}));
vi.mock("../observability/error-reporter.js", () => ({ reportError: vi.fn() }));

import {
  getSearchAdapterDiagnostics,
  resetSearchAdapter,
  setSearchAdapter,
} from "./search-adapter.js";
import { npReplaceSearchCollectionIndex, npSyncSearchIndexDocument } from "./search-indexing.js";

function persistedDocument(id: string): Record<string, unknown> {
  return {
    id,
    siteId: "default",
    status: "published",
    visibility: "public",
    audience: "members",
    title: `Topic ${id}`,
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  };
}

afterEach(() => {
  resetSearchAdapter();
  runtime.document = null;
  hydrate.mockClear();
});

describe("external search index synchronization", () => {
  it("does not hydrate content for absent or query-only indexing capabilities", async () => {
    await npSyncSearchIndexDocument("forum-posts", "post-1", "default");
    setSearchAdapter({
      kind: "query-only",
      audience: "document-v1",
      search: () => null,
    });
    await npSyncSearchIndexDocument("forum-posts", "post-1", "default");
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("dispatches exact latest-state upserts and deletes", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    setSearchAdapter({
      kind: "capture",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write,
        replaceCollection: vi.fn(),
      },
    });
    runtime.document = persistedDocument("post-1");
    await npSyncSearchIndexDocument("forum-posts", "post-1", "default");
    runtime.document = null;
    await npSyncSearchIndexDocument("forum-posts", "post-1", "default");

    expect(write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "upsert",
        collection: "forum-posts",
        documentId: "post-1",
        siteId: "default",
        observedAt: expect.any(String),
        doc: expect.objectContaining({
          id: "post-1",
          audience: "members",
          updatedAt: "2026-07-22T00:00:00.000Z",
        }),
      }),
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operation: "delete", documentId: "post-1" }),
    );
    expect(Object.isFrozen(write.mock.calls[0]?.[0])).toBe(true);
  });

  it("requires full one-shot snapshot consumption before replace resolves", async () => {
    const received: unknown[] = [];
    const replaceCollection = vi.fn(async (context) => {
      expect(context).toEqual(
        expect.objectContaining({
          collection: "forum-posts",
          siteId: "*",
          startedAt: "2026-07-22T00:00:00.000Z",
        }),
      );
      expect(Object.isFrozen(context)).toBe(true);
      for await (const document of context.documents) received.push(document);
    });
    setSearchAdapter({
      kind: "capture",
      audience: "document-v1",
      search: () => null,
      indexing: { contract: "document-v1", write: vi.fn(), replaceCollection },
    });
    hydrate.mockImplementation((_collection, id) => persistedDocument(id as string));

    await npReplaceSearchCollectionIndex(
      "forum-posts",
      [
        { documentId: "post-1", siteId: "default" },
        { documentId: "post-2", siteId: "default" },
      ],
      "2026-07-22T00:00:00.000Z",
    );

    expect(received).toHaveLength(2);
    expect(received).toEqual([
      expect.objectContaining({ operation: "upsert", documentId: "post-1" }),
      expect.objectContaining({ operation: "upsert", documentId: "post-2" }),
    ]);
  });

  it("allows an empty snapshot only when the adapter consumes it", async () => {
    const replaceCollection = vi.fn(async (context) => {
      for await (const _document of context.documents) {
        throw new Error("empty replacement unexpectedly yielded a document");
      }
    });
    setSearchAdapter({
      kind: "capture",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write: vi.fn(),
        replaceCollection,
      },
    });

    await npReplaceSearchCollectionIndex("forum-posts", [], "2026-07-22T00:00:00.000Z");
    expect(replaceCollection).toHaveBeenCalledOnce();
  });

  it("fails retryably on non-void writes and incomplete replacements", async () => {
    setSearchAdapter({
      kind: "malformed",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write: () => "not-void" as never,
        replaceCollection: async (context) => {
          await context.documents[Symbol.asyncIterator]().next();
        },
      },
    });
    runtime.document = persistedDocument("post-1");

    await expect(npSyncSearchIndexDocument("forum-posts", "post-1", "default")).rejects.toThrow(
      /resolve to void/u,
    );
    await expect(
      npReplaceSearchCollectionIndex(
        "forum-posts",
        [
          { documentId: "post-1", siteId: "default" },
          { documentId: "post-2", siteId: "default" },
        ],
        "2026-07-22T00:00:00.000Z",
      ),
    ).rejects.toThrow(/consume the document stream completely/u);
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({
        indexWriteFailures: 1,
        indexReplaceFailures: 1,
        lastIndexFailure: expect.objectContaining({ operation: "index-replace" }),
      }),
    );
  });
});
