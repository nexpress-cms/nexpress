import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CollectionUnpatchError,
  unpatchCollectionFile,
} from "./unpatch-collection.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "np-cli-unpatch-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, body: string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, body);
  return path;
}

const baseFile = `
import { defineCollection } from "@nexpress/core";

export default defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "category", type: "relationship", relationTo: "categories" },
    { name: "excerpt", type: "textarea" },
  ],
});
`.trimStart();

describe("unpatchCollectionFile", () => {
  it("removes a single named field, keeps the rest", () => {
    const path = writeFile("posts.ts", baseFile);
    const result = unpatchCollectionFile(path, ["category"]);
    expect(result.removed).toEqual(["category"]);
    expect(result.skipped).toEqual([]);
    const out = readFileSync(path, "utf8");
    expect(out).toContain('name: "title"');
    expect(out).toContain('name: "excerpt"');
    expect(out).not.toContain('name: "category"');
  });

  it("removes multiple fields in one pass", () => {
    const path = writeFile("posts.ts", baseFile);
    const result = unpatchCollectionFile(path, ["category", "excerpt"]);
    expect(result.removed.sort()).toEqual(["category", "excerpt"]);
    const out = readFileSync(path, "utf8");
    expect(out).not.toContain('"category"');
    expect(out).not.toContain('"excerpt"');
    expect(out).toContain('name: "title"');
  });

  it("idempotent: skips fields already absent", () => {
    const path = writeFile("posts.ts", baseFile);
    // First removal.
    unpatchCollectionFile(path, ["category"]);
    const before = readFileSync(path, "utf8");
    // Re-run with the same name (already gone).
    const result = unpatchCollectionFile(path, ["category"]);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(["category"]);
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });

  it("walks `row` containers to reach inner fields", () => {
    const filePath = writeFile(
      "posts-row.ts",
      `
import { defineCollection } from "@nexpress/core";

export default defineCollection({
  slug: "posts",
  fields: [
    { name: "title", type: "text" },
    {
      type: "row",
      fields: [
        { name: "publishedAt", type: "date" },
        { name: "featured", type: "checkbox" },
      ],
    },
  ],
});
`.trimStart(),
    );
    const result = unpatchCollectionFile(filePath, ["featured"]);
    expect(result.removed).toEqual(["featured"]);
    const out = readFileSync(filePath, "utf8");
    // Row container preserved (operator-authored layout).
    expect(out).toContain('type: "row"');
    // Inner sibling preserved.
    expect(out).toContain('name: "publishedAt"');
    // Removed field gone.
    expect(out).not.toContain('name: "featured"');
  });

  it("walks `collapsible` containers the same way", () => {
    const filePath = writeFile(
      "posts-collapsible.ts",
      `
import { defineCollection } from "@nexpress/core";

export default defineCollection({
  slug: "posts",
  fields: [
    {
      type: "collapsible",
      label: "SEO",
      fields: [
        { name: "metaTitle", type: "text" },
      ],
    },
  ],
});
`.trimStart(),
    );
    const result = unpatchCollectionFile(filePath, ["metaTitle"]);
    expect(result.removed).toEqual(["metaTitle"]);
    const out = readFileSync(filePath, "utf8");
    expect(out).toContain('type: "collapsible"');
    expect(out).not.toContain('"metaTitle"');
  });

  it("throws when defineCollection has no static fields array", () => {
    const filePath = writeFile(
      "computed.ts",
      `
import { defineCollection } from "@nexpress/core";

const buildFields = () => [];

export default defineCollection({
  slug: "computed",
  fields: buildFields(),
});
`.trimStart(),
    );
    expect(() =>
      unpatchCollectionFile(filePath, ["whatever"]),
    ).toThrow(CollectionUnpatchError);
  });

  it("does not save the file when no fields were removed", () => {
    const path = writeFile("posts.ts", baseFile);
    const before = readFileSync(path, "utf8");
    const result = unpatchCollectionFile(path, ["doesNotExist"]);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(["doesNotExist"]);
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });
});
