import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";

import { extractFromSourceFile } from "./extract-collection.js";

function parse(source: string) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  return project.createSourceFile("/virtual/test.ts", source);
}

describe("extractFromSourceFile", () => {
  it("returns null when no defineCollection call", () => {
    expect(extractFromSourceFile(parse(`export const x = 1;`))).toBeNull();
  });

  it("returns null when slug is missing", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({ fields: [] });
    `);
    expect(extractFromSourceFile(src)).toBeNull();
  });

  it("extracts slug + leaf fields", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [
          { name: "title", type: "text", required: true },
          { name: "featured", type: "checkbox" },
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result?.config.slug).toBe("posts");
    expect(result?.config.fields).toHaveLength(2);
    expect(result?.config.fields[0]).toMatchObject({
      name: "title",
      type: "text",
    });
    expect(result?.config.fields[1]).toMatchObject({
      name: "featured",
      type: "checkbox",
    });
  });

  it("extracts relationship.relationTo as string", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [{ name: "category", type: "relationship", relationTo: "categories" }],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result?.config.fields[0]).toMatchObject({
      name: "category",
      type: "relationship",
      relationTo: "categories",
    });
  });

  it("extracts relationship.relationTo as string array", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [{ name: "rel", type: "relationship", relationTo: ["categories", "tags"] }],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result?.config.fields[0]).toMatchObject({
      name: "rel",
      relationTo: ["categories", "tags"],
    });
  });

  it("recurses into row containers (mirrors runtime walker)", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
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
      });
    `);
    const result = extractFromSourceFile(src);
    const names = result?.config.fields.map((f) => (f as { name: string }).name);
    expect(names).toEqual(["lhs", "buried"]);
  });

  it("does not descend into array/group sub-records (mirrors runtime walker)", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [{ name: "buried", type: "text" }],
          },
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    const names = result?.config.fields.map((f) => (f as { name: string }).name);
    expect(names).toEqual(["meta"]);
  });

  it("skips fields with computed (non-literal) type", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      const dynamicType = "text";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [
          { name: "static", type: "text" },
          { name: "dynamic", type: dynamicType },
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result?.config.fields).toHaveLength(1);
    expect(result?.config.fields[0]).toMatchObject({ name: "static" });
  });
});
