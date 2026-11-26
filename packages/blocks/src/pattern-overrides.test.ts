import type { NpBlockContent } from "@nexpress/core/fields";
import { describe, expect, it, vi } from "vitest";

import { npApplyPatternOverridesV1 } from "./pattern-overrides.js";
import type { NpBlockMetadata } from "./types.js";

function fixture(): { pattern: NpBlockContent; definitions: NpBlockMetadata[] } {
  return {
    pattern: [
      {
        id: "section",
        type: "example.section",
        props: { title: "Original section" },
        layout: { colSpan: 12, mdColSpan: 6 },
        children: [
          {
            id: "card",
            type: "example.card",
            props: { title: "Original card", count: 2, items: [{ label: "Old item" }] },
          },
        ],
      },
    ],
    definitions: [
      {
        type: "example.section",
        label: "Section",
        defaultProps: {},
        propsSchema: [
          { name: "title", label: "Title", type: "text", translatable: true, required: true },
        ],
        acceptsChildren: true,
        allowedChildTypes: ["example.card"],
        minChildren: 1,
        maxChildren: 2,
      },
      {
        type: "example.card",
        label: "Card",
        defaultProps: { count: 2 },
        propsSchema: [
          { name: "title", label: "Title", type: "text", translatable: true, required: true },
          { name: "count", label: "Count", type: "number", min: 2, max: 6, step: 2 },
          {
            name: "items",
            label: "Items",
            type: "array",
            itemSchema: [
              { name: "label", label: "Label", type: "text", translatable: true, required: true },
            ],
          },
        ],
      },
    ],
  };
}

const wire = (blocks: unknown[]) => ({ schemaVersion: "np.pattern-overrides.v1", blocks });

describe("npApplyPatternOverridesV1", () => {
  it("replaces complete nested props using live schemas while preserving topology and inputs", () => {
    const { pattern, definitions } = fixture();
    const render = vi.fn(() => {
      throw new Error("must not render");
    });
    const actual = definitions.map((definition) => ({ ...definition, render }));
    const snapshot = structuredClone({ pattern, definitions });
    const patch = wire([
      { id: "card", props: { title: "Replacement", items: [{ label: "New item" }] } },
      { id: "section", props: { title: "Replacement section" } },
    ]);
    const result = npApplyPatternOverridesV1(pattern, patch, actual);
    expect(result[0].children?.[0]).toEqual({
      id: "card",
      type: "example.card",
      props: { title: "Replacement", items: [{ label: "New item" }] },
    });
    expect(result[0].layout).toEqual(pattern[0].layout);
    expect(result[0].props).toEqual({ title: "Replacement section" });
    expect({ pattern, definitions }).toEqual(snapshot);
    result[0].children![0].props.title = "Detached";
    expect(patch.blocks[0]).toEqual({
      id: "card",
      props: { title: "Replacement", items: [{ label: "New item" }] },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("accepts both empty forms as detached, strictly validated no-override content", () => {
    const { pattern, definitions } = fixture();
    for (const overrides of [{}, wire([])]) {
      const result = npApplyPatternOverridesV1(pattern, overrides, definitions);
      expect(result).toEqual(pattern);
      expect(result).not.toBe(pattern);
      expect(result[0].children).not.toBe(pattern[0].children);
      expect(result[0].layout).not.toBe(pattern[0].layout);
    }
  });

  it("rejects stale types, unknown props and all child warnings before accepting even an empty override", () => {
    const { pattern, definitions } = fixture();
    expect(() => npApplyPatternOverridesV1(pattern, {}, definitions.slice(0, 1))).toThrow(
      /not registered/u,
    );
    expect(() =>
      npApplyPatternOverridesV1(
        [{ ...pattern[0], props: { title: "Section", stale: true } }],
        {},
        definitions,
      ),
    ).toThrow(/unregistered prop/u);
    expect(() =>
      npApplyPatternOverridesV1([{ ...pattern[0], children: [] }], {}, definitions),
    ).toThrow(/at least/u);
    expect(() =>
      npApplyPatternOverridesV1(pattern, {}, [
        { ...definitions[0], allowedChildTypes: ["different.type"] },
        definitions[1],
      ]),
    ).toThrow(/does not allow/u);
  });

  it("rejects unknown ids, duplicates, unsorted ids and malformed or excess wire fields", () => {
    const { pattern, definitions } = fixture();
    const patch = { id: "card", props: { title: "Card" } };
    for (const overrides of [
      wire([{ ...patch, id: "absent" }]),
      wire([patch, patch]),
      wire([{ id: "section", props: { title: "Section" } }, patch]),
      wire([{ ...patch, id: "../card" }]),
      wire([{ ...patch, type: "example.section" }]),
      wire([{ ...patch, children: [] }]),
      { ...wire([patch]), extra: true },
      { schemaVersion: "np.pattern-overrides.v2", blocks: [] },
      { schemaVersion: "np.pattern-overrides.v1" },
      { blocks: [] },
      wire(Array.from({ length: 1_001 }, () => patch)),
      null,
      [],
    ]) {
      expect(() => npApplyPatternOverridesV1(pattern, overrides, definitions)).toThrow();
    }
  });

  it("uses exact prop and nested item schemas without preserving old values or merging defaults", () => {
    const { pattern, definitions } = fixture();
    for (const props of [
      {},
      { title: "Card", count: 3 },
      { title: "Card", count: "2" },
      { title: "Card", items: [{ label: "" }] },
      { title: "Card", items: [{ label: "Item", unknown: true }] },
      { title: "Card", id: "different-id" },
      { title: "Card", type: "example.section" },
      { title: "Card", children: [] },
    ]) {
      expect(() =>
        npApplyPatternOverridesV1(pattern, wire([{ id: "card", props }]), definitions),
      ).toThrow();
    }
    expect(
      npApplyPatternOverridesV1(
        pattern,
        wire([{ id: "card", props: { title: "Card" } }]),
        definitions,
      )[0].children?.[0].props,
    ).toEqual({ title: "Card" });
  });

  it("rejects hostile getters without invoking them in overrides, patterns or definitions", () => {
    const { pattern, definitions } = fixture();
    const getter = vi.fn(() => "Card");
    const props = Object.defineProperty({}, "title", { enumerable: true, get: getter });
    expect(() =>
      npApplyPatternOverridesV1(pattern, wire([{ id: "card", props }]), definitions),
    ).toThrow();
    const hostileBlock = Object.defineProperty({ ...pattern[0] }, "id", {
      enumerable: true,
      get: getter,
    });
    expect(() => npApplyPatternOverridesV1([hostileBlock], {}, definitions)).toThrow();
    const hostileDefinition = Object.defineProperty({ ...definitions[1] }, "propsSchema", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      npApplyPatternOverridesV1(pattern, {}, [definitions[0], hostileDefinition]),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects prototype changes, cycles, sparse arrays, unsafe numbers and bounded JSON excesses", () => {
    const { pattern, definitions } = fixture();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = new Array<unknown>(1);
    const extra = Object.assign([], { extra: true });
    let deep: unknown = {};
    for (let index = 0; index < 18; index += 1) deep = { next: deep };
    for (const overrides of [
      Object.create({ schemaVersion: "np.pattern-overrides.v1" }),
      Object.create(null),
      cycle,
      wire(sparse),
      wire(extra),
      wire([{ id: "card", props: { title: "Card", count: Number.MAX_SAFE_INTEGER + 1 } }]),
      wire([{ id: "card", props: { title: "Card", extra: deep } }]),
      wire([{ id: "card", props: { title: "x".repeat(512 * 1024 + 1) } }]),
    ]) {
      expect(() => npApplyPatternOverridesV1(pattern, overrides, definitions)).toThrow();
    }
    expect(() =>
      npApplyPatternOverridesV1(pattern, {}, [definitions[0], definitions[1], definitions[1]]),
    ).toThrow(/duplicate/u);
  });
});
