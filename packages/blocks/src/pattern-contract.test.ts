import { describe, expect, expectTypeOf, it } from "vitest";

import {
  npAnalyzePatternDefinitions,
  npValidatePattern,
  npValidatePatternDefinition,
  type NpPatternDefinitionIssueCode,
} from "./pattern-contract.js";

const validPattern = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "acme.notice-stack",
  label: "Notice stack",
  description: "Two notices in a reusable stack.",
  category: "section",
  preview: "/patterns/notice-stack.webp",
  blocks: [
    {
      id: "template-notice",
      type: "acme.notice",
      props: { title: "Heads up", options: ["compact"] },
      children: [
        {
          id: "template-copy",
          type: "richText",
          props: { content: null },
        },
      ],
    },
  ],
  ...overrides,
});

describe("pattern definition contract", () => {
  it("accepts an author contribution without source and a registered pattern with source", () => {
    expect(npValidatePatternDefinition(validPattern())).toEqual({ ok: true });
    expect(npValidatePattern({ ...validPattern(), source: "plugin:acme" })).toEqual({ ok: true });
    expectTypeOf<NpPatternDefinitionIssueCode>().toEqualTypeOf<
      "invalid-list" | "invalid-definition" | "duplicate-id" | "unknown-block-type"
    >();
  });

  it.each([
    [{ ...validPattern(), typo: true }, /unsupported field "typo"/],
    [validPattern({ id: "bad/id" }), /pattern\.id/],
    [validPattern({ label: "" }), /pattern\.label/],
    [validPattern({ blocks: [] }), /at least one block instance/],
    [
      validPattern({
        blocks: [{ id: "one", type: "acme.notice", props: [], children: [] }],
      }),
      /props must be an object/,
    ],
    [validPattern({ blocks: [{ id: "one", type: "bad/type", props: {} }] }), /\.type/],
    [
      validPattern({
        blocks: [{ id: "one", type: "acme.notice", props: { value: Infinity } }],
      }),
      /finite number/,
    ],
    [
      validPattern({
        blocks: [{ id: "one", type: "acme.notice", props: {}, children: {} }],
      }),
      /children must be an array/,
    ],
  ])("rejects malformed definitions %#", (pattern, message) => {
    const result = npValidatePatternDefinition(pattern);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("rejects circular block trees and circular props", () => {
    const circularBlock: Record<string, unknown> = {
      id: "one",
      type: "acme.notice",
      props: {},
      children: [],
    };
    (circularBlock.children as unknown[]).push(circularBlock);
    expect(npValidatePatternDefinition(validPattern({ blocks: [circularBlock] }))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/circular block tree/),
    });

    const circularProps: Record<string, unknown> = {};
    circularProps.self = circularProps;
    expect(
      npValidatePatternDefinition(
        validPattern({ blocks: [{ id: "one", type: "acme.notice", props: circularProps }] }),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/circular references/) });
  });

  it("rejects duplicate block ids across a pattern tree", () => {
    expect(
      npValidatePatternDefinition(
        validPattern({
          blocks: [
            { id: "shared", type: "acme.notice", props: {} },
            { id: "shared", type: "richText", props: {} },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/duplicates block id/) });
  });

  it("requires concrete source only at registry time", () => {
    expect(npValidatePatternDefinition(validPattern())).toEqual({ ok: true });
    expect(npValidatePattern(validPattern())).toEqual({
      ok: false,
      message: "pattern.source must be assigned before registration.",
    });
    expect(npValidatePattern({ ...validPattern(), source: "" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/pattern\.source/),
    });
  });

  it("reports malformed lists and duplicate ids independently", () => {
    expect(npAnalyzePatternDefinitions({})).toEqual([
      { code: "invalid-list", message: "patterns must be an array." },
    ]);
    expect(npAnalyzePatternDefinitions([validPattern(), validPattern({ blocks: [] })])).toEqual([
      expect.objectContaining({ code: "invalid-definition", index: 1 }),
      {
        code: "duplicate-id",
        index: 1,
        id: "acme.notice-stack",
        message: 'duplicate pattern id "acme.notice-stack".',
      },
    ]);
  });

  it("reports unknown block types throughout the recursive tree when context is available", () => {
    expect(
      npAnalyzePatternDefinitions([validPattern()], {
        knownBlockTypes: new Set(["acme.notice"]),
      }),
    ).toEqual([
      {
        code: "unknown-block-type",
        index: 0,
        id: "acme.notice-stack",
        blockType: "richText",
        message: 'pattern "acme.notice-stack" references unknown block type "richText".',
      },
    ]);
  });
});
