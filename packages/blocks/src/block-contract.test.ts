import { describe, expect, expectTypeOf, it } from "vitest";

import {
  npAnalyzeBlockDefinitions,
  npBlockPropFieldTypes,
  npValidateBlockDefinition,
  type NpBlockPropFieldType,
} from "./block-contract.js";
import { getDefaultBlocks } from "./registry.js";

const validBlock = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "demo.callout",
  label: "Callout",
  description: "A reusable callout.",
  defaultProps: { title: "Hello", tone: "info" },
  propsSchema: [
    { name: "title", label: "Title", type: "text", translatable: true, required: true },
    {
      name: "tone",
      label: "Tone",
      type: "select",
      options: [
        { label: "Info", value: "info" },
        { label: "Warning", value: "warning" },
      ],
    },
  ],
  summaryFields: ["title"],
  render: () => null,
  ...overrides,
});

describe("block definition contract", () => {
  it("keeps the prop field runtime inventory aligned with its type", () => {
    expect(npBlockPropFieldTypes).toEqual([
      "text",
      "textarea",
      "number",
      "boolean",
      "select",
      "url",
      "richtext",
      "image",
      "color",
      "collection",
      "array",
      "media",
    ]);
    expectTypeOf<(typeof npBlockPropFieldTypes)[number]>().toEqualTypeOf<NpBlockPropFieldType>();
  });

  it("accepts a complete definition and every bundled built-in block", () => {
    expect(npValidateBlockDefinition(validBlock())).toEqual({ ok: true });
    for (const block of getDefaultBlocks()) {
      expect(npValidateBlockDefinition(block), block.type).toEqual({ ok: true });
    }
  });

  it("compiles text patterns with the same no-flag grammar as Admin validation", () => {
    expect(
      npValidateBlockDefinition(
        validBlock({
          propsSchema: [
            {
              name: "slug",
              label: "Slug",
              type: "text",
              translatable: false,
              pattern: "\\_",
            },
          ],
          summaryFields: ["slug"],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    [{ ...validBlock(), typo: true }, /unsupported field "typo"/],
    [validBlock({ type: "bad/type" }), /block\.type/],
    [validBlock({ label: "" }), /block\.label/],
    [validBlock({ defaultProps: [] }), /defaultProps/],
    [validBlock({ defaultProps: { now: new Date() } }), /arrays and plain objects/],
    [validBlock({ propsSchema: {} }), /propsSchema/],
    [validBlock({ render: "./component.js" }), /render/],
    [validBlock({ iconKind: "custom" }), /iconKind/],
  ])("rejects malformed top-level definitions %#", (definition, message) => {
    const result = npValidateBlockDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it.each([
    [
      validBlock({
        propsSchema: [{ name: "title", label: "Title", type: "markdown", translatable: true }],
      }),
      /type must be one of/,
    ],
    [
      validBlock({
        propsSchema: [
          { name: "title", label: "Title", type: "text", translatable: true },
          { name: "title", label: "Again", type: "text", translatable: true },
        ],
      }),
      /must not repeat field name "title"/,
    ],
    [
      validBlock({ propsSchema: [{ name: "tone", label: "Tone", type: "select" }] }),
      /at least one option/,
    ],
    [
      validBlock({
        propsSchema: [
          {
            name: "tone",
            label: "Tone",
            type: "select",
            options: [
              { label: "Info", value: "same" },
              { label: "Again", value: "same" },
            ],
          },
        ],
      }),
      /must not repeat option value/,
    ],
    [
      validBlock({
        propsSchema: [{ name: "title", label: "Title", type: "text", translatable: true, min: 1 }],
      }),
      /min is supported only for number/,
    ],
    [
      validBlock({
        propsSchema: [{ name: "count", label: "Count", type: "number", min: 10, max: 1 }],
      }),
      /min must be less than or equal to max/,
    ],
    [
      validBlock({
        propsSchema: [
          { name: "title", label: "Title", type: "text", translatable: true, pattern: "[" },
        ],
      }),
      /not a valid regular expression/,
    ],
    [
      validBlock({ propsSchema: [{ name: "items", label: "Items", type: "array" }] }),
      /itemSchema is required/,
    ],
    [
      validBlock({
        propsSchema: [
          {
            name: "title",
            label: "Title",
            type: "text",
            translatable: true,
            defaultValue: () => "bad",
          },
        ],
      }),
      /serializable values/,
    ],
    [
      validBlock({
        propsSchema: [
          {
            name: "title",
            label: "Title",
            type: "text",
            translatable: true,
            itemSchema: [],
          },
        ],
      }),
      /supported only for array/,
    ],
    [
      validBlock({
        propsSchema: [
          { name: "asset", label: "Asset", type: "media", accept: ["image/", "image/"] },
        ],
      }),
      /must not repeat/,
    ],
  ])("rejects malformed prop schemas %#", (definition, message) => {
    const result = npValidateBlockDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("validates nested array schemas and rejects circular definitions", () => {
    expect(
      npValidateBlockDefinition(
        validBlock({
          summaryFields: ["items"],
          propsSchema: [
            {
              name: "items",
              label: "Items",
              type: "array",
              itemSchema: [{ name: "title", label: "Title", type: "text", translatable: true }],
              itemDefault: { title: "New item" },
            },
          ],
        }),
      ),
    ).toEqual({ ok: true });

    const circular: unknown[] = [];
    circular.push({ name: "items", label: "Items", type: "array", itemSchema: circular });
    const result = npValidateBlockDefinition(
      validBlock({ propsSchema: circular, summaryFields: ["items"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/circular schema/);
  });

  it("requires explicit translation intent on textual leaves only", () => {
    const missing = npValidateBlockDefinition(
      validBlock({
        propsSchema: [{ name: "title", label: "Title", type: "text" }],
        summaryFields: ["title"],
      }),
    );
    expect(missing).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("translatable") }),
    );

    const misplaced = npValidateBlockDefinition(
      validBlock({
        propsSchema: [{ name: "enabled", label: "Enabled", type: "boolean", translatable: false }],
        summaryFields: [],
      }),
    );
    expect(misplaced).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("supported only") }),
    );
  });

  it.each([
    [validBlock({ summaryFields: ["missing"] }), /unknown prop "missing"/],
    [validBlock({ minChildren: 1 }), /require acceptsChildren/],
    [
      validBlock({ acceptsChildren: true, minChildren: 3, maxChildren: 2 }),
      /minChildren must be less than or equal/,
    ],
    [validBlock({ acceptsChildren: true, allowedChildTypes: ["bad/type"] }), /invalid type/],
  ])("rejects inconsistent metadata and container contracts %#", (definition, message) => {
    const result = npValidateBlockDefinition(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("reports invalid arrays and same-list duplicate types separately", () => {
    expect(npAnalyzeBlockDefinitions({})).toEqual([
      { code: "invalid-list", message: "blocks must be an array." },
    ]);
    expect(npAnalyzeBlockDefinitions([validBlock(), validBlock({ render: "bad" })])).toEqual([
      expect.objectContaining({ code: "invalid-definition", index: 1 }),
      {
        code: "duplicate-type",
        index: 1,
        type: "demo.callout",
        message: 'duplicate block type "demo.callout".',
      },
    ]);
  });
});
