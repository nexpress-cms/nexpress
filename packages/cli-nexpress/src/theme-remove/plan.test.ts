import { describe, expect, it } from "vitest";
import type { NpThemeManifest } from "@nexpress/core";

import { planThemeRemove, type PlanCollectionShape } from "./plan.js";

const manifest = (
  collections: NonNullable<NpThemeManifest["requires"]>["collections"],
): NpThemeManifest => ({
  id: "test-theme",
  name: "Test Theme",
  version: "0.1.0",
  requires: { collections },
});

const shape = (
  slug: string,
  fieldNames: string[],
  filePath = `src/collections/${slug}.ts`,
): PlanCollectionShape => ({ slug, filePath, fieldNames });

describe("planThemeRemove", () => {
  it("noop when theme requires nothing", () => {
    const plan = planThemeRemove({
      manifest: { id: "t", name: "T", version: "0", requires: { collections: {} } },
      existingCollections: [],
      withCollections: false,
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("noop when collections referenced by theme are already gone", () => {
    const plan = planThemeRemove({
      manifest: manifest({
        posts: { fields: { category: { type: "text" } } },
      }),
      existingCollections: [], // posts file already deleted
      withCollections: false,
    });
    expect(plan.isNoop).toBe(true);
  });

  it("plans field removal when theme field exists in operator's collection", () => {
    const plan = planThemeRemove({
      manifest: manifest({
        posts: { fields: { category: { type: "text" } } },
      }),
      existingCollections: [shape("posts", ["title", "category"])],
      withCollections: false,
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "remove-field",
      collection: "posts",
      field: "category",
    });
  });

  it("skips fields already absent (idempotent re-run)", () => {
    const plan = planThemeRemove({
      manifest: manifest({
        posts: { fields: { category: { type: "text" }, slug: { type: "text" } } },
      }),
      existingCollections: [shape("posts", ["title", "slug"])], // category already removed
      withCollections: false,
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "remove-field",
      field: "slug",
    });
  });

  describe("--with-collections", () => {
    it("proposes deleting the file when shape matches theme spec exactly", () => {
      const plan = planThemeRemove({
        manifest: manifest({
          authors: { fields: { name: { type: "text" }, bio: { type: "textarea" } } },
        }),
        existingCollections: [shape("authors", ["name", "bio"])],
        withCollections: true,
      });
      const fileStep = plan.steps.find((s) => s.kind === "remove-collection-file");
      expect(fileStep).toMatchObject({
        kind: "remove-collection-file",
        collection: "authors",
      });
    });

    it("keeps file with warning when operator added extra fields", () => {
      const plan = planThemeRemove({
        manifest: manifest({
          authors: { fields: { name: { type: "text" } } },
        }),
        existingCollections: [shape("authors", ["name", "twitterHandle"])],
        withCollections: true,
      });
      const warn = plan.steps.find((s) => s.kind === "keep-collection-with-warning");
      expect(warn).toBeDefined();
      expect(warn?.kind === "keep-collection-with-warning" && warn.reason).toContain(
        "twitterHandle",
      );
      // Theme-contributed fields still come out individually.
      const fieldStep = plan.steps.find((s) => s.kind === "remove-field");
      expect(fieldStep).toMatchObject({ field: "name" });
    });

    it("doesn't propose file deletion without --with-collections flag", () => {
      const plan = planThemeRemove({
        manifest: manifest({
          authors: { fields: { name: { type: "text" } } },
        }),
        existingCollections: [shape("authors", ["name"])],
        withCollections: false,
      });
      expect(plan.steps.find((s) => s.kind === "remove-collection-file")).toBeUndefined();
      // Just removes the field.
      expect(plan.steps[0]?.kind).toBe("remove-field");
    });
  });

  it("preserves theme metadata in the plan output", () => {
    const plan = planThemeRemove({
      manifest: { id: "magazine", name: "Magazine", version: "1.2.3" },
      existingCollections: [],
      withCollections: false,
    });
    expect(plan.themeId).toBe("magazine");
    expect(plan.themeName).toBe("Magazine");
    expect(plan.themeVersion).toBe("1.2.3");
  });
});
