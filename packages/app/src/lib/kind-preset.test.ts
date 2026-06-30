import { describe, expect, it } from "vitest";
import type { NpCollectionConfig, NpSelectField } from "@nexpress/core";

import { resolveCreateKindPreset } from "./kind-preset";

const kindSelectField: NpSelectField = {
  type: "select",
  name: "kind",
  required: true,
  defaultValue: "article",
  options: [
    { label: "Article", value: "article" },
    { label: "Doc", value: "doc" },
  ],
};

const baseCollection: NpCollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [kindSelectField],
};

describe("create kind preset", () => {
  it("accepts a query preset only when it matches the collection's kind options", () => {
    expect(resolveCreateKindPreset(baseCollection, "doc")).toBe("doc");
    expect(resolveCreateKindPreset(baseCollection, "project")).toBeUndefined();
    expect(resolveCreateKindPreset(baseCollection, undefined)).toBeUndefined();
    expect(resolveCreateKindPreset(baseCollection, "")).toBeUndefined();
  });

  it("finds a kind select inside layout containers", () => {
    const collection: NpCollectionConfig = {
      ...baseCollection,
      fields: [
        {
          type: "collapsible",
          label: "Publish",
          fields: baseCollection.fields,
        },
      ],
    };

    expect(resolveCreateKindPreset(collection, "doc")).toBe("doc");
  });

  it("does not preset kind when the collection has no single-value kind select", () => {
    expect(
      resolveCreateKindPreset(
        {
          ...baseCollection,
          fields: [{ type: "text", name: "kind" }],
        },
        "doc",
      ),
    ).toBeUndefined();

    expect(
      resolveCreateKindPreset(
        {
          ...baseCollection,
          fields: [{ ...kindSelectField, hasMany: true }],
        },
        "doc",
      ),
    ).toBeUndefined();
  });
});
