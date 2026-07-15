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

    const result = await searchCollections({ q: "pumpkin" });
    expect(adapterCalls).toBe(1);
    expect(result.total).toBe(1);
    expect(result.results[0]?.doc.title).toBe("Adapter-only result");
    // The seeded post is NOT in the result — the adapter
    // overrode the pg path entirely.
    expect(result.results.find((r) => r.doc.slug === "native-pumpkin")).toBeUndefined();
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
      // Defer to pg by returning null — useful for adapters
      // that only handle certain collections or short queries.
      search: () => null,
    });

    // posts.slugField derives the slug from title — the pipeline
    // ignores the value we pass.
    const result = await searchCollections({ q: "brown" });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.doc.slug).toBe("native-brown-fox");
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
      search: () => {
        throw new Error("simulated upstream outage");
      },
    });

    // Should NOT throw — the adapter's error is logged and we
    // fall back to pg.
    const result = await searchCollections({ q: "walnut" });
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
      search: () => false as never,
    });

    const falseResult = await searchCollections({ q: "chestnut" });
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

    const result = await searchCollections({ q: "chestnut" });
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
    };
    expect(ctx.q).toBe("trimmed");
    expect(ctx.collections).toEqual(["posts"]);
    expect(ctx.limit).toBe(7);
    expect(ctx.offset).toBe(14);
    expect(ctx.siteId).toBe("default");
    expect(ctx.visibility).toBe("public");
  });

  it("setSearchAdapter rejects an object missing `search()`", async () => {
    const { setSearchAdapter } = await import("@nexpress/core");
    expect(() => setSearchAdapter({ kind: "invalid", search: undefined as never })).toThrow(
      /must be a function/u,
    );
  });

  it("resetSearchAdapter restores the default (no adapter)", async () => {
    const { getSearchAdapter, setSearchAdapter, resetSearchAdapter } =
      await import("@nexpress/core");
    setSearchAdapter({
      kind: "test-adapter",
      search: () => ({ results: [], total: 0, perCollection: {} }),
    });
    expect(getSearchAdapter()).not.toBeNull();
    resetSearchAdapter();
    expect(getSearchAdapter()).toBeNull();
  });
});
