import { describe, expect, it } from "vitest";

import { generateDocumentsModule } from "./type-generator.js";
import type { NpCollectionConfig } from "../config/types.js";

function collection(slug: string, fields: NpCollectionConfig["fields"] = []): NpCollectionConfig {
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

  it("intersects hasMany matches with any user-provided `id` constraint (string)", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
      ]),
    ]);
    // The wrapper must check `where.id` BEFORE assigning the
    // join-resolved id list. Otherwise a query like
    // `{ id: "x", categories: catId }` silently drops the
    // user's id and returns every post in catId. The string-
    // intersection branch picks the existing id only if it's
    // in the matched set.
    expect(out).toMatch(/typeof existingId === "string"/);
    expect(out).toMatch(/ids\.includes\(existingId\)/);
  });

  it("intersects hasMany matches with any user-provided `id` array constraint", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
      ]),
    ]);
    // Same guard for `id: ["a", "b"]` arrays.
    expect(out).toMatch(/Array\.isArray\(existingId\)/);
    expect(out).toMatch(/allowed\.has\(id\)/);
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

  it("emits scheduled status and framework publishedAt for draft collections", () => {
    const out = generateDocumentsModule([
      {
        ...collection("pages", [{ type: "text", name: "title", required: true }]),
        versions: { drafts: true },
      },
    ]);

    expect(out).toContain('status: "draft" | "scheduled" | "published" | "archived" | "pending";');
    expect(out).toContain("publishedAt: Date | null;");
    expect(out).toContain('_status: "draft" | "published";');
  });

  it("does not duplicate user-declared publishedAt fields in document types", () => {
    const out = generateDocumentsModule([
      {
        ...collection("posts", [{ type: "date", name: "publishedAt" }]),
        versions: { drafts: true },
      },
    ]);

    expect(out.match(/publishedAt: Date \| null;/g)).toHaveLength(1);
  });

  it("uses the stable rich-text type for richText fields", () => {
    const out = generateDocumentsModule([
      collection("posts", [{ type: "richText", name: "body", required: true }]),
    ]);

    expect(out).toContain('import type { NpRichTextContent } from "@nexpress/core/fields";');
    expect(out).toContain("body: NpRichTextContent;");
  });
});
