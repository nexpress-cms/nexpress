import { describe, expect, it } from "vitest";

import type {
  NpThemeManifest,
  NpThemeRequirementResult,
} from "@nexpress/core";

import { planThemeInstall } from "./plan.js";

const emptyCheck: NpThemeRequirementResult = {
  themeId: "test",
  hasMismatches: false,
  hasHardMismatches: false,
  missingCollections: [],
  missingFields: [],
  typeConflicts: [],
  relationConflicts: [],
};

const manifest = (
  requires?: NpThemeManifest["requires"],
): NpThemeManifest => ({
  id: "test",
  name: "Test theme",
  version: "0.1.0",
  requires,
});

describe("planThemeInstall", () => {
  it("returns isNoop when nothing to do", () => {
    const plan = planThemeInstall({
      manifest: manifest(),
      existingCollectionSlugs: ["posts"],
      check: emptyCheck,
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.steps).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it("emits create-collection step for missing slug", () => {
    const plan = planThemeInstall({
      manifest: manifest({
        collections: {
          authors: {
            fields: { name: { type: "text", required: true } },
            createIfAbsent: true,
          },
        },
      }),
      existingCollectionSlugs: ["posts"],
      check: emptyCheck,
    });
    expect(plan.isNoop).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "create-collection",
      collection: "authors",
    });
  });

  it("emits patch-collection step for hard missing fields on existing collection", () => {
    const plan = planThemeInstall({
      manifest: manifest({
        collections: { posts: { fields: { featured: { type: "checkbox" } } } },
      }),
      existingCollectionSlugs: ["posts"],
      check: {
        ...emptyCheck,
        hasMismatches: true,
        hasHardMismatches: true,
        missingFields: [
          {
            collection: "posts",
            field: "featured",
            expected: { type: "checkbox" },
            hard: true,
          },
        ],
      },
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "patch-collection",
      collection: "posts",
      addFields: [{ name: "featured" }],
    });
  });

  it("emits warn step for soft (hard:false) missing fields", () => {
    const plan = planThemeInstall({
      manifest: manifest({
        collections: { posts: { fields: { tag: { type: "text", hard: false } } } },
      }),
      existingCollectionSlugs: ["posts"],
      check: {
        ...emptyCheck,
        hasMismatches: true,
        hasHardMismatches: false,
        missingFields: [
          {
            collection: "posts",
            field: "tag",
            expected: { type: "text", hard: false },
            hard: false,
          },
        ],
      },
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "warn-soft-mismatch",
      collection: "posts",
      field: "tag",
    });
  });

  it("collects type conflicts as blockers (must resolve manually)", () => {
    const plan = planThemeInstall({
      manifest: manifest(),
      existingCollectionSlugs: ["posts"],
      check: {
        ...emptyCheck,
        hasMismatches: true,
        hasHardMismatches: true,
        typeConflicts: [
          {
            collection: "posts",
            field: "wrong",
            expected: "checkbox",
            actual: "text",
            hard: true,
          },
        ],
      },
    });
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatchObject({
      collection: "posts",
      field: "wrong",
      expected: "checkbox",
      actual: "text",
    });
  });

  it("relationship conflict as blocker with formatted expected/actual", () => {
    const plan = planThemeInstall({
      manifest: manifest(),
      existingCollectionSlugs: ["posts"],
      check: {
        ...emptyCheck,
        relationConflicts: [
          {
            collection: "posts",
            field: "rel",
            expected: "tags",
            actual: "categories",
            hard: true,
          },
        ],
      },
    });
    expect(plan.blockers[0]?.expected).toContain("tags");
    expect(plan.blockers[0]?.actual).toContain("categories");
  });

  it("skips patch-collection when collection itself is being created", () => {
    // If a collection is brand-new (not in existingSlugs), we
    // emit create-collection only — patches don't apply to a
    // file that doesn't exist yet.
    const plan = planThemeInstall({
      manifest: manifest({
        collections: {
          authors: { fields: { name: { type: "text" } }, createIfAbsent: true },
        },
      }),
      existingCollectionSlugs: ["posts"],
      check: {
        ...emptyCheck,
        missingFields: [
          {
            collection: "authors",
            field: "name",
            expected: { type: "text" },
            hard: true,
          },
        ],
      },
    });
    expect(plan.steps.filter((s) => s.kind === "patch-collection")).toEqual([]);
    expect(plan.steps.filter((s) => s.kind === "create-collection")).toHaveLength(1);
  });
});
