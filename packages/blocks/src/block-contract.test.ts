import { describe, expect, expectTypeOf, it } from "vitest";
import type { NpBlockDiscoveryPropFieldType } from "@nexpress/core/discovery";

import {
  npAnalyzeBlockDefinitions,
  npBlockPropFieldTypes,
  npValidateBlockDefinition,
  type NpBlockPropFieldType,
} from "./block-contract.js";
import { getDefaultBlocks } from "./registry.js";
import type { NpBlockPropField } from "./types.js";

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
    ]);
    expectTypeOf<(typeof npBlockPropFieldTypes)[number]>().toEqualTypeOf<NpBlockPropFieldType>();
    expectTypeOf<NpBlockPropFieldType>().toEqualTypeOf<NpBlockDiscoveryPropFieldType>();
    expectTypeOf<Extract<NpBlockPropField, { type: "number" }>["defaultValue"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<Extract<NpBlockPropField, { type: "array" }>["itemSchema"]>().toEqualTypeOf<
      NpBlockPropField[]
    >();
  });

  it("accepts a complete definition and every bundled built-in block", () => {
    expect(npValidateBlockDefinition(validBlock())).toEqual({ ok: true });
    for (const block of getDefaultBlocks()) {
      expect(npValidateBlockDefinition(block), block.type).toEqual({ ok: true });
    }
  });

  it("rejects default prop values that violate the declared prop schema", () => {
    const direct = npValidateBlockDefinition(
      validBlock({
        defaultProps: { count: "three" },
        propsSchema: [{ name: "count", label: "Count", type: "number" }],
        summaryFields: ["count"],
      }),
    );
    expect(direct).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining("must be a finite number"),
      }),
    );

    const fieldDefault = npValidateBlockDefinition(
      validBlock({
        defaultProps: {},
        propsSchema: [
          {
            name: "tone",
            label: "Tone",
            type: "select",
            defaultValue: "missing",
            options: [{ label: "Info", value: "info" }],
          },
        ],
        summaryFields: ["tone"],
      }),
    );
    expect(fieldDefault).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining("registered option values"),
      }),
    );
  });

  it("compiles text patterns with the same no-flag grammar as Admin validation", () => {
    expect(
      npValidateBlockDefinition(
        validBlock({
          defaultProps: { slug: "_" },
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

    expect(
      npValidateBlockDefinition(
        validBlock({
          defaultProps: { price: "price$" },
          propsSchema: [
            {
              name: "price",
              label: "Price",
              type: "text",
              translatable: false,
              pattern: "price\\$",
            },
          ],
          summaryFields: ["price"],
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
      /between 1 and/,
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
      /min is not supported for text/,
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
      /not supported for text/,
    ],
    [
      validBlock({
        propsSchema: [
          {
            name: "title",
            label: "Title",
            type: "text",
            translatable: true,
            patternMessage: "Old key",
          },
        ],
      }),
      /patternMessage is not supported/,
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
          defaultProps: { items: [] },
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

  it("validates conditional references and array item defaults against sibling schemas", () => {
    const conditional = (condition: unknown) =>
      validBlock({
        defaultProps: {},
        summaryFields: [],
        propsSchema: [
          {
            name: "mode",
            label: "Mode",
            type: "select",
            options: [{ label: "Image", value: "image" }],
          },
          {
            name: "caption",
            label: "Caption",
            type: "text",
            translatable: true,
            visibleWhen: condition,
          },
        ],
      });

    expect(npValidateBlockDefinition(conditional([["mode", "image"]]))).toEqual({ ok: true });
    for (const [condition, message] of [
      [[], /between 1 and/],
      [["bad"], /pair/],
      [[["missing", true]], /unknown sibling/],
      [[["caption", "x"]], /own field/],
      [[["mode", "video"]], /select option/],
    ] as const) {
      const result = npValidateBlockDefinition(conditional(condition));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
    }

    const invalidItemDefault = npValidateBlockDefinition(
      validBlock({
        defaultProps: {},
        summaryFields: [],
        propsSchema: [
          {
            name: "items",
            label: "Items",
            type: "array",
            itemSchema: [{ name: "enabled", label: "Enabled", type: "boolean" }],
            itemDefault: { enabled: "yes" },
          },
        ],
      }),
    );
    expect(invalidItemDefault).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("itemDefault") }),
    );

    const hiddenInvalidDefault = npValidateBlockDefinition(
      validBlock({
        defaultProps: { mode: "image", caption: 42 },
        summaryFields: [],
        propsSchema: [
          {
            name: "mode",
            label: "Mode",
            type: "select",
            options: [{ label: "Image", value: "image" }],
          },
          {
            name: "caption",
            label: "Caption",
            type: "text",
            translatable: true,
            hiddenWhen: [["mode", "image"]],
          },
        ],
      }),
    );
    expect(hiddenInvalidDefault).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("must be a string") }),
    );
  });

  it("rejects undeclared defaults and explicit undefined metadata", () => {
    expect(
      npValidateBlockDefinition(validBlock({ defaultProps: { title: "Hello", stale: true } })),
    ).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("unregistered prop") }),
    );
    expect(
      npValidateBlockDefinition(
        validBlock({
          propsSchema: [
            {
              name: "title",
              label: "Title",
              type: "text",
              translatable: true,
              description: undefined,
            },
          ],
          summaryFields: ["title"],
        }),
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("description") }),
    );
  });

  it("fails closed on accessor metadata without executing it", () => {
    let reads = 0;
    const definition = validBlock();
    Object.defineProperty(definition.propsSchema as object, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return { name: "title", label: "Title", type: "text", translatable: true };
      },
    });

    expect(npValidateBlockDefinition(definition)).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("data property") }),
    );
    expect(reads).toBe(0);

    const condition: unknown[] = ["enabled", true];
    Object.defineProperty(condition, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return "enabled";
      },
    });
    expect(
      npValidateBlockDefinition(
        validBlock({
          defaultProps: {},
          propsSchema: [
            { name: "enabled", label: "Enabled", type: "boolean" },
            {
              name: "title",
              label: "Title",
              type: "text",
              translatable: true,
              visibleWhen: [condition],
            },
          ],
          summaryFields: [],
        }),
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining("data property") }),
    );
    expect(reads).toBe(0);

    const accessorDefinition = validBlock();
    Object.defineProperty(accessorDefinition, "type", {
      enumerable: true,
      get() {
        reads += 1;
        return "unsafe";
      },
    });
    expect(npAnalyzeBlockDefinitions([accessorDefinition])).toEqual([
      expect.objectContaining({ code: "invalid-definition" }),
    ]);
    expect(reads).toBe(0);
  });

  it("rejects hidden array metadata and oversized serializable defaults", () => {
    const schema = [{ name: "title", label: "Title", type: "text", translatable: true }];
    Object.defineProperty(schema, "hidden", { value: true, enumerable: false });
    expect(npValidateBlockDefinition(validBlock({ propsSchema: schema }))).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('unsupported array property "hidden"'),
      }),
    );

    expect(
      npValidateBlockDefinition(
        validBlock({
          defaultProps: { title: "x".repeat(100_001) },
          propsSchema: [{ name: "title", label: "Title", type: "text", translatable: true }],
          summaryFields: ["title"],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining("at most 100000 characters"),
      }),
    );
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
      expect.objectContaining({ ok: false, message: expect.stringContaining("not supported") }),
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
