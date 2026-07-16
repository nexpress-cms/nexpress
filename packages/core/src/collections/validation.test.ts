import { describe, expect, it } from "vitest";

import type { NpCollectionConfig, NpFieldConfig } from "../config/types.js";
import {
  buildZodSchema,
  collectHiddenFieldNames,
  evaluateFieldCondition,
  getCollectionZodSchema,
} from "./validation.js";
import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";

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
    field({ type: "text", name: "kind", required: true }),
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

describe("buildZodSchema — rich-text v1 contract", () => {
  const schema = buildZodSchema([field({ type: "richText", name: "body", required: true })]);

  it("accepts the versioned NexPress envelope", () => {
    expect(schema.safeParse({ body: npCreateEmptyRichTextContent() }).success).toBe(true);
  });

  it("rejects raw Lexical JSON before a collection write", () => {
    const result = schema.safeParse({
      body: {
        root: {
          type: "root",
          children: [],
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('exactly "version" and "document"');
    }
  });
});

describe("buildZodSchema — block content v1 contract", () => {
  const schema = buildZodSchema([field({ type: "blocks", name: "content", required: true })]);

  it("accepts canonical nested block content", () => {
    expect(
      schema.safeParse({
        content: [
          {
            id: "grid-1",
            type: "grid",
            props: {},
            children: [{ id: "hero-1", type: "hero", props: { title: "Hello" } }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed blocks before a collection write", () => {
    const result = schema.safeParse({
      content: [{ id: "hero-1", type: "hero", props: {}, children: "invalid" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("children must be an array");
    }
  });
});

describe("evaluateFieldCondition — serializable expressions (#763)", () => {
  it("undefined → returns true (field visible)", () => {
    expect(evaluateFieldCondition(undefined, {})).toBe(true);
  });

  it("function form: legacy server-only path still works", () => {
    expect(evaluateFieldCondition((d) => d.kind === "doc", { kind: "doc" })).toBe(true);
    expect(evaluateFieldCondition((d) => d.kind === "doc", { kind: "article" })).toBe(false);
  });

  it("function form: throw → fail open (return true)", () => {
    expect(
      evaluateFieldCondition(() => {
        throw new Error("oops");
      }, {}),
    ).toBe(true);
  });

  it("equals / notEquals", () => {
    expect(evaluateFieldCondition({ when: "kind", equals: "doc" }, { kind: "doc" })).toBe(true);
    expect(evaluateFieldCondition({ when: "kind", equals: "doc" }, { kind: "article" })).toBe(
      false,
    );
    expect(evaluateFieldCondition({ when: "kind", notEquals: "doc" }, { kind: "article" })).toBe(
      true,
    );
    expect(evaluateFieldCondition({ when: "kind", notEquals: "doc" }, { kind: "doc" })).toBe(false);
  });

  it("in / notIn", () => {
    expect(evaluateFieldCondition({ when: "kind", in: ["doc", "page"] }, { kind: "doc" })).toBe(
      true,
    );
    expect(evaluateFieldCondition({ when: "kind", in: ["doc", "page"] }, { kind: "x" })).toBe(
      false,
    );
    expect(evaluateFieldCondition({ when: "kind", notIn: ["doc"] }, { kind: "x" })).toBe(true);
    expect(evaluateFieldCondition({ when: "kind", notIn: ["doc"] }, { kind: "doc" })).toBe(false);
  });

  it("exists treats undefined / null / empty string / empty array as absent", () => {
    expect(evaluateFieldCondition({ when: "a", exists: true }, { a: "value" })).toBe(true);
    expect(evaluateFieldCondition({ when: "a", exists: true }, { a: undefined })).toBe(false);
    expect(evaluateFieldCondition({ when: "a", exists: true }, { a: null })).toBe(false);
    expect(evaluateFieldCondition({ when: "a", exists: true }, { a: "" })).toBe(false);
    expect(evaluateFieldCondition({ when: "a", exists: true }, { a: [] })).toBe(false);
    expect(evaluateFieldCondition({ when: "a", exists: false }, { a: undefined })).toBe(true);
  });

  it("all (AND) / any (OR) composition", () => {
    const data = { kind: "doc", featured: true };
    expect(
      evaluateFieldCondition(
        {
          all: [
            { when: "kind", equals: "doc" },
            { when: "featured", equals: true },
          ],
        },
        data,
      ),
    ).toBe(true);
    expect(
      evaluateFieldCondition(
        {
          all: [
            { when: "kind", equals: "doc" },
            { when: "featured", equals: false },
          ],
        },
        data,
      ),
    ).toBe(false);
    expect(
      evaluateFieldCondition(
        {
          any: [
            { when: "kind", equals: "page" },
            { when: "kind", equals: "doc" },
          ],
        },
        data,
      ),
    ).toBe(true);
  });

  it("malformed expression → fails open (field visible)", () => {
    expect(
      evaluateFieldCondition(
        { bogus: true } as unknown as Parameters<typeof evaluateFieldCondition>[0],
        {},
      ),
    ).toBe(true);
  });

  it("collectHiddenFieldNames evaluates expression conditions", () => {
    const fields: NpFieldConfig[] = [
      field({
        type: "text",
        name: "parent",
        admin: { condition: { when: "kind", equals: "doc" } },
      }),
    ];
    expect(collectHiddenFieldNames(fields, { kind: "article" }).has("parent")).toBe(true);
    expect(collectHiddenFieldNames(fields, { kind: "doc" }).has("parent")).toBe(false);
  });
});

describe("buildZodSchema — field.defaultValue", () => {
  it("applies a scalar defaultValue when the field is omitted", () => {
    const schema = buildZodSchema([
      field({ type: "text", name: "kind", required: true, defaultValue: "article" }),
    ]);
    const parsed = schema.parse({});
    expect(parsed).toEqual({ kind: "article" });
  });

  it("applies a group defaultValue when the whole group is omitted", () => {
    // Without applyFieldDefault on the group branch, this case
    // silently dropped the default — callers omitting `seo`
    // got a Zod required error even though the field carried a
    // sensible default object. Regression guard for that bug.
    const schema = buildZodSchema([
      field({
        type: "group",
        name: "seo",
        required: true,
        defaultValue: { metaTitle: "Untitled", metaDescription: "" },
        fields: [
          field({ type: "text", name: "metaTitle", required: true }),
          field({ type: "text", name: "metaDescription" }),
        ],
      }),
    ]);
    const parsed = schema.parse({});
    expect(parsed).toEqual({
      seo: { metaTitle: "Untitled", metaDescription: "" },
    });
  });

  it("applies an array defaultValue when the field is omitted", () => {
    const schema = buildZodSchema([
      field({
        type: "array",
        name: "tags",
        required: true,
        defaultValue: [],
        fields: [field({ type: "text", name: "label", required: true })],
      }),
    ]);
    const parsed = schema.parse({});
    expect(parsed).toEqual({ tags: [] });
  });

  it("never enforces required for an unset field that carries a defaultValue", () => {
    // A select with a single option + required + default is the
    // canonical case (e.g. `posts.kind`) that motivated this
    // function's existence — the default lets API callers omit
    // the field without tripping a required error.
    const schema = buildZodSchema([
      field({
        type: "select",
        name: "kind",
        required: true,
        options: [{ label: "Article", value: "article" }],
        defaultValue: "article",
      }),
    ]);
    expect(() => schema.parse({})).not.toThrow();
  });

  it("`row` and `collapsible` containers flatten — their fields' own defaults apply", () => {
    // Containers don't carry a value of their own; the schema
    // builder flattens their nested fields into the parent
    // shape, so each nested field's defaultValue is what fires.
    const schema = buildZodSchema([
      field({
        type: "row",
        fields: [
          field({ type: "text", name: "first", defaultValue: "alpha" }),
          field({ type: "text", name: "second", defaultValue: "beta" }),
        ],
      }),
    ]);
    expect(schema.parse({})).toEqual({ first: "alpha", second: "beta" });
  });

  it("a `defaultValue` of `undefined` is a no-op (existing behavior preserved)", () => {
    const schema = buildZodSchema([
      field({ type: "text", name: "title", defaultValue: undefined }),
    ]);
    // `title` is optional + no default applied → omitting it
    // leaves the key off the parsed object entirely.
    expect(schema.parse({})).toEqual({});
  });
});
