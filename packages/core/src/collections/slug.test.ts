import { describe, expect, it } from "vitest";

import { applySlugField, slugify } from "./slug.js";
import type { NxCollectionConfig } from "../config/types.js";

function collection(overrides: Partial<NxCollectionConfig> = {}): NxCollectionConfig {
  return {
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    fields: [],
    slugField: { useField: "title", unique: true },
    ...overrides,
  };
}

describe("slugify", () => {
  it("lowercases and hyphenates runs of non-alphanumerics", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("collapses repeated separators", () => {
    expect(slugify("  a -- b__c  ")).toBe("a-b-c");
  });

  it("strips diacritics", () => {
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
  });

  it("returns empty string when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("caps output length at 96 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(96);
  });

  it("keeps Korean characters intact (no jamo decomposition)", () => {
    expect(slugify("안녕 하세요")).toBe("안녕-하세요");
  });

  it("keeps Japanese kana / kanji", () => {
    expect(slugify("こんにちは 世界")).toBe("こんにちは-世界");
  });

  it("keeps Cyrillic and other scripts as letters", () => {
    expect(slugify("Привет мир")).toBe("привет-мир");
  });

  it("mixes Latin and Korean cleanly", () => {
    expect(slugify("Hello 안녕!")).toBe("hello-안녕");
  });
});

describe("applySlugField", () => {
  it("does nothing when the collection has no slugField configured", () => {
    const data: Record<string, unknown> = { title: "Hello" };
    applySlugField(collection({ slugField: false }), data, null);
    expect(data.slug).toBeUndefined();
  });

  it("normalizes an explicitly-provided slug through slugify", () => {
    const data: Record<string, unknown> = { title: "Hello", slug: "My Custom Slug" };
    applySlugField(collection(), data, null);
    expect(data.slug).toBe("my-custom-slug");
  });

  it("derives from the useField when no slug is provided", () => {
    const data: Record<string, unknown> = { title: "Hello World" };
    applySlugField(collection(), data, null);
    expect(data.slug).toBe("hello-world");
  });

  it("preserves the original slug on update when the caller didn't supply one", () => {
    const data: Record<string, unknown> = { title: "New Title" };
    applySlugField(collection(), data, { slug: "locked-in" });
    expect(data.slug).toBe("locked-in");
  });

  it("overrides an existing slug when the caller explicitly passes one", () => {
    const data: Record<string, unknown> = { title: "New Title", slug: "Fresh One" };
    applySlugField(collection(), data, { slug: "locked-in" });
    expect(data.slug).toBe("fresh-one");
  });

  it("defaults the source field to 'title' when slugField === true", () => {
    const data: Record<string, unknown> = { title: "From Bool" };
    applySlugField(collection({ slugField: true }), data, null);
    expect(data.slug).toBe("from-bool");
  });

  it("throws when no slug can be derived", () => {
    const data: Record<string, unknown> = { title: "!!!" };
    expect(() => applySlugField(collection(), data, null)).toThrow(/Slug generation failed/);
  });

  it("falls back to slugify of the raw slug when slugify returns empty", () => {
    // e.g. a slug that's already non-ascii/unusual — we keep the caller intent
    // rather than refusing to save.
    const data: Record<string, unknown> = { slug: "%%%", title: "Hello" };
    applySlugField(collection(), data, null);
    expect(data.slug).toBe("%%%");
  });
});
