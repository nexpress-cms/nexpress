import { describe, expect, it } from "vitest";

import { generateDrizzleSchema } from "./generator.js";
import type { NxCollectionConfig } from "../config/types.js";

function collection(slug: string, fields: NxCollectionConfig["fields"] = []): NxCollectionConfig {
  return {
    slug,
    labels: { singular: slug, plural: `${slug}s` },
    fields,
  };
}

describe("generateDrizzleSchema", () => {
  it("emits a pgTable for each collection with a snake_case name", () => {
    const out = generateDrizzleSchema([
      collection("posts", [{ type: "text", name: "title", required: true }]),
    ]);

    expect(out).toContain('export const postsTable = pgTable(');
    expect(out).toContain('"nx_c_posts"');
  });

  it("emits relations that reference the owner table, not the literal `table`", () => {
    // Regression: previous versions emitted `table.createdBy` inside the
    // relations(postsTable, …) callback, which doesn't resolve at runtime.
    const out = generateDrizzleSchema([collection("posts")]);

    expect(out).toContain("postsTable.createdBy");
    expect(out).not.toMatch(/fields:\s*\[table\./);
  });

  it("adds a slug column + unique index when slugField is set", () => {
    const out = generateDrizzleSchema([
      {
        ...collection("posts", [{ type: "text", name: "title", required: true }]),
        slugField: { useField: "title", unique: true },
      },
    ]);

    expect(out).toContain('slug: text("slug").notNull()');
    expect(out).toContain('uniqueIndex("nx_c_posts_site_slug_idx").on(table.siteId, table.slug)');
  });

  it("adds a _status draft column when versions.drafts is true", () => {
    const out = generateDrizzleSchema([
      {
        ...collection("posts"),
        versions: { drafts: true },
      },
    ]);

    expect(out).toContain('_status: text("_status", { enum: ["draft", "published"] })');
  });

  it("points upload fields at nxMedia and relationship fields at the target table", () => {
    const out = generateDrizzleSchema([
      collection("posts", [
        { type: "upload", name: "cover", relationTo: "media" },
        { type: "relationship", name: "author", relationTo: "users" },
      ]),
    ]);

    expect(out).toContain('cover: uuid("cover").references(() => nxMedia.id)');
    expect(out).toContain('author: uuid("author").references(() => nxUsers.id)');
  });

  it("routes number fields to integer vs doublePrecision based on integerOnly", () => {
    const out = generateDrizzleSchema([
      collection("metrics", [
        { type: "number", name: "views", integerOnly: true },
        { type: "number", name: "score" },
      ]),
    ]);

    expect(out).toContain('views: integer("views")');
    expect(out).toContain('score: doublePrecision("score")');
  });

  it("creates a child table for array fields with a parent FK", () => {
    const out = generateDrizzleSchema([
      collection("posts", [
        {
          type: "array",
          name: "tags",
          fields: [{ type: "text", name: "label", required: true }],
        },
      ]),
    ]);

    expect(out).toContain('export const postsTagsTable = pgTable(');
    expect(out).toContain('parentId: uuid("parent_id").notNull().references(() => postsTable.id');
  });

  it("allows overriding the schema import specifier", () => {
    const out = generateDrizzleSchema([collection("posts")], {
      schemaImport: "../../some/relative/schema.js",
    });

    expect(out).toContain(
      'import { nxMedia, nxUsers } from "../../some/relative/schema.js";',
    );
  });
});
