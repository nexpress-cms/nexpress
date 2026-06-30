import { beforeEach, describe, expect, it } from "vitest";
import { registerCollection, type NpCollectionConfig } from "@nexpress/core";

import { postsCollection } from "./posts";

const postsWithKinds: NpCollectionConfig = {
  ...postsCollection,
  admin: {
    ...postsCollection.admin,
    kinds: {
      doc: { label: "Doc", labelPlural: "Docs", urlPattern: "/docs/:slug" },
      note: { label: "Note", labelPlural: "Notes" },
      project: { label: "Project", labelPlural: "Projects", urlPattern: "/work/:slug" },
    },
  },
};

const resolvePostUrl = (doc: Record<string, unknown>): string | null => {
  const resolver = postsWithKinds.seo?.urlPath;
  if (!resolver) throw new Error("posts collection must declare seo.urlPath");
  return resolver(doc);
};

describe("posts collection URL paths", () => {
  beforeEach(() => {
    registerCollection("posts", {}, postsWithKinds);
  });

  it("uses kind urlPattern metadata for canonical paths", () => {
    expect(resolvePostUrl({ slug: "identity", kind: "doc" })).toBe("/docs/identity");
    expect(resolvePostUrl({ slug: "identity", kind: "project" })).toBe("/work/identity");
  });

  it("falls back to the blog route for article, unknown, and patternless kinds", () => {
    expect(resolvePostUrl({ slug: "identity" })).toBe("/blog/identity");
    expect(resolvePostUrl({ slug: "identity", kind: "article" })).toBe("/blog/identity");
    expect(resolvePostUrl({ slug: "identity", kind: "note" })).toBe("/blog/identity");
    expect(resolvePostUrl({ slug: "identity", kind: "missing" })).toBe("/blog/identity");
  });

  it("returns null when a slug is not available", () => {
    expect(resolvePostUrl({ kind: "doc" })).toBeNull();
  });
});
