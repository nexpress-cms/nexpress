import { describe, expect, it } from "vitest";

import {
  NpSearchContractError,
  npAnalyzeSearchAdapterResult,
  npCreateEmptySearchResult,
  npCreateSearchResult,
  npParseSearchApiQuery,
  npParseSearchReindexQuery,
  npRequireSearchAdapter,
  npRequireSearchAdapterContext,
  npRequireSearchAdapterResult,
  npRequireSearchIndexMutation,
  npRequireSearchReindexResult,
  npRequireSearchReindexResponse,
  npRequireSearchRequest,
  npRequireSearchResolvedRequest,
  npRequireSearchResult,
  npSearchContractLimits,
} from "./contract.js";

const context = npRequireSearchAdapterContext({
  q: "walnut",
  collections: ["posts"],
  limit: 10,
  offset: 0,
  siteId: "default",
  visibility: "public",
  audience: { mode: "public", collections: [] },
});

function adapterResult() {
  return {
    results: [
      {
        collection: "posts",
        doc: {
          id: "post-1",
          siteId: "default",
          status: "published",
          visibility: "public",
          title: "Walnut guide",
          publishedAt: new Date("2026-07-15T00:00:00.000Z"),
        },
        score: 12.5,
      },
    ],
    total: 1,
    perCollection: { posts: 1 },
  };
}

describe("search request contract", () => {
  it("normalizes text and fills exact bounded defaults", () => {
    const parsed = npRequireSearchRequest({
      q: "  Ｗalnut\tguide  ",
      collections: ["posts", "pages"],
    });

    expect(parsed).toEqual({
      q: "Walnut guide",
      collections: ["posts", "pages"],
      limit: 10,
      offset: 0,
      visibility: "public",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.collections)).toBe(true);
  });

  it("rejects unknown fields, duplicate collections, unsafe numbers, and invalid locales", () => {
    expect(() => npRequireSearchRequest({ q: "x", extra: true })).toThrow(
      /unsupported search field/u,
    );
    expect(() => npRequireSearchRequest({ q: "x", collections: ["posts", "posts"] })).toThrow(
      /duplicate collection/u,
    );
    expect(() => npRequireSearchRequest({ q: "x", limit: Number.NaN })).toThrow(/safe integer/u);
    expect(() => npRequireSearchRequest({ q: "x", locale: "en-us" })).toThrow(/canonical BCP 47/u);
    expect(() => npRequireSearchRequest({ q: "x".repeat(257) })).toThrow(/at most 256/u);
  });

  it("separates resolved requests from framework-derived adapter contexts", () => {
    expect(
      npRequireSearchResolvedRequest({
        q: "walnut",
        limit: 10,
        offset: 0,
        siteId: "default",
        visibility: "public",
      }),
    ).toEqual({
      q: "walnut",
      limit: 10,
      offset: 0,
      siteId: "default",
      visibility: "public",
    });
    expect(() =>
      npRequireSearchResolvedRequest({
        q: "walnut",
        limit: 10,
        offset: 0,
        visibility: "public",
      }),
    ).toThrow(/siteId/u);
    expect(() => npRequireSearchResolvedRequest(context)).toThrow(/unsupported search field/u);
  });

  it("rejects hostile and oversized arrays before enumerating entries", () => {
    const target: unknown[] = [];
    Object.defineProperty(target, "length", {
      value: npSearchContractLimits.collectionCount + 1,
    });
    const proxied = new Proxy(target, {
      ownKeys() {
        throw new Error("must not enumerate");
      },
    });
    expect(() => npRequireSearchRequest({ q: "x", collections: proxied })).toThrow(/at most/u);

    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() => npRequireSearchRequest({ q: "x", collections: revoked.proxy })).toThrow(
      NpSearchContractError,
    );
  });

  it("parses one canonical public API query and rejects ambiguous URLs", () => {
    expect(
      npParseSearchApiQuery(
        new URLSearchParams(
          "q=%20walnut%20guide%20&collections=posts,pages&limit=5&page=2&locale=ko",
        ),
      ),
    ).toEqual({
      q: "walnut guide",
      collections: ["posts", "pages"],
      limit: 5,
      offset: 5,
      locale: "ko",
      visibility: "public",
    });

    expect(() => npParseSearchApiQuery(new URLSearchParams("limit=5"))).toThrow(/q.*required/u);
    expect(() => npParseSearchApiQuery(new URLSearchParams("q=x&q=y"))).toThrow(/only once/u);
    expect(() => npParseSearchApiQuery(new URLSearchParams("q=x&page=2&offset=5"))).toThrow(
      /mutually exclusive/u,
    );
    expect(() => npParseSearchApiQuery(new URLSearchParams("q=x&debug=1"))).toThrow(
      /unsupported query parameter/u,
    );
    expect(() =>
      npParseSearchApiQuery(
        new URLSearchParams(
          `q=x&collections=${Array.from({ length: 201 }, () => "posts").join(",")}`,
        ),
      ),
    ).toThrow(/at most 200/u);
  });
});

describe("search adapter and result contract", () => {
  it("requires an exact named adapter descriptor", () => {
    const adapter = npRequireSearchAdapter({
      kind: "algolia",
      audience: "document-v1",
      search: () => null,
    });
    expect(adapter.kind).toBe("algolia");
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(() =>
      npRequireSearchAdapter({
        kind: "Algolia",
        audience: "document-v1",
        search: () => null,
      }),
    ).toThrow(/canonical adapter kind/u);
    expect(() =>
      npRequireSearchAdapter({
        kind: "algolia",
        audience: "document-v1",
        search: () => null,
        extra: true,
      }),
    ).toThrow(/unsupported search field/u);
    expect(() => npRequireSearchAdapter({ kind: "algolia", search: () => null })).toThrow(
      /document-v1/u,
    );
  });

  it("accepts one optional exact document indexing capability", () => {
    const write = () => undefined;
    const replaceCollection = () => undefined;
    const adapter = npRequireSearchAdapter({
      kind: "meilisearch",
      audience: "document-v1",
      search: () => null,
      indexing: { contract: "document-v1", write, replaceCollection },
    });

    expect(adapter.indexing).toEqual({ contract: "document-v1", write, replaceCollection });
    expect(Object.isFrozen(adapter.indexing)).toBe(true);
    expect(() =>
      npRequireSearchAdapter({
        kind: "meilisearch",
        audience: "document-v1",
        search: () => null,
        indexing: { contract: "document-v1", write },
      }),
    ).toThrow(/replaceCollection/u);
    expect(() =>
      npRequireSearchAdapter({
        kind: "meilisearch",
        audience: "document-v1",
        search: () => null,
        indexing: { contract: "document-v1", write, replaceCollection, batchSize: 100 },
      }),
    ).toThrow(/unsupported search field/u);
  });

  it("validates and freezes exact latest-state index mutations", () => {
    const base = {
      collection: "forum-posts",
      siteId: "default",
      documentId: "post-1",
      observedAt: "2026-07-22T00:00:00.000Z",
    };
    const upsert = npRequireSearchIndexMutation(
      {
        operation: "upsert",
        ...base,
        doc: {
          id: "post-1",
          siteId: "default",
          status: "published",
          visibility: "public",
          audience: "members",
          title: "Member topic",
        },
      },
      true,
    );
    const deletion = npRequireSearchIndexMutation({ operation: "delete", ...base }, true);

    expect(upsert.operation).toBe("upsert");
    expect(Object.isFrozen(upsert)).toBe(true);
    expect(Object.isFrozen(upsert.operation === "upsert" ? upsert.doc : null)).toBe(true);
    expect(deletion).toEqual({ operation: "delete", ...base });
    expect(() =>
      npRequireSearchIndexMutation(
        {
          operation: "upsert",
          ...base,
          doc: {
            id: "other",
            siteId: "default",
            status: "published",
            visibility: "public",
            audience: "members",
          },
        },
        true,
      ),
    ).toThrow(/must match documentId/u);
    expect(() =>
      npRequireSearchIndexMutation({
        operation: "delete",
        ...base,
        doc: { id: "post-1" },
      }),
    ).toThrow(/must not include doc/u);
    expect(() =>
      npRequireSearchIndexMutation({ operation: "delete", ...base, doc: undefined }),
    ).toThrow(/must not include doc/u);
    expect(() =>
      npRequireSearchIndexMutation({
        operation: "delete",
        ...base,
        observedAt: "2026-07-22T00:00:00Z",
      }),
    ).toThrow(/canonical UTC ISO timestamp/u);
    expect(() =>
      npRequireSearchIndexMutation(
        {
          operation: "upsert",
          ...base,
          doc: {
            id: "post-1",
            siteId: "default",
            status: "published",
            visibility: "public",
          },
        },
        true,
      ),
    ).toThrow(/must expose their audience/u);
  });

  it("requires one exact framework-derived audience scope", () => {
    expect(context.audience).toEqual({ mode: "public", collections: [] });
    expect(Object.isFrozen(context.audience)).toBe(true);
    expect(Object.isFrozen(context.audience.collections)).toBe(true);
    expect(() =>
      npRequireSearchAdapterContext({
        ...context,
        audience: { mode: "all", collections: [] },
      }),
    ).toThrow(/must match the normalized visibility/u);
    expect(() =>
      npRequireSearchAdapterContext({
        ...context,
        audience: { mode: "public", collections: ["forum-posts", "forum-posts"] },
      }),
    ).toThrow(/duplicate audience-aware collection/u);
  });

  it("clones JSON-safe documents, canonicalizes dates, and freezes the envelope", () => {
    const raw = adapterResult();
    const parsed = npRequireSearchAdapterResult(raw, context, new Set(["posts"]));

    expect(parsed.results[0]?.doc.publishedAt).toBe("2026-07-15T00:00:00.000Z");
    expect(parsed.results[0]?.doc).not.toBe(raw.results[0]?.doc);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.results)).toBe(true);
    expect(Object.isFrozen(parsed.results[0]?.doc)).toBe(true);

    const extendedDate = new Date("2026-07-15T00:00:00.000Z") as Date & { note?: string };
    extendedDate.note = "hidden metadata";
    expect(() =>
      npRequireSearchAdapterResult(
        {
          ...adapterResult(),
          results: [
            {
              ...adapterResult().results[0],
              doc: { ...adapterResult().results[0].doc, publishedAt: extendedDate },
            },
          ],
        },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/must not have custom properties/u);
  });

  it("fails closed on site, visibility, count, duplicate, and object-shape mismatches", () => {
    expect(() => npRequireSearchAdapterResult(false, context, new Set(["posts"]))).toThrow(
      /must be plain objects/u,
    );

    expect(() =>
      npRequireSearchAdapterResult(
        {
          ...adapterResult(),
          results: [
            {
              ...adapterResult().results[0],
              doc: { ...adapterResult().results[0].doc, siteId: "tenant-b" },
            },
          ],
        },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/site scope/u);

    expect(() =>
      npRequireSearchAdapterResult(
        {
          ...adapterResult(),
          results: [
            {
              ...adapterResult().results[0],
              doc: { ...adapterResult().results[0].doc, visibility: "private" },
            },
          ],
        },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/public search results must be public/u);

    expect(() =>
      npRequireSearchAdapterResult(
        { ...adapterResult(), perCollection: { posts: 2 } },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/sum to total/u);

    expect(() =>
      npRequireSearchAdapterResult(
        { results: [], total: 0, perCollection: {} },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/must include a count/u);

    expect(() =>
      npRequireSearchAdapterResult(
        { results: [], total: 0, perCollection: {} },
        { ...context, collections: ["missing"] },
        new Set(["posts"]),
      ),
    ).toThrow(/not in the searchable catalog/u);

    const duplicate = adapterResult().results[0];
    expect(() =>
      npRequireSearchAdapterResult(
        { results: [duplicate, duplicate], total: 2, perCollection: { posts: 2 } },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/duplicate search result/u);

    const cyclic: Record<string, unknown> = {
      id: "post-1",
      siteId: "default",
      status: "published",
      visibility: "public",
    };
    cyclic.self = cyclic;
    expect(
      npAnalyzeSearchAdapterResult(
        {
          results: [{ collection: "posts", doc: cyclic }],
          total: 1,
          perCollection: { posts: 1 },
        },
        context,
        new Set(["posts"]),
      ).ok,
    ).toBe(false);
  });

  it("requires canonical public audiences for scoped adapter results", () => {
    const audienceContext = npRequireSearchAdapterContext({
      ...context,
      collections: ["forum-posts"],
      audience: { mode: "public", collections: ["forum-posts"] },
    });
    const result = (audience: unknown) => ({
      results: [
        {
          collection: "forum-posts",
          doc: {
            id: "forum-post-1",
            siteId: "default",
            status: "published",
            visibility: "public",
            ...(audience === undefined ? {} : { audience }),
          },
        },
      ],
      total: 1,
      perCollection: { "forum-posts": 1 },
    });

    expect(
      npRequireSearchAdapterResult(result("public"), audienceContext, new Set(["forum-posts"]))
        .results[0]?.doc.audience,
    ).toBe("public");
    expect(() =>
      npRequireSearchAdapterResult(result(undefined), audienceContext, new Set(["forum-posts"])),
    ).toThrow(/must expose their audience/u);
    expect(() =>
      npRequireSearchAdapterResult(result("members"), audienceContext, new Set(["forum-posts"])),
    ).toThrow(/must have public audience/u);
    expect(() =>
      npRequireSearchAdapterResult(result("friends"), audienceContext, new Set(["forum-posts"])),
    ).toThrow(/public.*members.*private/u);

    expect(
      npRequireSearchAdapterResult(
        result("private"),
        {
          ...audienceContext,
          visibility: "all",
          audience: { mode: "all", collections: ["forum-posts"] },
        },
        new Set(["forum-posts"]),
      ).results[0]?.doc.audience,
    ).toBe("private");
  });

  it("accepts trusted all-scope rows but still validates locale and document structure", () => {
    const trusted = npRequireSearchAdapterResult(
      {
        results: [
          {
            collection: "posts",
            doc: {
              id: "draft-1",
              siteId: "tenant-b",
              status: "draft",
              visibility: "private",
            },
          },
        ],
        total: 1,
        perCollection: { posts: 1 },
      },
      {
        ...context,
        siteId: "*",
        visibility: "all",
        audience: { mode: "all", collections: [] },
      },
      new Set(["posts"]),
    );
    expect(trusted.results[0]?.doc.status).toBe("draft");

    expect(() =>
      npRequireSearchAdapterResult(
        {
          ...adapterResult(),
          results: [
            {
              ...adapterResult().results[0],
              doc: { ...adapterResult().results[0].doc, locale: 3 },
            },
          ],
        },
        { ...context, locale: "ko" },
        new Set(["posts"]),
      ),
    ).toThrow(/canonical locale string/u);

    const accessorDoc = {
      id: "post-1",
      siteId: "default",
      status: "published",
      visibility: "public",
    } as Record<string, unknown>;
    Object.defineProperty(accessorDoc, "title", { enumerable: true, get: () => "unsafe" });
    expect(() =>
      npRequireSearchAdapterResult(
        {
          results: [{ collection: "posts", doc: accessorDoc }],
          total: 1,
          perCollection: { posts: 1 },
        },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/accessors are not supported/u);
  });

  it("rejects adapter pages that exceed the normalized result limit", () => {
    expect(() =>
      npRequireSearchAdapterResult(
        {
          results: Array.from({ length: 11 }, (_, index) => ({
            collection: "posts",
            doc: {
              id: `post-${index.toString()}`,
              siteId: "default",
              status: "published",
              visibility: "public",
            },
          })),
          total: 11,
          perCollection: { posts: 11 },
        },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/at most 10/u);

    expect(() =>
      npRequireSearchAdapterResult(
        { results: [], total: 1, perCollection: { posts: 1 } },
        context,
        new Set(["posts"]),
      ),
    ).toThrow(/complete normalized result page/u);
  });

  it("derives and revalidates framework-owned facet and pagination metadata", () => {
    const result = npCreateSearchResult(adapterResult(), context, { posts: "Posts" });
    expect(result).toEqual({
      results: [expect.objectContaining({ collection: "posts", score: 12.5 })],
      total: 1,
      perCollection: { posts: 1 },
      facets: [{ collection: "posts", label: "Posts", count: 1, selected: true }],
      limit: 10,
      offset: 0,
      hasNextPage: false,
    });
    expect(npRequireSearchResult(result, context, { posts: "Posts" })).toEqual(result);
    expect(() =>
      npRequireSearchResult({ ...result, hasNextPage: true }, context, { posts: "Posts" }),
    ).toThrow(/must match total/u);
    expect(() => npCreateSearchResult(adapterResult(), context, { posts: " Posts " })).toThrow(
      /bounded display text/u,
    );

    const terminalContext = npRequireSearchAdapterContext({
      ...context,
      offset: npSearchContractLimits.offset,
      limit: 1,
    });
    const terminalResult = npCreateSearchResult(
      { ...adapterResult(), total: 10_002, perCollection: { posts: 10_002 } },
      terminalContext,
      { posts: "Posts" },
    );
    expect(terminalResult.hasNextPage).toBe(false);
  });

  it("creates one stable empty envelope", () => {
    expect(npCreateEmptySearchResult({ q: "", limit: 7, offset: 14 })).toEqual({
      results: [],
      total: 0,
      perCollection: {},
      facets: [],
      limit: 7,
      offset: 14,
      hasNextPage: false,
    });
    expect(
      npCreateEmptySearchResult(
        { q: "", collections: ["posts"], limit: 7, offset: 0 },
        { posts: "Posts" },
      ),
    ).toEqual({
      results: [],
      total: 0,
      perCollection: { posts: 0 },
      facets: [{ collection: "posts", label: "Posts", count: 0, selected: true }],
      limit: 7,
      offset: 0,
      hasNextPage: false,
    });
  });
});

describe("search reindex contract", () => {
  it("parses one optional canonical collection and validates results", () => {
    expect(npParseSearchReindexQuery(new URLSearchParams())).toBeNull();
    expect(npParseSearchReindexQuery(new URLSearchParams("collection=posts"))).toBe("posts");
    expect(() => npParseSearchReindexQuery(new URLSearchParams("collection=Posts"))).toThrow(
      /canonical collection slug/u,
    );
    expect(npRequireSearchReindexResult({ collection: "posts", processed: 4 })).toEqual({
      collection: "posts",
      processed: 4,
    });
    expect(() => npRequireSearchReindexResult({ collection: "posts", processed: -1 })).toThrow(
      /non-negative/u,
    );
    expect(
      npRequireSearchReindexResponse({
        total: 7,
        collections: [
          { collection: "posts", processed: 4 },
          { collection: "pages", processed: 3 },
        ],
      }),
    ).toEqual({
      total: 7,
      collections: [
        { collection: "posts", processed: 4 },
        { collection: "pages", processed: 3 },
      ],
    });
    expect(() =>
      npRequireSearchReindexResponse({
        total: 8,
        collections: [
          { collection: "posts", processed: 4 },
          { collection: "pages", processed: 3 },
        ],
      }),
    ).toThrow(/processed collection sum/u);
  });
});
