import { describe, expect, it } from "vitest";

import { getCollectionFieldDefaultValue } from "./collection-edit-defaults.js";

describe("collection editor defaults", () => {
  it("starts block fields with canonical empty block content", () => {
    expect(getCollectionFieldDefaultValue({ type: "blocks", name: "blocks" }, {})).toEqual([]);
  });

  it("preserves an existing block tree", () => {
    const blocks = [{ id: "hero-1", type: "hero", props: {} }];
    expect(getCollectionFieldDefaultValue({ type: "blocks", name: "blocks" }, { blocks })).toBe(
      blocks,
    );
  });

  it("keeps JSON fields distinct from block content", () => {
    expect(getCollectionFieldDefaultValue({ type: "json", name: "metadata" }, {})).toEqual({});
  });
});
