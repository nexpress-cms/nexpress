import { describe, expect, it } from "vitest";
import { getDefaultBlocks, type NpBlockDefinition, type NpBlockInstance } from "@nexpress/blocks";

// Engine reducer + factory — deep-imported because the public
// `@nexpress/admin` exports only surface UI components today. The
// editor engine is intentionally UI-agnostic; reaching in through
// the source path keeps the engine internal while still letting
// the unit suite cover its contract.
import {
  createBlockInstance,
  createEditorReducer,
} from "../../../packages/admin/src/blocks/editor-engine/reducer.js";
import {
  countBlockTreeWords,
  estimateReadingMinutes,
} from "../../../packages/admin/src/blocks/editor-engine/text-metrics.js";
import type { EditorAction } from "../../../packages/admin/src/blocks/editor-engine/types.js";
import {
  filterSlashMenuDefinitions,
  SLASH_MENU_LIMIT,
} from "../../../packages/admin/src/blocks/in-page-editor/quick-insert-bar.js";

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
const byType = new Map<string, NpBlockDefinition>(defaults.map((d) => [d.type, d]));

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
  const apply = (state: NpBlockInstance[], action: EditorAction): NpBlockInstance[] =>
    reducer(state, action);

  const seedRichText = (overrides: Partial<NpBlockInstance> = {}): NpBlockInstance => {
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

describe("editor reducer — ADD/INSERT initial props override", () => {
  // The DocCanvas plain-text → rich-text shortcut threads the
  // Lexical body through ADD's optional `props` slot so the new
  // block lands fully populated in one dispatch (no post-add
  // hydration race). These cases pin that contract.
  const reducer = createEditorReducer(defaults);

  it("ADD merges `props` over the definition's defaults", () => {
    const sentinel = { __test__: "value" } as const;
    const next = reducer([], {
      type: "ADD",
      blockType: "rich-text",
      props: sentinel,
    });
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe("rich-text");
    // Override merged shallow on top of defaults.
    expect((next[0].props as { __test__?: string }).__test__).toBe("value");
  });

  it("ADD without `props` keeps definition defaults intact", () => {
    const next = reducer([], { type: "ADD", blockType: "rich-text" });
    expect(next[0].props).toBeDefined();
    expect((next[0].props as { __test__?: string }).__test__).toBeUndefined();
  });

  it("INSERT_AFTER honors initial props slot too", () => {
    const seedDef = byType.get("rich-text") as NpBlockDefinition;
    const seed = { ...createBlockInstance(seedDef), id: "seed" };
    const next = reducer([seed], {
      type: "INSERT_AFTER",
      targetId: "seed",
      blockType: "rich-text",
      props: { __test__: "after" },
    });
    expect(next).toHaveLength(2);
    expect((next[1].props as { __test__?: string }).__test__).toBe("after");
  });
});

describe("editor reducer — MOVE_WITHIN_PARENT side semantics", () => {
  // The DocCanvas drag-shield needs the reducer's outcome to match
  // the visual drop indicator (top-bar = before, bottom-bar = after)
  // regardless of drag direction. These cases pin that contract.
  const reducer = createEditorReducer(defaults);
  const seed = (count: number): NpBlockInstance[] => {
    const def = byType.get("rich-text") as NpBlockDefinition;
    return Array.from({ length: count }, (_, i) => ({
      ...createBlockInstance(def),
      id: `b${i}`,
    }));
  };
  const ids = (state: NpBlockInstance[]) => state.map((b) => b.id);

  it('side: "before" forward drag — source lands above target', () => {
    // [b0, b1, b2, b3], drag b0 onto b2 with side=before → [b1, b0, b2, b3]
    const next = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b0",
      toId: "b2",
      side: "before",
    });
    expect(ids(next)).toEqual(["b1", "b0", "b2", "b3"]);
  });

  it('side: "before" backward drag — source lands above target', () => {
    // [b0, b1, b2, b3], drag b3 onto b1 with side=before → [b0, b3, b1, b2]
    const next = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b3",
      toId: "b1",
      side: "before",
    });
    expect(ids(next)).toEqual(["b0", "b3", "b1", "b2"]);
  });

  it('side: "after" forward drag — source lands below target', () => {
    // [b0, b1, b2, b3], drag b0 onto b2 with side=after → [b1, b2, b0, b3]
    const next = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b0",
      toId: "b2",
      side: "after",
    });
    expect(ids(next)).toEqual(["b1", "b2", "b0", "b3"]);
  });

  it('side: "after" backward drag — source lands below target', () => {
    // [b0, b1, b2, b3], drag b3 onto b1 with side=after → [b0, b1, b3, b2]
    const next = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b3",
      toId: "b1",
      side: "after",
    });
    expect(ids(next)).toEqual(["b0", "b1", "b3", "b2"]);
  });

  it("no `side` keeps legacy arrayMove (dnd-kit) behavior", () => {
    // [b0, b1, b2, b3], drag b0 onto b2 (no side) → [b1, b2, b0, b3]
    // (arrayMove asymmetry — same as side:"after" for forward drag)
    const forward = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b0",
      toId: "b2",
    });
    expect(ids(forward)).toEqual(["b1", "b2", "b0", "b3"]);

    // Backward — drag b3 onto b1 (no side) → [b0, b3, b1, b2]
    // (same as side:"before" for backward drag)
    const backward = reducer(seed(4), {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "b3",
      toId: "b1",
    });
    expect(ids(backward)).toEqual(["b0", "b3", "b1", "b2"]);
  });
});

describe("QuickInsertBar — filterSlashMenuDefinitions", () => {
  // The pure filter that the slash menu wraps. Component-level
  // testing (keyboard nav, dispatch) needs jsdom + Testing Library
  // which the unit suite doesn't host today; the filter is the
  // testable core, so cover it directly.
  const corpus: NpBlockDefinition[] = [
    {
      type: "rich-text",
      label: "Rich Text",
      keywords: ["paragraph", "prose"],
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    },
    {
      type: "hero",
      label: "Hero",
      keywords: ["banner", "headline"],
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    },
    {
      type: "feature-grid",
      label: "Feature Grid",
      keywords: ["features", "cards"],
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    },
    {
      // No `keywords`, no `label` — falls back to `type` for both
      // displayed label AND search corpus.
      type: "divider",
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    },
  ];

  it("returns the first SLASH_MENU_LIMIT entries when query is empty", () => {
    // Synthesize a corpus larger than the cap so we can verify the
    // slice. Identity / order doesn't matter, only the cap.
    const big: NpBlockDefinition[] = Array.from({ length: SLASH_MENU_LIMIT + 5 }, (_, i) => ({
      type: `b${i}`,
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    }));
    const result = filterSlashMenuDefinitions(big, "");
    expect(result).toHaveLength(SLASH_MENU_LIMIT);
    expect(result[0].type).toBe("b0");
  });

  it("matches by label substring (case-insensitive)", () => {
    const result = filterSlashMenuDefinitions(corpus, "feat");
    expect(result.map((d) => d.type)).toEqual(["feature-grid"]);
  });

  it("matches by type substring", () => {
    const result = filterSlashMenuDefinitions(corpus, "rich");
    expect(result.map((d) => d.type)).toEqual(["rich-text"]);
  });

  it("matches by keyword substring", () => {
    const result = filterSlashMenuDefinitions(corpus, "banner");
    expect(result.map((d) => d.type)).toEqual(["hero"]);
  });

  it("falls back to type when label is missing (divider has no label)", () => {
    const result = filterSlashMenuDefinitions(corpus, "div");
    expect(result.map((d) => d.type)).toEqual(["divider"]);
  });

  it("returns an empty list when nothing matches", () => {
    const result = filterSlashMenuDefinitions(corpus, "nonexistent");
    expect(result).toEqual([]);
  });

  it("caps results at SLASH_MENU_LIMIT even with a matching query", () => {
    // Build corpus where every entry matches "x" — verifies the cap
    // applies AFTER filtering, not just on the no-query branch.
    const big: NpBlockDefinition[] = Array.from({ length: SLASH_MENU_LIMIT + 8 }, (_, i) => ({
      type: `xb${i}`,
      defaultProps: {},
      propsSchema: [],
      render: () => null,
    }));
    const result = filterSlashMenuDefinitions(big, "x");
    expect(result).toHaveLength(SLASH_MENU_LIMIT);
  });
});

describe("Document mode text metrics", () => {
  it("counts words from rich-text Lexical content", () => {
    const block: NpBlockInstance = {
      id: "rich-1",
      type: "rich-text",
      props: {
        content: {
          root: {
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "text", text: "Hello document" },
                  { type: "text", text: "mode" },
                ],
              },
              {
                type: "heading",
                children: [{ type: "text", text: "Preview status" }],
              },
            ],
          },
        },
      },
    };

    expect(countBlockTreeWords([block])).toBe(5);
  });

  it("counts structural text props and nested children", () => {
    const tree: NpBlockInstance[] = [
      {
        id: "hero-1",
        type: "hero",
        props: {
          heading: "Launch faster",
          items: ["Docs", "Preview polish"],
        },
        children: [
          {
            id: "caption-1",
            type: "rich-text",
            props: { caption: "Nested copy" },
          },
        ],
      },
    ];

    expect(countBlockTreeWords(tree)).toBe(7);
  });

  it("ignores malformed content safely", () => {
    const block: NpBlockInstance = {
      id: "empty-1",
      type: "rich-text",
      props: { content: { root: { children: [{ type: "paragraph" }] } } },
    };

    expect(countBlockTreeWords([block])).toBe(0);
    expect(estimateReadingMinutes(0)).toBe(1);
  });
});
