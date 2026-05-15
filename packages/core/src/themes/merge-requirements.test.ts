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
    // Synthesised collections carry the originating theme id so
    // the admin sidebar can hide them when that theme isn't
    // active (bundled-themes prebake / runtime-swap path).
    expect(cats?.admin?._themeOrigin).toBe("magazine");
  });

  it("does NOT stamp _themeOrigin on operator-declared collections that gain theme fields", () => {
    // The merge only tags COLLECTIONS it had to synthesise. A
    // collection the operator declared and the theme merely
    // extended (e.g. magazine adding `featured` to operator's
    // `posts`) stays operator-owned — admin shouldn't hide it
    // just because the active theme changed.
    const themeExtendsPosts = theme("magazine", {
      posts: { fields: { featured: { type: "checkbox" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeExtendsPosts]);
    const posts = out.find((c) => c.slug === "posts");
    expect(posts?.admin?._themeOrigin).toBeUndefined();
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

  it("skips select requirements that ship no options and warns", () => {
    // Without `options`, the field schema's `options.min(1)`
    // would reject the synthesised field; the merge skips it
    // entirely rather than producing an invalid collection.
    const themeSelect = theme("badtheme", {
      posts: { fields: { mood: { type: "select" } } },
    });
    const out = mergeThemeRequirements([basePosts], [themeSelect]);
    const mood = out[0]?.fields.find((f) => "name" in f && f.name === "mood");
    expect(mood).toBeUndefined();
    expect(warnings.some((w) => w.message.toLowerCase().includes("select"))).toBe(true);
  });

  it("synthesises a select requirement when options are present", () => {
    // The symmetric case to the union path: a brand-new select
    // field on a collection that doesn't have one yet. As long as
    // the theme provides options, the synthesised field is valid.
    const themeKind = theme("docs", {
      posts: {
        fields: {
          kind: {
            type: "select",
            options: [
              { label: "Article", value: "article" },
              { label: "Doc", value: "doc" },
            ],
          },
        },
      },
    });
    const out = mergeThemeRequirements([basePosts], [themeKind]);
    const kind = out[0]?.fields.find((f) => "name" in f && f.name === "kind");
    expect(kind?.type).toBe("select");
    if (kind?.type !== "select") return;
    expect(kind.options.map((o) => o.value).sort()).toEqual(["article", "doc"]);
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

  // ──────────────────────────────────────────────────────────────
  // Universal-content-model Phase U.1 (#748): select-options union
  // ──────────────────────────────────────────────────────────────

  it("unions select.options when both sides target a select with the same name", () => {
    const posts: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          type: "select",
          name: "kind",
          required: true,
          defaultValue: "article",
          options: [{ label: "Article", value: "article" }],
        },
      ],
    };
    const themeA = theme("docs", {
      posts: {
        fields: {
          kind: {
            type: "select",
            options: [{ label: "Doc", value: "doc" }],
          },
        },
      },
    });
    const themeB = theme("portfolio", {
      posts: {
        fields: {
          kind: {
            type: "select",
            options: [{ label: "Project", value: "project" }],
          },
        },
      },
    });

    const out = mergeThemeRequirements([posts], [themeA, themeB]);
    const merged = out.find((c) => c.slug === "posts");
    const kind = merged?.fields.find(
      (f) => "name" in f && f.name === "kind",
    );
    expect(kind?.type).toBe("select");
    if (kind?.type !== "select") return; // type narrow
    const values = kind.options.map((o) => o.value).sort();
    expect(values).toEqual(["article", "doc", "project"]);
    // Operator-declared "Article" option preserved; no warning fired
    // for the additive case.
    expect(warnings).toEqual([]);
  });

  it("dedupes select.options by value and last-wins on label", () => {
    const posts: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          type: "select",
          name: "kind",
          options: [{ label: "Article", value: "article" }],
        },
      ],
    };
    const themeRelabel = theme("rebrand", {
      posts: {
        fields: {
          kind: {
            type: "select",
            options: [{ label: "Story", value: "article" }],
          },
        },
      },
    });

    const out = mergeThemeRequirements([posts], [themeRelabel]);
    const merged = out.find((c) => c.slug === "posts");
    const kind = merged?.fields.find(
      (f) => "name" in f && f.name === "kind",
    );
    if (kind?.type !== "select") {
      throw new Error("expected merged kind to remain a select");
    }
    expect(kind.options).toHaveLength(1);
    expect(kind.options[0]).toEqual({ label: "Story", value: "article" });
  });

  it("does NOT union when the same-name field on the existing collection is not a select", () => {
    // Sanity: a `select` requirement against a `text` field of the
    // same name should still fall into the warn-and-skip path —
    // there is no sensible way to coerce a text column into a
    // select choice list mid-merge.
    const posts: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [{ type: "text", name: "kind" }],
    };
    const bogus = theme("bogus", {
      posts: {
        fields: {
          kind: {
            type: "select",
            options: [{ label: "Doc", value: "doc" }],
          },
        },
      },
    });
    const out = mergeThemeRequirements([posts], [bogus]);
    const merged = out.find((c) => c.slug === "posts");
    const kind = merged?.fields.find(
      (f) => "name" in f && f.name === "kind",
    );
    expect(kind?.type).toBe("text");
  });

  // ──────────────────────────────────────────────────────────────
  // Universal-content-model Phase U.2 (#750): kinds-metadata union
  // ──────────────────────────────────────────────────────────────

  it("stamps a theme's `kinds` metadata onto `admin.kinds`", () => {
    const themeDocs = theme("docs", {
      posts: {
        kinds: {
          doc: {
            label: "Doc",
            labelPlural: "Documentation",
            icon: "BookOpen",
            urlPattern: "/docs/:slug",
            hierarchical: true,
          },
        },
      },
    });
    const out = mergeThemeRequirements([basePosts], [themeDocs]);
    const merged = out.find((c) => c.slug === "posts");
    expect(merged?.admin?.kinds?.doc).toEqual({
      label: "Doc",
      labelPlural: "Documentation",
      icon: "BookOpen",
      urlPattern: "/docs/:slug",
      hierarchical: true,
      _themeOrigin: "docs",
    });
  });

  it("stamps `_themeOrigin` on every kind entry so the admin can gate by active theme", () => {
    const themeDocs = theme("docs", {
      posts: { kinds: { doc: { label: "Doc", labelPlural: "Docs" } } },
    });
    const themePortfolio = theme("portfolio", {
      posts: {
        kinds: { project: { label: "Project", labelPlural: "Projects" } },
      },
    });
    const out = mergeThemeRequirements([basePosts], [themeDocs, themePortfolio]);
    const kinds = out.find((c) => c.slug === "posts")?.admin?.kinds;
    expect(kinds?.doc?._themeOrigin).toBe("docs");
    expect(kinds?.project?._themeOrigin).toBe("portfolio");
  });

  it("unions kinds across two themes contributing different keys", () => {
    const themeDocs = theme("docs", {
      posts: {
        kinds: {
          doc: { label: "Doc", labelPlural: "Documentation" },
        },
      },
    });
    const themePortfolio = theme("portfolio", {
      posts: {
        kinds: {
          project: { label: "Project", labelPlural: "Projects" },
        },
      },
    });
    const out = mergeThemeRequirements(
      [basePosts],
      [themeDocs, themePortfolio],
    );
    const merged = out.find((c) => c.slug === "posts");
    expect(Object.keys(merged?.admin?.kinds ?? {}).sort()).toEqual([
      "doc",
      "project",
    ]);
  });

  it("last-wins on per-property when two themes claim the same kind value", () => {
    const themeA = theme("a", {
      posts: {
        kinds: {
          doc: { label: "Doc", labelPlural: "Docs", icon: "Book" },
        },
      },
    });
    const themeB = theme("b", {
      posts: {
        kinds: {
          // theme B re-labels and changes the icon. Last-write
          // wins (mirrors the select-options union rule).
          doc: { label: "Document", labelPlural: "Documentation", icon: "BookOpen" },
        },
      },
    });
    const out = mergeThemeRequirements([basePosts], [themeA, themeB]);
    const kind = out.find((c) => c.slug === "posts")?.admin?.kinds?.doc;
    expect(kind?.label).toBe("Document");
    expect(kind?.labelPlural).toBe("Documentation");
    expect(kind?.icon).toBe("BookOpen");
  });

  it("preserves other admin props when stamping kinds", () => {
    // Regression: the kinds merge spreads admin via `...target.admin`
    // — make sure it doesn't drop `group` / `icon` / etc.
    const postsWithAdmin: NpCollectionConfig = {
      ...basePosts,
      admin: { group: "Content", icon: "Newspaper" },
    };
    const themeDocs = theme("docs", {
      posts: {
        kinds: { doc: { label: "Doc", labelPlural: "Docs" } },
      },
    });
    const out = mergeThemeRequirements([postsWithAdmin], [themeDocs]);
    const merged = out.find((c) => c.slug === "posts");
    expect(merged?.admin?.group).toBe("Content");
    expect(merged?.admin?.icon).toBe("Newspaper");
    expect(merged?.admin?.kinds?.doc?.label).toBe("Doc");
  });
});
