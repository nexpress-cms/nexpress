import { describe, expect, it } from "vitest";

import { generateDrizzleSchema } from "./generator.js";
import type { NpCollectionConfig } from "../config/types.js";

function collection(slug: string, fields: NpCollectionConfig["fields"] = []): NpCollectionConfig {
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

    expect(out).toContain("export const postsTable = pgTable(");
    expect(out).toContain('"np_c_posts"');
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
    expect(out).toContain('uniqueIndex("np_c_posts_site_slug_idx").on(table.siteId, table.slug)');
  });

  it("uses canonical status plus publishedAt when versions.drafts is true", () => {
    const out = generateDrizzleSchema([
      {
        ...collection("posts"),
        versions: { drafts: true },
      },
    ]);

    expect(out).toContain('publishedAt: timestamp("published_at", { withTimezone: true })');
    expect(out).toContain('status: text("status", { enum: ["draft", "scheduled"');
    expect(out).not.toContain('_status: text("_status"');
  });

  it("does not duplicate a user-declared publishedAt date field", () => {
    const out = generateDrizzleSchema([
      {
        ...collection("posts", [{ type: "date", name: "publishedAt" }]),
        versions: { drafts: true },
      },
    ]);

    expect(out.match(/publishedAt: timestamp\("published_at"/g)).toHaveLength(1);
  });

  it("treats publishedAt inside layout-only rows as a top-level column", () => {
    const out = generateDrizzleSchema([
      {
        ...collection("posts", [{ type: "row", fields: [{ type: "date", name: "publishedAt" }] }]),
        versions: { drafts: true },
      },
    ]);

    expect(out.match(/publishedAt: timestamp\("published_at"/g)).toHaveLength(1);
  });

  it("points upload fields at npMedia and relationship fields at the target table", () => {
    const out = generateDrizzleSchema([
      collection("posts", [
        { type: "upload", name: "cover", relationTo: "media" },
        { type: "relationship", name: "author", relationTo: "users" },
      ]),
    ]);

    expect(out).toContain('cover: uuid("cover").references((): AnyPgColumn => npMedia.id)');
    expect(out).toContain('author: uuid("author").references((): AnyPgColumn => npUsers.id)');
  });

  it("annotates FK callbacks so self-referential tables typecheck", () => {
    const out = generateDrizzleSchema([
      collection("posts", [{ type: "relationship", name: "parent", relationTo: "posts" }]),
    ]);

    expect(out).toContain("type AnyPgColumn");
    expect(out).toContain('parent: uuid("parent").references((): AnyPgColumn => postsTable.id)');
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

    expect(out).toContain("export const postsTagsTable = pgTable(");
    expect(out).toContain(
      'parentId: uuid("parent_id").notNull().references((): AnyPgColumn => postsTable.id',
    );
  });

  it("allows overriding the schema import specifier", () => {
    const out = generateDrizzleSchema([collection("posts")], {
      schemaImport: "../../some/relative/schema.js",
    });

    expect(out).toContain('import { npMedia, npUsers } from "../../some/relative/schema.js";');
  });

  // Universal-content-model Phase U.1 (#748): generator honors
  // `field.defaultValue` for SQL-mappable scalar types so a NOT
  // NULL column can be added to a populated table via a single
  // ALTER TABLE with a DEFAULT clause.
  describe("field.defaultValue", () => {
    it('emits .default("<value>") for select fields with a string default', () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          {
            type: "select",
            name: "kind",
            required: true,
            defaultValue: "article",
            options: [{ label: "Article", value: "article" }],
          },
        ]),
      ]);
      expect(out).toContain('kind: text("kind").default("article").notNull()');
    });

    it("emits .default for text / textarea / email / radio with string defaults", () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          { type: "text", name: "a", defaultValue: "hello" },
          { type: "textarea", name: "b", defaultValue: "world" },
          { type: "email", name: "c", defaultValue: "x@y.z" },
          {
            type: "radio",
            name: "d",
            required: true,
            defaultValue: "x",
            options: [{ label: "X", value: "x" }],
          },
        ]),
      ]);
      expect(out).toContain('a: text("a").default("hello")');
      expect(out).toContain('b: text("b").default("world")');
      expect(out).toContain('c: text("c").default("x@y.z")');
      expect(out).toContain('d: text("d").default("x").notNull()');
    });

    it("emits .default for number + checkbox with the right literal kind", () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          { type: "number", name: "n", defaultValue: 7 },
          { type: "number", name: "i", integerOnly: true, defaultValue: 3 },
          { type: "checkbox", name: "flag", defaultValue: true },
        ]),
      ]);
      expect(out).toContain('n: doublePrecision("n").default(7)');
      expect(out).toContain('i: integer("i").default(3)');
      expect(out).toContain('flag: boolean("flag").default(true)');
    });

    it("escapes embedded quotes + backslashes in string defaults", () => {
      const out = generateDrizzleSchema([
        collection("posts", [{ type: "text", name: "s", defaultValue: 'has "quote" and \\ back' }]),
      ]);
      // The generator's output is TS source compiled by tsc; an
      // unescaped embedded quote would break the build.
      expect(out).toContain('s: text("s").default("has \\"quote\\" and \\\\ back")');
    });

    it("ignores defaultValue for jsonb / relation / upload columns", () => {
      // richText / blocks / json — these don't have a sensible
      // SQL default and the generator skips the `.default(…)`
      // emission so the migration doesn't get garbage like
      // `DEFAULT '{...lexical json...}'`.
      const out = generateDrizzleSchema([
        collection("posts", [
          { type: "richText", name: "body", defaultValue: { root: {} } },
          { type: "blocks", name: "blocks", defaultValue: [] },
          { type: "json", name: "j", defaultValue: { a: 1 } },
        ]),
      ]);
      expect(out).toContain('body: jsonb("body")');
      expect(out).not.toMatch(/body:.*\.default\(/);
      expect(out).not.toMatch(/blocks:.*\.default\(/);
      expect(out).not.toMatch(/j:.*\.default\(/);
    });

    it('emits .defaultNow() for date fields with `defaultValue: "now"`', () => {
      const out = generateDrizzleSchema([
        collection("posts", [{ type: "date", name: "publishedAt", defaultValue: "now" }]),
      ]);
      expect(out).toContain(
        'publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow()',
      );
    });

    it("emits .default(new Date(...)) for date fields with a Date instance", () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          {
            type: "date",
            name: "publishedAt",
            // Fixed-point Date — used for "site launches on this
            // exact instant" style backfills.
            defaultValue: new Date("2026-01-01T00:00:00Z"),
          },
        ]),
      ]);
      expect(out).toContain(
        'publishedAt: timestamp("published_at", { withTimezone: true }).default(new Date("2026-01-01T00:00:00.000Z"))',
      );
    });

    it("parses ISO date strings into a Date for emission", () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          {
            type: "date",
            name: "publishedAt",
            defaultValue: "2026-01-01T00:00:00Z",
          },
        ]),
      ]);
      expect(out).toContain(
        'publishedAt: timestamp("published_at", { withTimezone: true }).default(new Date("2026-01-01T00:00:00.000Z"))',
      );
    });

    it("skips date defaultValue when the string is not a valid ISO", () => {
      const out = generateDrizzleSchema([
        collection("posts", [
          {
            type: "date",
            name: "publishedAt",
            defaultValue: "not a date",
          },
        ]),
      ]);
      expect(out).not.toMatch(/publishedAt:.*\.default/);
    });

    it("skips defaultValue when the value type doesn't match the field type", () => {
      // Defensive: a number field with a string `defaultValue`
      // shouldn't emit `default("3")` — drizzle would build wrong
      // SQL. The generator drops the value silently; validation
      // surfaces the type mismatch separately.
      // Cast through unknown so the test compiles — operator code
      // shouldn't pass mismatched types in practice; the generator
      // is being defensive about a malformed config.
      const out = generateDrizzleSchema([
        collection("posts", [
          { type: "number", name: "n", defaultValue: "not-a-number" as unknown as number },
          { type: "checkbox", name: "flag", defaultValue: "yes" as unknown as boolean },
        ]),
      ]);
      expect(out).not.toMatch(/n:.*\.default\(/);
      expect(out).not.toMatch(/flag:.*\.default\(/);
    });
  });
});
