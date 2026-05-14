import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  NpCollectionConfig,
  NpRegisteredTheme,
  NpThemeCollectionRequirement,
  NpThemeManifest,
} from "../config/types.js";
import { type NpLogger, resetLogger, setLogger } from "../observability/logger.js";

import { mergeThemeRequirements } from "./merge-requirements.js";

function theme(
  id: string,
  collections: Record<string, NpThemeCollectionRequirement>,
): NpRegisteredTheme {
  const manifest: NpThemeManifest = {
    id,
    name: id,
    version: "0.1.0",
    requires: { collections },
  };
  return { manifest, impl: {} };
}

const basePosts: NpCollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ type: "text", name: "title" }],
};

describe("mergeThemeRequirements — auto-merge of theme.requires.collections", () => {
  const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];

  beforeEach(() => {
    warnings.length = 0;
    const noopChild = (): NpLogger => ({
      debug: () => {},
      info: () => {},
      warn: (message, context) => {
        warnings.push({ message, context });
      },
      error: () => {},
      child: noopChild,
    });
    const captureLogger: NpLogger = {
      debug: () => {},
      info: () => {},
      warn: (message, context) => {
        warnings.push({ message, context });
      },
      error: () => {},
      child: noopChild,
    };
    setLogger(captureLogger);
  });

  afterEach(() => {
    resetLogger();
  });

  it("returns the input array reference when no themes are registered", () => {
    const input = [basePosts];
    const out = mergeThemeRequirements(input, undefined);
    expect(out).toBe(input);
  });

  it("returns the same content (no extra fields) when themes have no requires", () => {
    const out = mergeThemeRequirements(
      [basePosts],
      [
        {
          manifest: { id: "noop", name: "Noop", version: "0.1.0" },
          impl: {},
        },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.fields).toEqual([{ type: "text", name: "title" }]);
  });

  it("merges magazine-style requirements onto an existing posts collection", () => {
    const magazineTheme = theme("magazine", {
      posts: {
        fields: {
          featured: { type: "checkbox" },
          coverImage: { type: "upload", relationTo: "media" },
          categories: { type: "relationship", relationTo: "categories", hasMany: true },
          author: { type: "relationship", relationTo: "authors", hard: false },
        },
      },
    });

    const out = mergeThemeRequirements([basePosts], [magazineTheme]);
    expect(out).toHaveLength(1);
    const posts = out[0];
    if (!posts) throw new Error("expected merged posts");
    const names = posts.fields.map((f) => ("name" in f ? f.name : f.type));
    expect(names).toEqual(["title", "featured", "coverImage", "categories", "author"]);

    const cover = posts.fields.find((f) => "name" in f && f.name === "coverImage");
    expect(cover).toMatchObject({ type: "upload", relationTo: "media" });

    const categories = posts.fields.find(
      (f) => "name" in f && f.name === "categories",
    );
    expect(categories).toMatchObject({
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
    });
  });

  it("synthesises a collection when createIfAbsent is true and slug is missing", () => {
    const themeWithCreate = theme("magazine", {
      categories: {
        createIfAbsent: true,
        fields: {
          name: { type: "text", required: true },
          description: { type: "textarea", hard: false },
        },
      },
    });

    const out = mergeThemeRequirements([basePosts], [themeWithCreate]);
    expect(out).toHaveLength(2);
    const cats = out.find((c) => c.slug === "categories");
    expect(cats).toBeDefined();
    expect(cats?.labels).toEqual({ singular: "Categorie", plural: "Categories" });
    expect(cats?.fields.map((f) => ("name" in f ? f.name : ""))).toEqual([
      "name",
      "description",
    ]);
  });

  it("does NOT create a missing collection when createIfAbsent is absent", () => {
    const themeWithoutCreate = theme("magazine", {
      authors: { fields: { name: { type: "text" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeWithoutCreate]);
    expect(out).toHaveLength(1);
    expect(out[0]?.slug).toBe("posts");
  });

  it("operator-declared fields win over theme requirements", () => {
    const operatorPosts: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        { type: "text", name: "title" },
        // Operator declared a `featured` field but as a select,
        // not a checkbox like the theme expects. The merge MUST
        // keep the operator's definition intact — the theme's
        // mismatch surfaces via checkThemeRequirements as a
        // type conflict the operator can resolve at their pace.
        {
          type: "select",
          name: "featured",
          options: [
            { label: "Yes", value: "y" },
            { label: "No", value: "n" },
          ],
        },
      ],
    };
    const themeWithChk = theme("magazine", {
      posts: { fields: { featured: { type: "checkbox" } } },
    });
    const out = mergeThemeRequirements([operatorPosts], [themeWithChk]);
    const featured = out[0]?.fields.find((f) => "name" in f && f.name === "featured");
    expect(featured?.type).toBe("select");
    // No duplicate appended either.
    const featuredCount = (out[0]?.fields ?? []).filter(
      (f) => "name" in f && f.name === "featured",
    ).length;
    expect(featuredCount).toBe(1);
  });

  it("first theme wins on a field-name collision and warns about the second", () => {
    const themeA = theme("alpha", {
      posts: { fields: { featured: { type: "checkbox" } } },
    });
    const themeB = theme("beta", {
      posts: { fields: { featured: { type: "text" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeA, themeB]);
    const featured = out[0]?.fields.find((f) => "name" in f && f.name === "featured");
    expect(featured?.type).toBe("checkbox");

    expect(warnings.some((w) => w.message.includes("Two themes contribute"))).toBe(true);
  });

  it("walks containers — fields inside row/collapsible block the merge", () => {
    const wrappedPosts: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          type: "row",
          fields: [
            { type: "text", name: "title" },
            // Operator declared `featured` deep in a row layout.
            // The merge MUST treat that as "operator already has
            // it" and not append a duplicate at the top level.
            { type: "checkbox", name: "featured" },
          ],
        },
      ],
    };
    const themeWithReq = theme("magazine", {
      posts: { fields: { featured: { type: "checkbox" } } },
    });
    const out = mergeThemeRequirements([wrappedPosts], [themeWithReq]);
    // Same exact field array, no append.
    expect(out[0]?.fields).toBe(wrappedPosts.fields);
  });

  it("skips select requirements and warns (no synthesisable default)", () => {
    const themeSelect = theme("badtheme", {
      posts: { fields: { mood: { type: "select" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeSelect]);
    const mood = out[0]?.fields.find((f) => "name" in f && f.name === "mood");
    expect(mood).toBeUndefined();
    expect(warnings.some((w) => w.message.toLowerCase().includes("select"))).toBe(true);
  });

  it("skips upload requirements with no relationTo and warns", () => {
    const themeUpload = theme("badtheme", {
      posts: { fields: { hero: { type: "upload" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeUpload]);
    const hero = out[0]?.fields.find((f) => "name" in f && f.name === "hero");
    expect(hero).toBeUndefined();
    expect(warnings.some((w) => w.message.toLowerCase().includes("upload"))).toBe(true);
  });

  it("never mutates the caller's input collections array or its objects", () => {
    const collections: NpCollectionConfig[] = [basePosts];
    const originalFields = basePosts.fields;
    const out = mergeThemeRequirements(
      collections,
      [
        theme("magazine", {
          posts: { fields: { featured: { type: "checkbox" } } },
        }),
      ],
    );
    // Caller's array unchanged in length / identity.
    expect(collections).toHaveLength(1);
    expect(collections[0]?.fields).toBe(originalFields);
    expect(originalFields).toHaveLength(1);
    // Merged result is a new array with a fresh inner record.
    expect(out).not.toBe(collections);
    expect(out[0]).not.toBe(basePosts);
    expect(out[0]?.fields).not.toBe(originalFields);
  });

  it("verification scenario — magazine theme + plain posts produces the documented field set", () => {
    // This is the test the brief specifies: defineConfig-style
    // call shape, verifying the resolved fields contain every
    // theme-declared name.
    const magazineTheme: NpRegisteredTheme = {
      manifest: {
        id: "magazine",
        name: "Magazine",
        version: "0.1.0",
        requires: {
          collections: {
            posts: {
              fields: {
                featured: { type: "checkbox" },
                coverImage: { type: "upload", relationTo: "media" },
                categories: {
                  type: "relationship",
                  relationTo: "categories",
                  hasMany: true,
                },
                author: {
                  type: "relationship",
                  relationTo: "authors",
                  hard: false,
                },
              },
            },
            categories: {
              createIfAbsent: true,
              fields: {
                name: { type: "text", required: true },
                description: { type: "textarea", hard: false },
              },
            },
            authors: {
              createIfAbsent: true,
              fields: {
                name: { type: "text", required: true },
                bio: { type: "textarea", hard: false },
              },
            },
          },
        },
      },
      impl: {},
    };

    const postsCollection: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        { type: "text", name: "title" },
        { type: "richText", name: "body" },
      ],
    };

    const out = mergeThemeRequirements([postsCollection], [magazineTheme]);

    const posts = out.find((c) => c.slug === "posts");
    expect(posts).toBeDefined();
    const names = (posts?.fields ?? []).map((f) =>
      "name" in f ? f.name : f.type,
    );
    for (const expected of ["featured", "coverImage", "categories", "author"]) {
      expect(names).toContain(expected);
    }
    // categories + authors synthesised
    expect(out.find((c) => c.slug === "categories")).toBeDefined();
    expect(out.find((c) => c.slug === "authors")).toBeDefined();
  });
});
