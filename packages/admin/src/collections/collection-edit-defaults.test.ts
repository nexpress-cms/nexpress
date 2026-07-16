import { describe, expect, it } from "vitest";

import {
  getCollectionFieldDefaultValue,
  normalizeCollectionEditorRequestValues,
} from "./collection-edit-defaults.js";

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

  it("omits a blank generated slug so the server can derive it", () => {
    expect(normalizeCollectionEditorRequestValues({ title: "Hello", slug: "  " }, true)).toEqual({
      title: "Hello",
    });
  });

  it("preserves explicit slugs and fields without slug generation", () => {
    expect(normalizeCollectionEditorRequestValues({ slug: "custom-path" }, true)).toEqual({
      slug: "custom-path",
    });
    expect(normalizeCollectionEditorRequestValues({ slug: "" }, false)).toEqual({ slug: "" });
  });
});
