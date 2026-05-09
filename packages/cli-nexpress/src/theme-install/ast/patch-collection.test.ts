import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CollectionPatchError,
  patchCollectionFile,
} from "./patch-collection.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "np-cli-patch-"));
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
  ],
});
`.trimStart();

describe("patchCollectionFile", () => {
  it("appends a new field literal to the fields array", () => {
    const path = writeFile("posts.ts", baseFile);
    const result = patchCollectionFile(path, [
      { name: "featured", requirement: { type: "checkbox" } },
    ]);
    expect(result.added).toEqual(["featured"]);
    expect(result.skipped).toEqual([]);
    const out = readFileSync(path, "utf8");
    expect(out).toContain("name: \"featured\"");
    expect(out).toContain("type: \"checkbox\"");
    // Existing field intact.
    expect(out).toContain("name: \"title\"");
  });

  it("idempotent: skips fields that already exist", () => {
    const path = writeFile("posts.ts", baseFile);
    // First run adds.
    patchCollectionFile(path, [
      { name: "featured", requirement: { type: "checkbox" } },
    ]);
    const before = readFileSync(path, "utf8");
    // Second run on the same spec — no-op.
    const result = patchCollectionFile(path, [
      { name: "featured", requirement: { type: "checkbox" } },
    ]);
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["featured"]);
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });

  it("renders relationship field with relationTo", () => {
    const path = writeFile("posts.ts", baseFile);
    patchCollectionFile(path, [
      {
        name: "category",
        requirement: { type: "relationship", relationTo: "categories" },
      },
    ]);
    const out = readFileSync(path, "utf8");
    expect(out).toContain('name: "category"');
    expect(out).toContain('relationTo: "categories"');
  });

  it("renders required: true when requirement.required", () => {
    const path = writeFile("posts.ts", baseFile);
    patchCollectionFile(path, [
      { name: "coverImage", requirement: { type: "upload", required: true } },
    ]);
    const out = readFileSync(path, "utf8");
    expect(out).toContain("required: true");
  });

  it("partial idempotent: adds new + skips existing", () => {
    const path = writeFile("posts.ts", baseFile);
    patchCollectionFile(path, [
      { name: "featured", requirement: { type: "checkbox" } },
    ]);
    const result = patchCollectionFile(path, [
      { name: "featured", requirement: { type: "checkbox" } },
      { name: "subtitle", requirement: { type: "text" } },
    ]);
    expect(result.added).toEqual(["subtitle"]);
    expect(result.skipped).toEqual(["featured"]);
  });

  it("recognizes existing fields nested in row containers", () => {
    const path = writeFile(
      "posts.ts",
      `
import { defineCollection } from "@nexpress/core";

export default defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    {
      type: "row",
      fields: [
        { name: "lhs", type: "text" },
        { name: "rhs", type: "text" },
      ],
    },
  ],
});
`.trimStart(),
    );
    const result = patchCollectionFile(path, [
      { name: "lhs", requirement: { type: "text" } },
    ]);
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["lhs"]);
  });

  it("throws when no defineCollection({ fields: [] }) shape found", () => {
    const path = writeFile(
      "posts.ts",
      `export const config = { slug: "posts" };`,
    );
    expect(() =>
      patchCollectionFile(path, [
        { name: "x", requirement: { type: "text" } },
      ]),
    ).toThrow(CollectionPatchError);
  });

  it("does not save the file when nothing was added", () => {
    const path = writeFile("posts.ts", baseFile);
    const before = readFileSync(path, "utf8");
    patchCollectionFile(path, [
      { name: "title", requirement: { type: "text" } }, // already present
    ]);
    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });
});
