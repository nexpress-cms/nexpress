import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { describe, expect, it } from "vitest";

import {
  npAnalyzeBlockContent,
  npAnalyzeBlockProps,
  npValidateBlockContentAgainstDefinitions,
} from "./content-contract.js";
import type { NpBlockInstance, NpBlockMetadata } from "./types.js";

function definition(overrides: Partial<NpBlockMetadata> = {}): NpBlockMetadata {
  return {
    type: "example.card",
    label: "Card",
    defaultProps: {},
    propsSchema: [],
    ...overrides,
  };
}

function block(overrides: Partial<NpBlockInstance> = {}): NpBlockInstance {
  return {
    id: "block-1",
    type: "example.card",
    props: {},
    ...overrides,
  };
}

describe("npAnalyzeBlockContent", () => {
  it("returns a structural error before consulting definitions", () => {
    expect(npAnalyzeBlockContent({ blocks: [] }, [])).toEqual([
      expect.objectContaining({ code: "invalid-content", severity: "error" }),
    ]);
  });

  it("preserves unknown block types and stale props as warnings", () => {
    const issues = npAnalyzeBlockContent(
      [
        block({ type: "plugin.disabled" }),
        block({ id: "block-2", props: { legacy: true }, layout: { colSpan: 6 } }),
      ],
      [definition()],
    );

    expect(issues).toEqual([
      expect.objectContaining({ code: "unknown-block-type", severity: "warning" }),
      expect.objectContaining({ code: "unknown-prop", propName: "legacy", severity: "warning" }),
    ]);
  });

  it("reports the retired props._layout convention as a stale prop", () => {
    expect(
      npAnalyzeBlockContent([block({ props: { _layout: { colSpan: 6 } } })], [definition()]),
    ).toEqual([
      expect.objectContaining({ code: "unknown-prop", propName: "_layout", severity: "warning" }),
    ]);
  });

  it("validates every supported prop value and recursively checks arrays", () => {
    const metadata = definition({
      propsSchema: [
        { name: "title", label: "Title", type: "text", translatable: true, required: true },
        { name: "count", label: "Count", type: "number", min: 2, max: 6, step: 2 },
        { name: "enabled", label: "Enabled", type: "boolean" },
        {
          name: "tone",
          label: "Tone",
          type: "select",
          options: [{ label: "Info", value: "info" }],
        },
        { name: "body", label: "Body", type: "richtext", translatable: true },
        {
          name: "items",
          label: "Items",
          type: "array",
          itemSchema: [
            {
              name: "label",
              label: "Label",
              type: "text",
              translatable: true,
              required: true,
            },
          ],
        },
      ],
    });
    const valid = block({
      props: {
        title: "Hello",
        count: 4,
        enabled: true,
        tone: "info",
        body: npCreateEmptyRichTextContent(),
        items: [{ label: "One" }],
      },
    });
    expect(npValidateBlockContentAgainstDefinitions([valid], [metadata])).toEqual({
      ok: true,
      value: [valid],
      warnings: [],
    });

    const issues = npAnalyzeBlockContent(
      [
        block({
          props: {
            title: "",
            count: 5,
            enabled: "yes",
            tone: "danger",
            body: {},
            items: [{ label: "" }, "bad"],
          },
        }),
      ],
      [metadata],
    );
    expect(issues.filter((entry) => entry.severity === "error")).toHaveLength(7);
    expect(issues.map((entry) => entry.code)).toContain("missing-required-prop");
    expect(issues.map((entry) => entry.code)).toContain("invalid-prop");
  });

  it("applies defaults and conditional visibility before required checks", () => {
    const metadata = definition({
      propsSchema: [
        { name: "mode", label: "Mode", type: "boolean", defaultValue: false },
        {
          name: "title",
          label: "Title",
          type: "text",
          translatable: true,
          required: true,
          defaultValue: "Default title",
        },
        {
          name: "url",
          label: "URL",
          type: "url",
          required: true,
          visibleWhen: [["mode", true]],
        },
      ],
    });

    expect(npAnalyzeBlockContent([block()], [metadata])).toEqual([]);
  });

  it("uses the definition contract's no-flag regular expression grammar", () => {
    const metadata = definition({
      propsSchema: [
        {
          name: "slug",
          label: "Slug",
          type: "text",
          translatable: false,
          pattern: "\\_",
        },
      ],
    });

    expect(npAnalyzeBlockContent([block({ props: { slug: "_" } })], [metadata])).toEqual([]);
  });

  it("enforces container upper bounds and child types while leaving minimums soft", () => {
    const container = definition({
      type: "example.stack",
      acceptsChildren: true,
      minChildren: 2,
      maxChildren: 2,
      allowedChildTypes: ["example.card"],
    });
    const leaf = definition();

    expect(
      npAnalyzeBlockContent(
        [block({ type: "example.stack", children: [block({ id: "child-1" })] })],
        [container, leaf],
      ),
    ).toEqual([expect.objectContaining({ code: "too-few-children", severity: "warning" })]);

    const issues = npAnalyzeBlockContent(
      [
        block({
          type: "example.stack",
          children: [
            block({ id: "child-1" }),
            block({ id: "child-2", type: "example.other" }),
            block({ id: "child-3" }),
          ],
        }),
      ],
      [container, leaf],
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "too-many-children", severity: "error" }),
        expect.objectContaining({ code: "disallowed-child-type", severity: "error" }),
        expect.objectContaining({ code: "unknown-block-type", severity: "warning" }),
      ]),
    );
  });

  it("rejects children attached to a known leaf block", () => {
    expect(
      npAnalyzeBlockContent([block({ children: [block({ id: "child-1" })] })], [definition()]),
    ).toEqual([expect.objectContaining({ code: "unexpected-children", severity: "error" })]);
  });
});

describe("npAnalyzeBlockProps", () => {
  it("checks props without producing container-child diagnostics", () => {
    const metadata = definition({
      acceptsChildren: true,
      minChildren: 2,
      propsSchema: [
        { name: "title", label: "Title", type: "text", translatable: true, required: true },
      ],
    });

    expect(npAnalyzeBlockProps({}, metadata)).toEqual([
      expect.objectContaining({ code: "missing-required-prop", severity: "error" }),
    ]);
  });
});
