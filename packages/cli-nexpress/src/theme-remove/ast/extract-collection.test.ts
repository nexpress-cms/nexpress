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

  it("extracts only the collection identity and ordered field names needed by the planner", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [
          { name: "title", type: "text", required: true },
          { name: "featured", type: "checkbox" },
          { name: "category", type: "relationship", relationTo: "categories" },
          { name: "related", type: "relationship", relationTo: ["categories", "tags"] },
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result).toEqual({
      filePath: "/virtual/test.ts",
      slug: "posts",
      fieldNames: ["title", "featured", "category", "related"],
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
    const names = result?.fieldNames;
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
          {
            name: "items",
            type: "array",
            fields: [{ name: "nested", type: "text" }],
          },
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    const names = result?.fieldNames;
    expect(names).toEqual(["meta", "items"]);
  });

  it("skips computed names/types and spread fields", () => {
    const src = parse(`
      import { defineCollection } from "@nexpress/core";
      const dynamicType = "text";
      export default defineCollection({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        fields: [
          { name: "static", type: "text" },
          { name: "dynamic", type: dynamicType },
          { name: dynamicName, type: "text" },
          ...sharedFields,
        ],
      });
    `);
    const result = extractFromSourceFile(src);
    expect(result?.fieldNames).toEqual(["static"]);
  });
});
