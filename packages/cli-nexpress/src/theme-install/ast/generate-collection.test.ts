import { describe, expect, it } from "vitest";

import {
  renderFieldLiteral,
  renderNewCollectionFile,
} from "./generate-collection.js";

describe("renderFieldLiteral", () => {
  it("renders text field with name + type", () => {
    expect(renderFieldLiteral("title", { type: "text" })).toBe(
      `{ name: "title", type: "text" }`,
    );
  });

  it("includes required: true when set", () => {
    expect(
      renderFieldLiteral("title", { type: "text", required: true }),
    ).toContain("required: true");
  });

  it("renders relationTo as string", () => {
    expect(
      renderFieldLiteral("category", {
        type: "relationship",
        relationTo: "categories",
      }),
    ).toContain('relationTo: "categories"');
  });

  it("renders relationTo as array", () => {
    expect(
      renderFieldLiteral("rel", {
        type: "relationship",
        relationTo: ["a", "b"],
      }),
    ).toContain('relationTo: ["a", "b"]');
  });

  it("renders hasMany: true when set", () => {
    expect(
      renderFieldLiteral("tags", {
        type: "relationship",
        relationTo: "tags",
        hasMany: true,
      }),
    ).toContain("hasMany: true");
  });
});

describe("renderNewCollectionFile", () => {
  it("renders a defineCollection skeleton with import + export", () => {
    const out = renderNewCollectionFile("authors", {
      fields: {
        name: { type: "text", required: true },
        bio: { type: "textarea" },
      },
    });
    expect(out).toContain('import { defineCollection } from "@nexpress/core"');
    expect(out).toContain("export const authorsCollection = defineCollection");
    expect(out).toContain('slug: "authors"');
    expect(out).toContain('labels: { singular: "Author", plural: "Authors" }');
    expect(out).toContain('name: "name"');
    expect(out).toContain('name: "bio"');
  });

  it("camelCases hyphenated slugs for the export name", () => {
    const out = renderNewCollectionFile("blog-posts", {
      fields: { title: { type: "text" } },
    });
    expect(out).toContain("export const blogPostsCollection = defineCollection");
  });

  it("title-cases label fallback", () => {
    const out = renderNewCollectionFile("authors", {
      fields: { name: { type: "text" } },
    });
    expect(out).toContain('singular: "Author"');
    expect(out).toContain('plural: "Authors"');
  });

  it("singular falls back to slug when slug doesn't end in s", () => {
    const out = renderNewCollectionFile("media", {
      fields: { url: { type: "text" } },
    });
    // Both singular and plural use the same Title-Cased slug
    // when we can't strip a trailing s.
    expect(out).toContain('labels: { singular: "Media", plural: "Media" }');
  });

  it("emits zero-field collection cleanly", () => {
    const out = renderNewCollectionFile("empty", { fields: {} });
    expect(out).toContain("fields: [");
    expect(out).toContain("],");
  });

  // Issue #608 — generated collections with a `title: text`
  // field get a default `slugField` + `seo.urlPath` so reference
  // themes (magazine category archives, docs sidebar, portfolio
  // project cards) actually find a slug on the row + a working
  // URL helper for the sitemap.
  describe("safe defaults (#608)", () => {
    it("emits slugField when requirement has a title:text field", () => {
      const out = renderNewCollectionFile("docs", {
        fields: { title: { type: "text", required: true }, body: { type: "richText" } },
      });
      expect(out).toContain('slugField: { useField: "title", unique: true }');
    });

    it("emits seo.urlPath using the collection slug", () => {
      const out = renderNewCollectionFile("docs", {
        fields: { title: { type: "text" } },
      });
      // The generated function returns `/<slug>/${s}` when the
      // row has a slug. Match the literal-ish shape — we don't
      // care about whitespace.
      expect(out).toContain("urlPath: (doc) =>");
      expect(out).toContain("`/docs/${s}`");
    });

    it("respects the actual collection slug in urlPath", () => {
      const out = renderNewCollectionFile("blog-posts", {
        fields: { title: { type: "text" } },
      });
      expect(out).toContain("`/blog-posts/${s}`");
    });

    it("does NOT emit slugField when no title:text field is declared", () => {
      const out = renderNewCollectionFile("media-items", {
        fields: { url: { type: "text" }, alt: { type: "text" } },
      });
      expect(out).not.toContain("slugField");
      expect(out).not.toContain("urlPath");
    });

    it("does NOT emit slugField when title is a non-text type", () => {
      // A `title` field that's `richText` doesn't satisfy the
      // slug-source contract (`slugify`'s default reads a plain
      // string).
      const out = renderNewCollectionFile("posts", {
        fields: { title: { type: "richText" } },
      });
      expect(out).not.toContain("slugField");
    });
  });
});
