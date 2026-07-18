import { describe, expect, it } from "vitest";
import type { NpBlockPropField } from "@nexpress/blocks";

import { getVisibleArrayItemFields, readArrayValue } from "./array-field-control.js";

describe("array field control helpers", () => {
  it("keeps nested array fields editable", () => {
    const field: NpBlockPropField = {
      name: "rows",
      label: "Rows",
      type: "array",
      itemSchema: [
        {
          name: "cells",
          label: "Cells",
          type: "array",
          itemSchema: [{ name: "value", label: "Cell", type: "text", translatable: true }],
        },
        { name: "required", label: "Required", type: "boolean" },
      ],
    };

    expect(field.itemSchema.map((item) => item.name)).toEqual(["cells", "required"]);
  });

  it("accepts only exact object arrays without coercing legacy values", () => {
    expect(readArrayValue([{ value: "slug" }, { value: "string" }])).toEqual([
      { value: "slug" },
      { value: "string" },
    ]);
    expect(readArrayValue(["slug", "string"])).toBeNull();
    expect(readArrayValue('[{"value":"slug"}]')).toBeNull();
  });

  it("applies sibling visibility conditions inside array items", () => {
    const field: Extract<NpBlockPropField, { type: "array" }> = {
      name: "items",
      label: "Items",
      type: "array",
      itemSchema: [
        { name: "enabled", label: "Enabled", type: "boolean" },
        {
          name: "label",
          label: "Label",
          type: "text",
          translatable: true,
          visibleWhen: [["enabled", true]],
        },
      ],
    };

    expect(getVisibleArrayItemFields(field, { enabled: false }).map((item) => item.name)).toEqual([
      "enabled",
    ]);
    expect(getVisibleArrayItemFields(field, { enabled: true }).map((item) => item.name)).toEqual([
      "enabled",
      "label",
    ]);
  });
});
