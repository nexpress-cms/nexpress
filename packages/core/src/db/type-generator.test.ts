import { describe, expect, it } from "vitest";

import { generateDocumentsModule } from "./type-generator.js";
import type { NpCollectionConfig } from "../config/types.js";

function collection(
  slug: string,
  fields: NpCollectionConfig["fields"] = [],
): NpCollectionConfig {
  return {
    slug,
    labels: { singular: slug, plural: `${slug}s` },
    fields,
  };
}

describe("generateDocumentsModule — hasMany filter wrapper", () => {
  it("emits a simple wrapper when the collection has no hasMany fields", () => {
    const out = generateDocumentsModule([
      collection("pages", [{ type: "text", name: "title", required: true }]),
    ]);
    // Simple sync function — no async pre-resolve dance.
    expect(out).toMatch(/export function findPages\(/);
    expect(out).not.toMatch(/hasManyDescriptors/);
    // Shouldn't drag in drizzle imports for a hasMany-free schema.
    expect(out).not.toMatch(/from "drizzle-orm"/);
  });

  it("emits a hasMany-aware async wrapper when the collection has hasMany relationship fields", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "text", name: "title", required: true },
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
        { type: "relationship", name: "author", relationTo: "users" }, // hasMany absent — scalar
      ]),
    ]);
    expect(out).toMatch(/export async function findPosts\(/);
    expect(out).toMatch(/hasManyDescriptors/);
    // Only `categories` is hasMany; `author` is scalar and should not appear.
    expect(out).toMatch(/field: "categories"/);
    expect(out).not.toMatch(/field: "author"/);
    // Imports from drizzle + the join table.
    expect(out).toMatch(/import \{ inArray \} from "drizzle-orm"/);
    expect(out).toMatch(/postsCategoriesTable/);
  });

  it("emits multiple descriptor entries when a collection has several hasMany fields", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
        { type: "relationship", name: "tags", relationTo: "tags", hasMany: true },
      ]),
    ]);
    expect(out).toMatch(/field: "categories"/);
    expect(out).toMatch(/field: "tags"/);
    expect(out).toMatch(/postsCategoriesTable/);
    expect(out).toMatch(/postsTagsTable/);
  });

  it("intersects multiple hasMany filters at runtime (intersect comment present)", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
      ]),
    ]);
    // The intersection logic short-circuits when the result set is
    // empty. Asserting the comment is enough — generator stability
    // contract: this short-circuit is observable behavior, not an
    // implementation detail to be silently removed.
    expect(out).toMatch(/Intersect across all hasMany filters/);
    expect(out).toMatch(/totalDocs: 0/);
  });

  it("imports `getDb` only when at least one collection has hasMany fields", () => {
    const without = generateDocumentsModule([
      collection("pages", [{ type: "text", name: "title", required: true }]),
    ]);
    const withHM = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
      ]),
    ]);
    expect(without).not.toMatch(/getDb,/);
    expect(withHM).toMatch(/getDb,/);
  });
});
