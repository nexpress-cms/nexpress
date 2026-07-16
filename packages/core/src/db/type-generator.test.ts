import { describe, expect, it } from "vitest";

import { generateDocumentsModule, generateTypeScript } from "./type-generator.js";
import type { NpCollectionConfig } from "../config/types.js";

function collection(slug: string, fields: NpCollectionConfig["fields"] = []): NpCollectionConfig {
  return {
    slug,
    labels: { singular: slug, plural: `${slug}s` },
    fields,
  };
}

describe("generateDocumentsModule — hasMany filter wrapper", () => {
  it("delegates every collection query to the canonical Core boundary", () => {
    const out = generateDocumentsModule([
      collection("posts", [
        { type: "relationship", name: "categories", relationTo: "categories", hasMany: true },
      ]),
    ]);
    expect(out).toMatch(/export function findPosts\(/);
    expect(out).toContain('return findDocuments<PostsDocument>("posts", options, user);');
    expect(out).not.toMatch(/hasManyDescriptors|from "drizzle-orm"|getDb/);
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
    expect(out).not.toContain("_status:");
    expect(out).toContain('visibility: "public" | "private";');
    expect(out).toContain("siteId: string;");
    expect(out).toContain(
      "export type PagesDocumentWire = NpCollectionDocumentWire<PagesDocument>;",
    );
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

  it("does not duplicate publishedAt fields inside layout-only rows", () => {
    const out = generateDocumentsModule([
      {
        ...collection("posts", [{ type: "row", fields: [{ type: "date", name: "publishedAt" }] }]),
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

  it("uses the stable block-content type for blocks fields", () => {
    const out = generateDocumentsModule([
      collection("pages", [{ type: "blocks", name: "content", required: true }]),
    ]);

    expect(out).toContain('import type { NpBlockContent } from "@nexpress/core/fields";');
    expect(out).toContain("content: NpBlockContent;");
  });

  it("uses both stable content types in standalone generated interfaces", () => {
    const out = generateTypeScript([
      collection("pages", [
        { type: "blocks", name: "blocks", required: true },
        { type: "richText", name: "body", required: true },
      ]),
    ]);

    expect(out).toContain(
      'import type { NpBlockContent, NpRichTextContent } from "@nexpress/core/fields";',
    );
    expect(out).toContain("blocks: NpBlockContent;");
    expect(out).toContain("body: NpRichTextContent;");
  });
});
