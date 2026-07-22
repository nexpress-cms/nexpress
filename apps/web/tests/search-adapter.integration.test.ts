import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

function staffPostsRequest(staff: TestUserSession, body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/collections/posts", {
    method: "POST",
    headers: {
      cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
      "x-csrf-token": staff.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(skipIfNoTestDb())("search adapter (Phase 10.6)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const { resetSearchAdapter } = await import("@nexpress/core");
    resetSearchAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("default behavior: no adapter set, pg tsvector path runs", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Native walnut search",
        slug: "native-walnut",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections } = await import("@nexpress/core");
    const result = await searchCollections({ q: "walnut" });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.collection).toBe("posts");
  });

  it("adapter result wins when set; pg path is skipped", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Native pumpkin",
        slug: "native-pumpkin",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    let adapterCalls = 0;
    const { searchCollections, setSearchAdapter } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "test-adapter",
      audience: "document-v1",
      search: () => {
        adapterCalls += 1;
        // Return a wholly synthesized result that doesn't include
        // the seeded post — proves the adapter result was used,
        // not just merged on top of pg's.
        return {
          results: [
            {
              collection: "posts",
              doc: {
                id: "fake",
                siteId: "default",
                status: "published",
                visibility: "public",
                title: "Adapter-only result",
                slug: "adapter-only",
              },
            },
          ],
          total: 1,
          perCollection: { posts: 1 },
        };
      },
    });

    const result = await searchCollections({ q: "pumpkin", collections: ["posts"] });
    expect(adapterCalls).toBe(1);
    expect(result.total).toBe(1);
    expect(result.results[0]?.doc.title).toBe("Adapter-only result");
    // The seeded post is NOT in the result — the adapter
    // overrode the pg path entirely.
    expect(result.results.find((r) => r.doc.slug === "native-pumpkin")).toBeUndefined();
  });

  it("rejects restricted adapter pages using the exact audience-aware scope", async () => {
    let adapterCalls = 0;
    let captured: unknown = null;
    const { getSearchAdapterDiagnostics, searchCollections, setSearchAdapter } =
      await import("@nexpress/core");
    setSearchAdapter({
      kind: "audience-unaware",
      audience: "document-v1",
      search: (context) => {
        adapterCalls += 1;
        captured = context;
        return {
          results: [
            {
              collection: "forum-posts",
              doc: {
                id: "private-result",
                siteId: "default",
                status: "published",
                visibility: "public",
                audience: "private",
                title: "Must not escape the adapter",
              },
            },
          ],
          total: 1,
          perCollection: { "forum-posts": 1 },
        };
      },
    });

    const result = await searchCollections({
      q: "private",
      collections: ["forum-posts"],
    });
    expect(adapterCalls).toBe(1);
    expect(captured).toEqual(
      expect.objectContaining({
        audience: { mode: "public", collections: ["forum-posts"] },
      }),
    );
    expect(result).toMatchObject({ results: [], total: 0, perCollection: { "forum-posts": 0 } });
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({ resultContractFailures: 1, dispatchFailures: 0 }),
    );
  });

  it("uses audience-aware adapters for valid public and mixed collection pages", async () => {
    let captured: unknown = null;
    const { searchCollections, setSearchAdapter } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "audience-aware",
      audience: "document-v1",
      search: (context) => {
        captured = context;
        return {
          results: [
            {
              collection: "posts",
              doc: {
                id: "post-result",
                siteId: "default",
                status: "published",
                visibility: "public",
                title: "Public post",
              },
            },
            {
              collection: "forum-posts",
              doc: {
                id: "forum-result",
                siteId: "default",
                status: "published",
                visibility: "public",
                audience: "public",
                title: "Public forum post",
              },
            },
          ],
          total: 2,
          perCollection: { posts: 1, "forum-posts": 1 },
        };
      },
    });

    const result = await searchCollections({
      q: "public",
      collections: ["posts", "forum-posts"],
    });
    expect(captured).toEqual(
      expect.objectContaining({
        collections: ["posts", "forum-posts"],
        audience: { mode: "public", collections: ["forum-posts"] },
      }),
    );
    expect(result.results.map((entry) => entry.doc.id)).toEqual(["post-result", "forum-result"]);
  });

  it("adapter returning null falls through to pg tsvector", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Native brown fox",
        slug: "native-brown",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections, setSearchAdapter } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "test-adapter",
      audience: "document-v1",
      // Defer to pg by returning null — useful for adapters
      // that only handle certain collections or short queries.
      search: () => null,
    });

    // An explicit canonical slug is preserved by the write contract.
    const result = await searchCollections({ q: "brown", collections: ["posts"] });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.doc.slug).toBe("native-brown");
  });

  it("adapter throw is fail-open: pg path runs", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Resilient walnut",
        slug: "resilient-walnut",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections, setSearchAdapter } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "test-adapter",
      audience: "document-v1",
      search: () => {
        throw new Error("simulated upstream outage");
      },
    });

    // Should NOT throw — the adapter's error is logged and we
    // fall back to pg.
    const result = await searchCollections({ q: "walnut", collections: ["posts"] });
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("invalid adapter results are contained and fall through to Postgres", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Fallback chestnut",
        slug: "fallback-chestnut",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { getSearchAdapterDiagnostics, searchCollections, setSearchAdapter } =
      await import("@nexpress/core");
    setSearchAdapter({
      kind: "false-index",
      audience: "document-v1",
      search: () => false as never,
    });

    const falseResult = await searchCollections({ q: "chestnut", collections: ["posts"] });
    expect(falseResult.results.some((item) => item.doc.slug === "fallback-chestnut")).toBe(true);
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({
        adapterKind: "false-index",
        resultContractFailures: 1,
        dispatchFailures: 0,
      }),
    );

    setSearchAdapter({
      kind: "broken-index",
      audience: "document-v1",
      search: () => ({
        results: [
          {
            collection: "posts",
            doc: {
              id: "cross-site",
              siteId: "other-site",
              status: "published",
              visibility: "public",
            },
          },
        ],
        total: 1,
        perCollection: { posts: 1 },
      }),
    });

    const result = await searchCollections({ q: "chestnut", collections: ["posts"] });
    expect(result.results.some((item) => item.doc.slug === "fallback-chestnut")).toBe(true);
    expect(getSearchAdapterDiagnostics()).toEqual(
      expect.objectContaining({
        adapterKind: "broken-index",
        resultContractFailures: 1,
        dispatchFailures: 0,
      }),
    );
  });

  it("adapter receives the normalized context (q, limit, offset)", async () => {
    let captured: unknown = null;
    const { searchCollections, setSearchAdapter } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "capture",
      audience: "document-v1",
      search: (ctx) => {
        captured = ctx;
        return { results: [], total: 0, perCollection: { posts: 0 } };
      },
    });

    await searchCollections({
      q: "  trimmed  ",
      collections: ["posts"],
      limit: 7,
      offset: 14,
    });

    const ctx = captured as {
      q: string;
      collections: string[];
      limit: number;
      offset: number;
      siteId: string;
      visibility: string;
      audience: { mode: string; collections: string[] };
    };
    expect(ctx.q).toBe("trimmed");
    expect(ctx.collections).toEqual(["posts"]);
    expect(ctx.limit).toBe(7);
    expect(ctx.offset).toBe(14);
    expect(ctx.siteId).toBe("default");
    expect(ctx.visibility).toBe("public");
    expect(ctx.audience).toEqual({ mode: "public", collections: [] });
  });

  it("content jobs converge external entries on the latest persisted state", async () => {
    const staff = await seedUser({ role: "admin" });
    const actor = {
      id: staff.userId,
      email: staff.email,
      name: "Search operator",
      role: staff.role,
      tokenVersion: 0,
    };
    const writes: unknown[] = [];
    const {
      deleteDocument,
      getJobHandler,
      registerBuiltinHandlers,
      saveDocument,
      setSearchAdapter,
    } = await import("@nexpress/core");
    setSearchAdapter({
      kind: "capture-index",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write: (mutation) => {
          writes.push(mutation);
        },
        replaceCollection: async (context) => {
          for await (const _document of context.documents) {
            // Full consumption is part of the contract even when unused here.
          }
        },
      },
    });
    const created = await saveDocument(
      "posts",
      null,
      {
        title: "Original search title",
        excerpt: "summary",
        content: npCreateEmptyRichTextContent(),
        publishedAt: new Date().toISOString(),
        author: staff.userId,
      },
      actor,
      { status: "published" },
    );
    const id = created.doc.id as string;
    await saveDocument("posts", id, { title: "Latest search title" }, actor, {
      status: "published",
    });
    registerBuiltinHandlers();
    const afterSave = getJobHandler("content:afterSave");
    await afterSave?.({
      siteId: "default",
      collection: "posts",
      documentId: id,
      operation: "create",
      userId: staff.userId,
      memberId: null,
    });
    await deleteDocument("posts", id, actor);
    await afterSave?.({
      siteId: "default",
      collection: "posts",
      documentId: id,
      operation: "create",
      userId: staff.userId,
      memberId: null,
    });

    expect(writes).toEqual([
      expect.objectContaining({
        operation: "upsert",
        documentId: id,
        doc: expect.objectContaining({ title: "Latest search title" }),
      }),
      expect.objectContaining({ operation: "delete", documentId: id }),
    ]);
  });

  it("full reindex streams an exact all-site snapshot to indexing adapters", async () => {
    const staff = await seedUser({ role: "admin" });
    const actor = {
      id: staff.userId,
      email: staff.email,
      name: "Search operator",
      role: staff.role,
      tokenVersion: 0,
    };
    const documents: unknown[] = [];
    const { reindexCollection, saveDocument, setSearchAdapter } = await import("@nexpress/core");
    const saved = await saveDocument(
      "posts",
      null,
      {
        title: "Replacement snapshot",
        excerpt: "summary",
        content: npCreateEmptyRichTextContent(),
        publishedAt: new Date().toISOString(),
        author: staff.userId,
      },
      actor,
      { status: "published" },
    );
    let replacementContext: unknown = null;
    setSearchAdapter({
      kind: "capture-index",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write: () => undefined,
        replaceCollection: async (context) => {
          replacementContext = context;
          for await (const document of context.documents) documents.push(document);
        },
      },
    });

    const result = await reindexCollection("posts");

    expect(result).toEqual({ collection: "posts", processed: 1 });
    expect(replacementContext).toEqual(
      expect.objectContaining({ collection: "posts", siteId: "*", startedAt: expect.any(String) }),
    );
    expect(documents).toEqual([
      expect.objectContaining({
        operation: "upsert",
        collection: "posts",
        documentId: saved.doc.id,
        doc: expect.objectContaining({ title: "Replacement snapshot" }),
      }),
    ]);
  });

  it("setSearchAdapter rejects an object missing `search()`", async () => {
    const { setSearchAdapter } = await import("@nexpress/core");
    expect(() =>
      setSearchAdapter({
        kind: "invalid",
        audience: "document-v1",
        search: undefined as never,
      }),
    ).toThrow(/must be a function/u);
  });

  it("resetSearchAdapter restores the default (no adapter)", async () => {
    const { getSearchAdapter, setSearchAdapter, resetSearchAdapter } =
      await import("@nexpress/core");
    setSearchAdapter({
      kind: "test-adapter",
      audience: "document-v1",
      search: () => ({ results: [], total: 0, perCollection: {} }),
    });
    expect(getSearchAdapter()).not.toBeNull();
    resetSearchAdapter();
    expect(getSearchAdapter()).toBeNull();
  });
});
