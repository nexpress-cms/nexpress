import { describe, expect, it } from "vitest";

import type { NpCollectionConfig, NpFieldConfig } from "../config/types.js";
import {
  buildZodSchema,
  collectHiddenFieldNames,
  getCollectionZodSchema,
} from "./validation.js";

function field<T extends NpFieldConfig>(f: T): T {
  return f;
}

const baseCollection = (fields: NpFieldConfig[]): NpCollectionConfig => ({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields,
});

describe("collectHiddenFieldNames", () => {
  it("adds field names whose condition returns false", () => {
    const fields: NpFieldConfig[] = [
      field({ type: "text", name: "title", required: true }),
      field({
        type: "text",
        name: "lede",
        admin: { condition: (data) => data.kind === "doc" },
      }),
    ];
    const out = collectHiddenFieldNames(fields, { kind: "article" });
    expect(out.has("lede")).toBe(true);
    expect(out.has("title")).toBe(false);
  });

  it("skips fields with no condition", () => {
    const fields: NpFieldConfig[] = [field({ type: "text", name: "title" })];
    expect(collectHiddenFieldNames(fields, {}).size).toBe(0);
  });

  it("treats a throwing condition as not-hidden (safe fallback)", () => {
    const fields: NpFieldConfig[] = [
      field({
        type: "text",
        name: "bad",
        admin: {
          condition: () => {
            throw new Error("oops");
          },
        },
      }),
    ];
    expect(collectHiddenFieldNames(fields, {}).has("bad")).toBe(false);
  });

  it("walks through row + collapsible containers transparently", () => {
    const fields: NpFieldConfig[] = [
      field({
        type: "row",
        fields: [
          field({
            type: "text",
            name: "hidden",
            admin: { condition: () => false },
          }),
        ],
      }),
      field({
        type: "collapsible",
        label: "Advanced",
        fields: [
          field({
            type: "text",
            name: "alsoHidden",
            admin: { condition: () => false },
          }),
        ],
      }),
    ];
    const out = collectHiddenFieldNames(fields, {});
    expect(out.has("hidden")).toBe(true);
    expect(out.has("alsoHidden")).toBe(true);
  });

  it("hides every nested name when a group's own condition hides it", () => {
    const fields: NpFieldConfig[] = [
      field({
        type: "group",
        name: "seo",
        admin: { condition: () => false },
        fields: [
          field({ type: "text", name: "metaTitle", required: true }),
          field({ type: "text", name: "metaDescription" }),
        ],
      }),
    ];
    const out = collectHiddenFieldNames(fields, {});
    expect(out.has("seo")).toBe(true);
    expect(out.has("metaTitle")).toBe(true);
    expect(out.has("metaDescription")).toBe(true);
  });

  it("walks normally into a visible group", () => {
    const fields: NpFieldConfig[] = [
      field({
        type: "group",
        name: "seo",
        admin: { condition: () => true },
        fields: [
          field({
            type: "text",
            name: "metaTitle",
            admin: { condition: () => false },
          }),
        ],
      }),
    ];
    const out = collectHiddenFieldNames(fields, {});
    expect(out.has("seo")).toBe(false);
    expect(out.has("metaTitle")).toBe(true);
  });
});

describe("getCollectionZodSchema — condition-aware required", () => {
  const config = baseCollection([
    field({ type: "text", name: "title", required: true }),
    field({
      type: "text",
      name: "parent",
      required: true,
      admin: { condition: (data) => data.kind === "doc" },
    }),
  ]);

  it("enforces required for visible fields", () => {
    // article-kind: parent is hidden → required dropped
    const article = getCollectionZodSchema(config, { kind: "article", title: "X" });
    expect(article.safeParse({ kind: "article", title: "X" }).success).toBe(true);
  });

  it("enforces required for fields whose condition keeps them visible", () => {
    // doc-kind: parent IS visible → required holds
    const doc = getCollectionZodSchema(config, { kind: "doc", title: "X" });
    expect(doc.safeParse({ kind: "doc", title: "X" }).success).toBe(false);
    expect(doc.safeParse({ kind: "doc", title: "X", parent: "abc" }).success).toBe(true);
  });

  it("returns the unconditional schema when `forData` is omitted (back-compat)", () => {
    // No data → no condition evaluation → every required enforced
    const schema = getCollectionZodSchema(config);
    expect(schema.safeParse({ kind: "article", title: "X" }).success).toBe(false);
  });
});

describe("buildZodSchema — hiddenByCondition param", () => {
  it("drops required for names in the set", () => {
    const fields: NpFieldConfig[] = [
      field({ type: "text", name: "a", required: true }),
      field({ type: "text", name: "b", required: true }),
    ];
    const schema = buildZodSchema(fields, new Set(["b"]));
    expect(schema.safeParse({ a: "x" }).success).toBe(true);
    expect(schema.safeParse({ b: "y" }).success).toBe(false);
  });
});
