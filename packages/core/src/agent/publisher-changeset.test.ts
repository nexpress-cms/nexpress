import { describe, expect, it } from "vitest";
import type { NpFieldConfig } from "../config/types.js";
import { npPublisherPatchPreservesProtectedFieldsV1 as preserves } from "./publisher-changeset.js";

describe("Publisher replacements preserve unobserved fields", () => {
  const fields: NpFieldConfig[] = [
    { name: "title", type: "text" },
    {
      name: "seo",
      type: "group",
      fields: [
        { name: "title", type: "text" },
        { name: "internal", type: "text", hidden: true },
      ],
    },
    {
      name: "sections",
      type: "array",
      fields: [
        { name: "heading", type: "text" },
        {
          name: "tracking",
          type: "group",
          fields: [{ name: "id", type: "text", admin: { readOnly: true } }],
        },
      ],
    },
    { name: "metadata", type: "group", fields: [{ name: "description", type: "text" }] },
  ];
  it("rejects replacement or clearing of structures with protected descendants", () => {
    for (const patch of [
      { seo: { title: "New" } },
      { seo: null },
      { sections: [] },
      { sections: [{ heading: "New" }] },
    ])
      expect(preserves(patch, fields)).toBe(false);
  });
  it("allows visible independent edits without erasing other top-level structures", () => {
    expect(preserves({ title: "New", metadata: { description: "Visible" } }, fields)).toBe(true);
    expect(preserves({ unknown: "Unobserved" }, fields)).toBe(false);
  });
});
