import { describe, expect, it } from "vitest";

import type { NpBlockMetadata } from "@nexpress/blocks";

import { blockToManifest } from "./manifest.js";

describe("block discovery manifest", () => {
  it("projects exact type-specific prop variants and recursive array metadata", () => {
    const metadata: NpBlockMetadata = {
      type: "demo.card",
      label: "Card",
      defaultProps: { mode: "hero", title: "Hello", count: 2, items: [] },
      propsSchema: [
        {
          name: "mode",
          label: "Mode",
          type: "select",
          options: [{ label: "Hero", value: "hero" }],
        },
        {
          name: "title",
          label: "Title",
          type: "text",
          translatable: true,
          pattern: "[A-Z].+",
          validationMessage: "Start with a capital letter",
          visibleWhen: [["mode", "hero"]],
        },
        {
          name: "count",
          label: "Count",
          type: "number",
          min: 0,
          step: 2,
        },
        {
          name: "items",
          label: "Items",
          type: "array",
          itemSchema: [{ name: "enabled", label: "Enabled", type: "boolean" }],
          itemDefault: { enabled: true },
        },
      ],
    };

    expect(blockToManifest(metadata).propsSchema).toEqual([
      {
        name: "mode",
        label: "Mode",
        type: "select",
        options: [{ label: "Hero", value: "hero" }],
      },
      {
        name: "title",
        label: "Title",
        type: "text",
        translatable: true,
        pattern: "[A-Z].+",
        validationMessage: "Start with a capital letter",
        visibleWhen: [["mode", "hero"]],
      },
      { name: "count", label: "Count", type: "number", min: 0, step: 2 },
      {
        name: "items",
        label: "Items",
        type: "array",
        itemSchema: [{ name: "enabled", label: "Enabled", type: "boolean" }],
        itemDefault: { enabled: true },
      },
    ]);
  });
});
