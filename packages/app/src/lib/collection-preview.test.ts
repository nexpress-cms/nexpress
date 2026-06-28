import { describe, expect, it } from "vitest";
import type { NpCollectionConfig } from "@nexpress/core";

import { normalizePreviewPath, resolveCollectionPreviewPath } from "./collection-preview.js";

const baseConfig: NpCollectionConfig = {
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  fields: [],
};

describe("collection preview paths", () => {
  it("normalizes same-origin public paths", () => {
    expect(normalizePreviewPath("/hello")).toBe("/hello");
    expect(normalizePreviewPath("/blog/hello")).toBe("/blog/hello");
  });

  it("rejects missing, external, and protocol-relative paths", () => {
    expect(normalizePreviewPath(null)).toBeNull();
    expect(normalizePreviewPath("")).toBeNull();
    expect(normalizePreviewPath("https://example.com/post")).toBeNull();
    expect(normalizePreviewPath("//example.com/post")).toBeNull();
    expect(normalizePreviewPath("/\\example.com/post")).toBeNull();
  });

  it("uses the collection seo urlPath as the preview source of truth", () => {
    const config: NpCollectionConfig = {
      ...baseConfig,
      seo: {
        urlPath: (doc) => {
          const slug = typeof doc.slug === "string" ? doc.slug : null;
          return slug ? `/${slug}` : null;
        },
      },
    };

    expect(resolveCollectionPreviewPath(config, { slug: "landing" })).toBe("/landing");
  });

  it("returns null when the resolver is absent, unsafe, or throws", () => {
    expect(resolveCollectionPreviewPath(baseConfig, { slug: "landing" })).toBeNull();
    expect(
      resolveCollectionPreviewPath(
        {
          ...baseConfig,
          seo: { urlPath: () => "https://example.com/landing" },
        },
        { slug: "landing" },
      ),
    ).toBeNull();
    expect(
      resolveCollectionPreviewPath(
        {
          ...baseConfig,
          seo: {
            urlPath: () => {
              throw new Error("bad resolver");
            },
          },
        },
        { slug: "landing" },
      ),
    ).toBeNull();
  });
});
