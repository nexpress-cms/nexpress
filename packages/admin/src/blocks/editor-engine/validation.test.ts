import { describe, expect, it } from "vitest";
import { isNpRichTextContent } from "@nexpress/core/fields";

import { getFieldValue, isFieldHidden, lintFieldValue } from "./validation.js";

describe("block prop editor validation", () => {
  it("uses exact empty fallbacks for array and rich-text props", () => {
    expect(
      getFieldValue({ name: "items", label: "Items", type: "array", itemSchema: [] }, undefined),
    ).toEqual([]);

    const richText = getFieldValue(
      { name: "body", label: "Body", type: "richtext", translatable: true },
      undefined,
    );
    expect(isNpRichTextContent(richText)).toBe(true);
  });

  it("shares condition semantics and numeric step messages with runtime validation", () => {
    const field = {
      name: "count",
      label: "Count",
      type: "number" as const,
      min: 1,
      step: 2,
      validationMessage: "Use odd numbers",
      visibleWhen: [["enabled", true]] as const,
    };

    expect(isFieldHidden(field, { enabled: false })).toBe(true);
    expect(isFieldHidden(field, { enabled: true })).toBe(false);
    expect(lintFieldValue(field, 2)).toBe("Use odd numbers");
    expect(lintFieldValue(field, 3)).toBeNull();
  });

  it("matches literal trailing dollar patterns without rewriting their source", () => {
    const field = {
      name: "price",
      label: "Price",
      type: "text" as const,
      translatable: false,
      pattern: "price\\$",
    };

    expect(lintFieldValue(field, "price$")).toBeNull();
    expect(lintFieldValue(field, "price")).not.toBeNull();
  });
});
