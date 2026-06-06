import { describe, expect, it } from "vitest";
import type { NpBlockPropField } from "@nexpress/blocks";

import { getEditableArrayItemSchema, normalizeArrayValue } from "./array-field-control.js";

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
          itemSchema: [{ name: "value", label: "Cell", type: "text" }],
        },
        { name: "required", label: "Required", type: "boolean" },
      ],
    };

    expect(getEditableArrayItemSchema(field).map((item) => item.name)).toEqual([
      "cells",
      "required",
    ]);
  });

  it("normalizes primitive arrays into the first item field", () => {
    const itemSchema: NpBlockPropField[] = [{ name: "value", label: "Cell", type: "text" }];

    expect(normalizeArrayValue(["slug", "string"], itemSchema)).toEqual([
      { value: "slug" },
      { value: "string" },
    ]);
  });
});
