import { describe, expect, it } from "vitest";

import { findCollectionBlockContentError } from "./collection-block-validation.js";
import type { NpBlockMetadata } from "@nexpress/blocks";
import type { NpFieldConfig } from "@nexpress/core";

const definitions: NpBlockMetadata[] = [
  {
    type: "card",
    label: "Card",
    defaultProps: {},
    propsSchema: [
      { name: "title", label: "Title", type: "text", translatable: true, required: true },
    ],
  },
];

describe("findCollectionBlockContentError", () => {
  it("finds definition errors in top-level block fields", () => {
    const fields: NpFieldConfig[] = [{ type: "blocks", name: "content" }];
    const result = findCollectionBlockContentError(
      fields,
      { content: [{ id: "one", type: "card", props: {} }] },
      definitions,
    );

    expect(result).toEqual({
      fieldPath: "content",
      issue: expect.objectContaining({ code: "missing-required-prop", severity: "error" }),
    });
  });

  it("walks groups and arrays and ignores preservation warnings", () => {
    const fields: NpFieldConfig[] = [
      {
        type: "group",
        name: "layout",
        fields: [
          {
            type: "array",
            name: "sections",
            fields: [{ type: "blocks", name: "content" }],
          },
        ],
      },
    ];

    expect(
      findCollectionBlockContentError(
        fields,
        {
          layout: {
            sections: [{ content: [{ id: "one", type: "plugin.disabled", props: {} }] }],
          },
        },
        definitions,
      ),
    ).toBeNull();

    expect(
      findCollectionBlockContentError(
        fields,
        {
          layout: {
            sections: [{ content: [{ id: "one", type: "card", props: {} }] }],
          },
        },
        definitions,
      )?.fieldPath,
    ).toBe("layout.sections.0.content");
  });
});
