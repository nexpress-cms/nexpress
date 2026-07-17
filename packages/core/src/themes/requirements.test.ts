import { describe, expect, it } from "vitest";

import type { NpCollectionConfig, NpThemeManifest } from "../config/types.js";

import { checkThemeRequirements } from "./requirements.js";

const manifest = (requires?: NpThemeManifest["requires"]): NpThemeManifest => ({
  id: "test-theme",
  name: "Test",
  version: "0.1.0",
  requires,
});

const postsCollection: NpCollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text" },
    { name: "featured", type: "checkbox" },
    {
      name: "category",
      type: "relationship",
      relationTo: "categories",
    },
    { name: "wrongType", type: "text" },
  ],
};

describe("checkThemeRequirements", () => {
  it("returns no mismatches when manifest has no requires", () => {
    const result = checkThemeRequirements(manifest(), [postsCollection]);
    expect(result.hasMismatches).toBe(false);
    expect(result.hasHardMismatches).toBe(false);
    expect(result.missingCollections).toEqual([]);
    expect(result.missingFields).toEqual([]);
  });

  it("flags a missing collection", () => {
    const result = checkThemeRequirements(
      manifest({
        collections: {
          authors: { fields: { name: { type: "text" } }, createIfAbsent: true },
        },
      }),
      [postsCollection],
    );
    expect(result.hasMismatches).toBe(true);
    expect(result.hasHardMismatches).toBe(true);
    expect(result.missingCollections).toEqual([{ collection: "authors", createIfAbsent: true }]);
  });

  it("flags a missing field on an existing collection", () => {
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: { fields: { coverImage: { type: "upload", required: true } } },
        },
      }),
      [postsCollection],
    );
    expect(result.hasMismatches).toBe(true);
    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0]).toMatchObject({
      collection: "posts",
      field: "coverImage",
      hard: true,
    });
  });

  it("treats hard:false as soft — recorded but doesn't flip hasHardMismatches", () => {
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: {
            fields: { optionalField: { type: "text", hard: false } },
          },
        },
      }),
      [postsCollection],
    );
    expect(result.hasMismatches).toBe(true);
    expect(result.hasHardMismatches).toBe(false);
    expect(result.missingFields[0]?.hard).toBe(false);
  });

  it("flags a type conflict on an existing field", () => {
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: { fields: { wrongType: { type: "checkbox" } } },
        },
      }),
      [postsCollection],
    );
    expect(result.typeConflicts).toHaveLength(1);
    expect(result.typeConflicts[0]).toMatchObject({
      collection: "posts",
      field: "wrongType",
      expected: "checkbox",
      actual: "text",
    });
  });

  it("flags relationship target mismatch when expected target is missing", () => {
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: {
            fields: {
              category: { type: "relationship", relationTo: "tags" },
            },
          },
        },
      }),
      [postsCollection],
    );
    expect(result.relationConflicts).toHaveLength(1);
    expect(result.relationConflicts[0]).toMatchObject({
      collection: "posts",
      field: "category",
      expected: "tags",
      actual: "categories",
    });
  });

  it("accepts relationship when expected targets are subset of actual", () => {
    const collection: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          name: "rel",
          type: "relationship",
          relationTo: ["categories", "tags"],
        },
      ],
    };
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: { fields: { rel: { type: "relationship", relationTo: "categories" } } },
        },
      }),
      [collection],
    );
    expect(result.relationConflicts).toEqual([]);
    expect(result.hasMismatches).toBe(false);
  });

  it("walks row + collapsible containers to find top-level fields", () => {
    const collection: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          type: "row",
          fields: [
            { name: "lhs", type: "text" },
            {
              type: "collapsible",
              label: "Advanced",
              fields: [{ name: "buried", type: "text" }],
            },
          ],
        },
      ],
    };
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: {
            fields: { lhs: { type: "text" }, buried: { type: "text" } },
          },
        },
      }),
      [collection],
    );
    expect(result.hasMismatches).toBe(false);
  });

  it("does not look inside array/group sub-records", () => {
    // Theme requirements address top-level fields only. Fields
    // nested under array/group are scoped under a sub-record at
    // the data level — addressing them by bare name would be
    // ambiguous, so the walker doesn't descend.
    const collection: NpCollectionConfig = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        {
          name: "meta",
          type: "group",
          fields: [{ name: "buried", type: "text" }],
        },
      ],
    };
    const result = checkThemeRequirements(
      manifest({
        collections: {
          posts: { fields: { buried: { type: "text" } } },
        },
      }),
      [collection],
    );
    expect(result.hasMismatches).toBe(true);
    expect(result.missingFields[0]?.field).toBe("buried");
  });
});
