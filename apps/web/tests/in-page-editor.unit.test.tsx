import { describe, expect, it } from "vitest";
import {
  getDefaultBlocks,
  type NpBlockDefinition,
  type NpBlockInstance,
} from "@nexpress/blocks";

// Engine reducer + factory — deep-imported because the public
// `@nexpress/admin` exports only surface UI components today. The
// editor engine is intentionally UI-agnostic; reaching in through
// the source path keeps the engine internal while still letting
// the unit suite cover its contract.
import {
  createBlockInstance,
  createEditorReducer,
} from "../../../packages/admin/src/blocks/editor-engine/reducer.js";
import type { EditorAction } from "../../../packages/admin/src/blocks/editor-engine/types.js";

/**
 * In-page editor unit suite. Atom-block-specific tests + the
 * markdown inline-marks tests were dropped when the Doc view was
 * rewritten as a server-rendered preview surface (rich-text
 * subsumed the atoms). What stays:
 *
 *   - Legacy block metadata invariants (Lucide migration).
 *   - REPLACE_TYPE reducer contract — still part of the engine,
 *     surfaced by Page builder's bulk actions and any future
 *     "convert this block" affordance.
 */

const defaults = getDefaultBlocks();
const byType = new Map<string, NpBlockDefinition>(
  defaults.map((d) => [d.type, d]),
);

describe("legacy built-in blocks migrated to Lucide", () => {
  const legacyTypes = [
    "hero",
    "feature-grid",
    "faq",
    "pricing",
    "cta",
    "rich-text",
    "contact-form",
    "image-gallery",
    "grid",
    "section-header",
    "testimonials",
    "stats-grid",
    "logos-cloud",
    "tabs",
  ];

  it.each(legacyTypes)("%s ships a Lucide icon name", (type) => {
    const def = byType.get(type);
    // Lucide names start with an uppercase letter, no emoji
    // codepoints. Permits e.g. "Heading1" with the digit suffix
    // some lucide icons carry.
    expect(def?.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    expect(def?.iconKind).toBe("lucide");
  });

  it("no built-in block carries an emoji icon after the migration", () => {
    for (const def of defaults) {
      if (def.iconKind === "emoji") continue; // Plugin escape hatch
      expect(def.icon ?? "").toMatch(/^([A-Z][A-Za-z0-9]*)?$/);
    }
  });
});

describe("editor reducer — REPLACE_TYPE", () => {
  // Build a reducer pinned to the production registry so the cases
  // below exercise the same definitions plugin authors and the
  // admin UI see at runtime.
  const reducer = createEditorReducer(defaults);
  const apply = (
    state: NpBlockInstance[],
    action: EditorAction,
  ): NpBlockInstance[] => reducer(state, action);

  const seedRichText = (
    overrides: Partial<NpBlockInstance> = {},
  ): NpBlockInstance => {
    const def = byType.get("rich-text") as NpBlockDefinition;
    const base = createBlockInstance(def);
    return {
      ...base,
      ...overrides,
      props: { ...base.props, ...(overrides.props ?? {}) },
    };
  };

  it("preserves the source id across the swap", () => {
    const block = seedRichText();
    const next = apply([block], {
      type: "REPLACE_TYPE",
      id: block.id,
      newType: "cta",
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(block.id);
    expect(next[0].type).toBe("cta");
  });

  it("is a no-op when the new type isn't registered", () => {
    const block = seedRichText();
    const next = apply([block], {
      type: "REPLACE_TYPE",
      id: block.id,
      newType: "definitely-not-a-block",
    });
    expect(next[0]).toEqual(block);
  });

  it("is a no-op when the source id isn't found", () => {
    const block = seedRichText();
    const next = apply([block], {
      type: "REPLACE_TYPE",
      id: "missing-id",
      newType: "cta",
    });
    expect(next[0]).toEqual(block);
  });

  it("preserves children when both old and new types accept them", () => {
    // Synthetic registry — `grid` is the only built-in container,
    // so to test the both-accept-children path we register a
    // second container alongside the defaults.
    const altContainerDef: NpBlockDefinition = {
      type: "alt-container",
      label: "Alt Container",
      acceptsChildren: true,
      defaultProps: {},
      propsSchema: [],
      render: () => <div />,
    };
    const localReducer = createEditorReducer([...defaults, altContainerDef]);
    const childDef = byType.get("rich-text") as NpBlockDefinition;
    const child = createBlockInstance(childDef);
    const gridDef = byType.get("grid") as NpBlockDefinition;
    const grid: NpBlockInstance = {
      ...createBlockInstance(gridDef),
      children: [child],
    };
    const next = localReducer([grid], {
      type: "REPLACE_TYPE",
      id: grid.id,
      newType: "alt-container",
    });
    expect(next[0].type).toBe("alt-container");
    expect(next[0].children).toHaveLength(1);
    expect(next[0].children?.[0].id).toBe(child.id);
  });

  it("drops children when the target type doesn't accept them", () => {
    const childDef = byType.get("rich-text") as NpBlockDefinition;
    const child = createBlockInstance(childDef);
    const gridDef = byType.get("grid") as NpBlockDefinition;
    const grid: NpBlockInstance = {
      ...createBlockInstance(gridDef),
      children: [child],
    };
    const next = apply([grid], {
      type: "REPLACE_TYPE",
      id: grid.id,
      newType: "cta",
    });
    expect(next[0].type).toBe("cta");
    expect(next[0].children).toBeUndefined();
  });

  it("rejects when the parent's allowedChildTypes excludes the new type", () => {
    // Synthetic strict container — built-ins don't currently set
    // `allowedChildTypes`, so we pin one for the contract check.
    const strictContainerDef: NpBlockDefinition = {
      type: "strict-container",
      label: "Strict",
      acceptsChildren: true,
      allowedChildTypes: ["rich-text"],
      defaultProps: {},
      propsSchema: [],
      render: () => <div />,
    };
    const localReducer = createEditorReducer([...defaults, strictContainerDef]);
    const richDef = byType.get("rich-text") as NpBlockDefinition;
    const richChild = createBlockInstance(richDef);
    const container: NpBlockInstance = {
      id: "strict-1",
      type: "strict-container",
      props: {},
      children: [richChild],
    };
    const next = localReducer([container], {
      type: "REPLACE_TYPE",
      id: richChild.id,
      newType: "cta",
    });
    // No-op: the child stays a rich-text block, not converted.
    expect(next[0].children?.[0].type).toBe("rich-text");
    expect(next[0].children?.[0].id).toBe(richChild.id);
  });
});
