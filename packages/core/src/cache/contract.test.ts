import { describe, expect, it, vi } from "vitest";

import {
  npNormalizeCacheInvalidationRequest,
  npRequireCacheInvalidationRequest,
  npRequireCacheInvalidationResult,
  npRequireCacheKeyParts,
  npRequireCacheTags,
  npRequireCacheTtl,
  npRequireCdnPurgeAdapter,
} from "./contract.js";

describe("cache invalidation contract", () => {
  it("normalizes duplicate concrete paths and tags", () => {
    expect(
      npNormalizeCacheInvalidationRequest({
        source: "collection",
        collection: "posts",
        siteId: "default",
        paths: ["/blog", { path: "/blog", type: "page" }, "/blog"],
        tags: ["nx:posts", "nx:posts"],
      }),
    ).toEqual({
      source: "collection",
      collection: "posts",
      siteId: "default",
      paths: [{ path: "/blog" }, { path: "/blog", type: "page" }],
      tags: ["nx:posts"],
    });
  });

  it("keeps bounded document metadata distinct from executable path templates", () => {
    expect(
      npNormalizeCacheInvalidationRequest({
        source: "collection",
        collection: "posts",
        documentSlug: "question?{draft}",
        siteId: "default",
        tags: ["nx:collection:posts"],
      }),
    ).toMatchObject({ documentSlug: "question?{draft}" });
  });

  it.each([
    [{ source: "site", siteId: "default", tags: ["np:site:default"], typo: true }],
    [{ source: "site", siteId: "NOT VALID", tags: ["np:site:default"] }],
    [{ source: "collection", siteId: "default", tags: ["nx:posts"] }],
    [{ source: "plugin", siteId: null, tags: ["np:plugin:x"] }],
    [{ source: "site", siteId: "default", tags: ["nx:sitemap:{siteId}"] }],
    [{ source: "site", siteId: "default", paths: ["https://example.com"] }],
    [{ source: "site", siteId: "default", paths: ["/bad path"] }],
    [{ source: "site", siteId: "default", paths: [], tags: [] }],
    [{ source: "site", siteId: "default", pluginId: "forum", tags: ["np:site:default"] }],
    [{ source: "collection", collection: "BAD", siteId: "default", tags: ["nx:posts"] }],
    [
      {
        source: "collection",
        collection: `a${"b".repeat(63)}`,
        siteId: "default",
        tags: ["nx:posts"],
      },
    ],
    [
      {
        source: "navigation",
        navigationLocation: "BAD location",
        siteId: "default",
        tags: ["nx:navigation"],
      },
    ],
  ])("rejects malformed or incomplete concrete requests", (value) => {
    expect(() => npRequireCacheInvalidationRequest(value)).toThrow();
  });

  it("enforces exact coherent adapter results", () => {
    expect(() =>
      npRequireCacheInvalidationResult({
        status: "applied",
        paths: { requested: 1, succeeded: 0, failed: 1 },
        tags: { requested: 0, succeeded: 0, failed: 0 },
        cdn: { status: "not-configured", adapterKind: null },
      }),
    ).toThrow("applied results cannot contain failures");
    expect(() =>
      npRequireCacheInvalidationResult({
        status: "applied",
        paths: { requested: 0, succeeded: 0, failed: 0 },
        tags: { requested: 0, succeeded: 0, failed: 0 },
        cdn: { status: "not-configured", adapterKind: "custom" },
      }),
    ).toThrow();
  });

  it("bounds public cached-fetch keys, tags, and TTL", () => {
    expect(npRequireCacheKeyParts(["forum.list", "1"])).toEqual(["forum.list", "1"]);
    expect(npRequireCacheTags(["nx:collection:posts", "nx:collection:posts"])).toEqual([
      "nx:collection:posts",
    ]);
    expect(npRequireCacheTtl(60)).toBe(60);
    expect(() => npRequireCacheKeyParts([])).toThrow();
    expect(() => npRequireCacheTags(["bad tag"])).toThrow();
    expect(() => npRequireCacheTtl(0)).toThrow();

    const sparseTags = new Array<string>(1);
    const sparseKeys = new Array<string>(1);
    expect(() => npRequireCacheTags(sparseTags)).toThrow();
    expect(() => npRequireCacheKeyParts(sparseKeys)).toThrow();
    const tag = vi.fn(() => "np:site:default");
    const accessorTags = Object.defineProperty([], "0", {
      enumerable: true,
      configurable: true,
      get: tag,
    });
    Object.defineProperty(accessorTags, "length", { value: 1 });
    expect(() => npRequireCacheTags(accessorTags)).toThrow();
    expect(tag).not.toHaveBeenCalled();
  });

  it("rejects sparse target arrays and out-of-contract result counts", () => {
    const sparsePaths = new Array<string>(1);
    expect(() =>
      npRequireCacheInvalidationRequest({
        source: "site",
        siteId: "default",
        paths: sparsePaths,
      }),
    ).toThrow();
    expect(() =>
      npRequireCacheInvalidationResult({
        status: "applied",
        paths: { requested: 129, succeeded: 129, failed: 0 },
        tags: { requested: 0, succeeded: 0, failed: 0 },
        cdn: { status: "not-configured", adapterKind: null },
      }),
    ).toThrow();
    expect(() =>
      npRequireCacheInvalidationResult({
        status: "applied",
        paths: { requested: Symbol("bad"), succeeded: 0, failed: 0 },
        tags: { requested: 1, succeeded: 1, failed: 0 },
        cdn: { status: "not-configured", adapterKind: null },
      }),
    ).toThrow("Invalid cache invalidation result");
  });

  it("rejects accessor-backed request objects without invoking them", () => {
    const source = vi.fn(() => "site");
    const request = Object.defineProperty(
      { siteId: "default", tags: ["np:site:default"] },
      "source",
      { enumerable: true, get: source },
    );
    expect(() => npRequireCacheInvalidationRequest(request)).toThrow(
      "Invalid cache invalidation request",
    );
    expect(source).not.toHaveBeenCalled();
  });

  it("normalizes validated arrays without invoking custom iterators", () => {
    const iteratePaths = vi.fn(function* () {
      yield "/wrong";
    });
    const iterateTags = vi.fn(function* () {
      yield "wrong";
    });
    const paths = ["/expected"];
    const tags = ["np:site:default"];
    Object.defineProperty(paths, Symbol.iterator, { value: iteratePaths });
    Object.defineProperty(tags, Symbol.iterator, { value: iterateTags });

    expect(
      npNormalizeCacheInvalidationRequest({ source: "site", siteId: "default", paths, tags }),
    ).toMatchObject({ paths: [{ path: "/expected" }], tags: ["np:site:default"] });
    expect(iteratePaths).not.toHaveBeenCalled();
    expect(iterateTags).not.toHaveBeenCalled();
  });

  it("keeps legacy CDN adapters compatible while validating additive lifecycle fields", () => {
    const legacy = { purge() {} };
    expect(npRequireCdnPurgeAdapter(legacy)).toBe(legacy);
    expect(() => npRequireCdnPurgeAdapter(Object.assign([], { purge() {} }))).toThrow();
    expect(() => npRequireCdnPurgeAdapter({ kind: "BAD", purge() {} })).toThrow();
    expect(() => npRequireCdnPurgeAdapter({ purge() {}, shutdown: true })).toThrow();
  });
});
