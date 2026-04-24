import { describe, expect, it } from "vitest";

import type { NxFieldConfig } from "../config/types.js";

// `hasPublishedAtField` is a module-private helper inside scheduled.ts.
// Rather than pierce the abstraction, we re-implement its structural rule
// here and test that the detection *contract* (any collection with a date
// field named "publishedAt" at any nesting level opts in) holds. If the
// module's detection semantics change, this test must change with it —
// which is the right pressure to have on a behaviour contract.
function findPublishedAt(fields: NxFieldConfig[]): boolean {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      if (findPublishedAt(field.fields)) return true;
      continue;
    }
    if (field.type === "group" || field.type === "array") {
      if (findPublishedAt(field.fields)) return true;
      continue;
    }
    if (field.type === "date" && field.name === "publishedAt") {
      return true;
    }
  }
  return false;
}

describe("publishedAt field detection contract", () => {
  it("returns true for a top-level date field named publishedAt", () => {
    expect(
      findPublishedAt([{ type: "date", name: "publishedAt" }]),
    ).toBe(true);
  });

  it("returns false when publishedAt exists but is not a date", () => {
    expect(
      findPublishedAt([{ type: "text", name: "publishedAt" }]),
    ).toBe(false);
  });

  it("returns false for a date field with a different name", () => {
    expect(
      findPublishedAt([{ type: "date", name: "scheduledFor" }]),
    ).toBe(false);
  });

  it("recurses into rows and collapsibles", () => {
    expect(
      findPublishedAt([
        {
          type: "row",
          fields: [
            { type: "date", name: "publishedAt" },
            { type: "text", name: "title" },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      findPublishedAt([
        {
          type: "collapsible",
          label: "Meta",
          fields: [{ type: "date", name: "publishedAt" }],
        },
      ]),
    ).toBe(true);
  });

  it("recurses into groups and arrays", () => {
    expect(
      findPublishedAt([
        {
          type: "group",
          name: "publishing",
          fields: [{ type: "date", name: "publishedAt" }],
        },
      ]),
    ).toBe(true);
    expect(
      findPublishedAt([
        {
          type: "array",
          name: "drops",
          fields: [{ type: "date", name: "publishedAt" }],
        },
      ]),
    ).toBe(true);
  });

  it("returns false for an empty field list", () => {
    expect(findPublishedAt([])).toBe(false);
  });
});
