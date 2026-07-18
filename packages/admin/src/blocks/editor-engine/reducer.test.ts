import { describe, expect, it } from "vitest";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { createEditorReducer, createBlockInstance } from "./reducer.js";

// Compact builders.
const def = (type: string, overrides: Partial<NpBlockMetadata> = {}): NpBlockMetadata => ({
  type,
  label: type,
  defaultProps: {},
  propsSchema: [],
  ...overrides,
});
const block = (
  id: string,
  type: string,
  children?: NpBlockInstance[],
  props: Record<string, unknown> = {},
): NpBlockInstance => ({
  id,
  type,
  props,
  ...(children !== undefined ? { children } : {}),
});

// Fixture registry. `row` accepts everything, `grid` caps at 3 of any
// type, `pricing-tiers` only accepts `pricing-tier`. Atoms are
// childless. Most tests reuse this; specific tests build their own
// when they need different contracts.
const fixtureDefs: NpBlockMetadata[] = [
  def("row", { acceptsChildren: true }),
  def("grid", { acceptsChildren: true, maxChildren: 3 }),
  def("pricing-tiers", {
    acceptsChildren: true,
    allowedChildTypes: ["pricing-tier"],
  }),
  def("pricing-tier", {}),
  def("paragraph", {
    defaultProps: { text: "" },
    propsSchema: [{ name: "text", type: "text", translatable: true, label: "Text" }],
  }),
  def("heading", {
    defaultProps: { text: "" },
    propsSchema: [{ name: "text", type: "text", translatable: true, label: "Text" }],
  }),
  def("image", {
    defaultProps: { caption: "" },
    propsSchema: [{ name: "caption", type: "text", translatable: true, label: "Caption" }],
  }),
];

const reducer = createEditorReducer(fixtureDefs);

describe("createBlockInstance", () => {
  it("seeds props from defaultProps", () => {
    const meta = def("paragraph", { defaultProps: { text: "hello" } });
    const inst = createBlockInstance(meta);
    expect(inst.type).toBe("paragraph");
    expect(inst.props).toEqual({ text: "hello" });
    expect(inst.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("seeds an empty children[] when acceptsChildren=true", () => {
    const meta = def("row", { acceptsChildren: true });
    const inst = createBlockInstance(meta);
    expect(inst.children).toEqual([]);
  });

  it("omits children entirely when acceptsChildren is unset", () => {
    const meta = def("paragraph");
    const inst = createBlockInstance(meta);
    expect(inst.children).toBeUndefined();
  });
});

describe("reducer — RESET", () => {
  it("replaces the entire tree", () => {
    const next = [block("a", "paragraph")];
    const out = reducer([block("z", "heading")], { type: "RESET", blocks: next });
    expect(out).toBe(next);
  });
});

describe("reducer — ADD", () => {
  it("appends a top-level block", () => {
    const out = reducer([], { type: "ADD", blockType: "paragraph" });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("paragraph");
  });

  it("returns state unchanged when the type is unknown", () => {
    const state = [block("a", "paragraph")];
    const out = reducer(state, { type: "ADD", blockType: "no-such-type" });
    expect(out).toBe(state);
  });

  it("appends inside a container when parentId is given", () => {
    const state = [block("row", "row", [])];
    const out = reducer(state, {
      type: "ADD",
      blockType: "paragraph",
      parentId: "row",
    });
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].type).toBe("paragraph");
  });

  it("rejects when parent's allowedChildTypes excludes the type", () => {
    const state = [block("tiers", "pricing-tiers", [])];
    const out = reducer(state, {
      type: "ADD",
      blockType: "paragraph",
      parentId: "tiers",
    });
    // No-op — children unchanged.
    expect(out[0].children).toEqual([]);
  });

  it("rejects when parent is at maxChildren", () => {
    const filled = [block("a", "paragraph"), block("b", "paragraph"), block("c", "paragraph")];
    const state = [block("grid", "grid", filled)];
    const out = reducer(state, {
      type: "ADD",
      blockType: "paragraph",
      parentId: "grid",
    });
    expect(out[0].children).toHaveLength(3);
  });

  it("merges custom props into defaults", () => {
    const out = reducer([], {
      type: "ADD",
      blockType: "paragraph",
      props: { text: "custom" },
    });
    expect(out[0].props).toEqual({ text: "custom" });
  });
});

describe("reducer — INSERT_BEFORE / INSERT_AFTER", () => {
  it("INSERT_AFTER places the new block after the target", () => {
    const state = [block("a", "paragraph"), block("c", "paragraph")];
    const out = reducer(state, {
      type: "INSERT_AFTER",
      targetId: "a",
      blockType: "paragraph",
    });
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe("a");
    expect(out[2].id).toBe("c");
  });

  it("INSERT_BEFORE places the new block before the target", () => {
    const state = [block("a", "paragraph"), block("c", "paragraph")];
    const out = reducer(state, {
      type: "INSERT_BEFORE",
      targetId: "c",
      blockType: "paragraph",
    });
    expect(out).toHaveLength(3);
    expect(out[2].id).toBe("c");
  });

  it("rejects insertion when parent's contract excludes the type", () => {
    const state = [block("tiers", "pricing-tiers", [block("t1", "pricing-tier")])];
    const out = reducer(state, {
      type: "INSERT_AFTER",
      targetId: "t1",
      blockType: "paragraph",
    });
    expect(out[0].children).toHaveLength(1);
  });
});

describe("reducer — DELETE", () => {
  it("removes the targeted block from anywhere in the tree", () => {
    const state = [block("row", "row", [block("a", "paragraph"), block("b", "paragraph")])];
    const out = reducer(state, { type: "DELETE", id: "a" });
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("b");
  });
});

describe("reducer — DUPLICATE (contract gate, #523)", () => {
  it("inserts a fresh-id clone after the source", () => {
    const state = [block("a", "paragraph", undefined, { text: "hi" })];
    const out = reducer(state, { type: "DUPLICATE", id: "a" });
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("a");
    expect(out[1].id).not.toBe("a");
    expect(out[1].props).toEqual({ text: "hi" });
  });

  it("rejects duplication that would push parent past maxChildren", () => {
    // grid maxChildren=3; already at 3, duplicating any child would
    // push to 4. Must no-op.
    const filled = [block("a", "paragraph"), block("b", "paragraph"), block("c", "paragraph")];
    const state = [block("grid", "grid", filled)];
    const out = reducer(state, { type: "DUPLICATE", id: "b" });
    expect(out[0].children).toHaveLength(3);
  });

  it("allows duplication when parent has cap headroom", () => {
    // grid maxChildren=3, currently has 2 — duplicate should fit.
    const state = [block("grid", "grid", [block("a", "paragraph"), block("b", "paragraph")])];
    const out = reducer(state, { type: "DUPLICATE", id: "a" });
    expect(out[0].children).toHaveLength(3);
  });

  it("top-level duplication has no contract (parentId=null skips check)", () => {
    const state = [block("a", "paragraph")];
    const out = reducer(state, { type: "DUPLICATE", id: "a" });
    expect(out).toHaveLength(2);
  });
});

describe("reducer — MOVE_WITHIN_PARENT", () => {
  // dnd-kit's drop handler is the primary caller. The `side`
  // argument lets a drag-shield (DocCanvas) pin the visual drop bar
  // to the top vs bottom of the target row regardless of drag
  // direction. The reducer code has detailed comments about why
  // splice(from)+splice(to) needs the side adjustment.

  it("plain reorder (no side) uses arrayMove semantics", () => {
    const state = [block("a", "p"), block("b", "p"), block("c", "p")];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "a",
      toId: "c",
    });
    // arrayMove(0, 2) → [b, c, a]
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("side='before' on forward drag drops one position earlier", () => {
    // Dragging `a` (index 0) toward `c` (index 2), pinned to the
    // BEFORE edge of c. With the side adjustment, lands at index 1
    // (just before c). Without it, naive arrayMove would land at 2
    // (after c, where c was).
    const state = [block("a", "p"), block("b", "p"), block("c", "p")];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "a",
      toId: "c",
      side: "before",
    });
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("side='after' on backward drag drops one position later", () => {
    // Dragging `c` (index 2) toward `a` (index 0), pinned to the
    // AFTER edge of a. With the side adjustment, lands at index 1
    // (just after a). Without it, lands at 0 (before a).
    const state = [block("a", "p"), block("b", "p"), block("c", "p")];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "c",
      toId: "a",
      side: "after",
    });
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("from==to is a no-op", () => {
    const state = [block("a", "p"), block("b", "p")];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "a",
      toId: "a",
    });
    // Sibling list returned by mutate is the same reference; outer
    // map still allocates a new array but content is identical.
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("operates on the named container's children", () => {
    const state = [block("row", "row", [block("a", "p"), block("b", "p"), block("c", "p")])];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: "row",
      fromId: "a",
      toId: "c",
    });
    expect(out[0].children!.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("missing fromId/toId returns siblings unchanged", () => {
    const state = [block("a", "p"), block("b", "p")];
    const out = reducer(state, {
      type: "MOVE_WITHIN_PARENT",
      parentId: null,
      fromId: "missing",
      toId: "a",
    });
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("reducer — MOVE_UP / MOVE_DOWN", () => {
  it("MOVE_UP swaps with the previous sibling", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph")];
    const out = reducer(state, { type: "MOVE_UP", id: "b" });
    expect(out[0].id).toBe("b");
    expect(out[1].id).toBe("a");
  });

  it("MOVE_UP at index 0 is a no-op", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph")];
    const out = reducer(state, { type: "MOVE_UP", id: "a" });
    expect(out).toBe(state);
  });

  it("MOVE_DOWN at last index leaves the tree unchanged", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph")];
    const out = reducer(state, { type: "MOVE_DOWN", id: "b" });
    // Tree itself is unchanged — same ids in same order.
    expect(out.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("reducer — MOVE_INTO", () => {
  it("rejects move-into-self", () => {
    const state = [block("row", "row", [])];
    const out = reducer(state, {
      type: "MOVE_INTO",
      id: "row",
      targetParentId: "row",
    });
    expect(out).toBe(state);
  });

  it("rejects move-into-descendant (would create a cycle)", () => {
    const state = [block("outer", "row", [block("inner", "row", [])])];
    const out = reducer(state, {
      type: "MOVE_INTO",
      id: "outer",
      targetParentId: "inner",
    });
    expect(out).toBe(state);
  });

  it("rejects move into a non-container target", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph")];
    const out = reducer(state, {
      type: "MOVE_INTO",
      id: "a",
      targetParentId: "b",
    });
    expect(out).toBe(state);
  });

  it("rejects when target's allowedChildTypes excludes the source type", () => {
    const state = [block("p", "paragraph"), block("tiers", "pricing-tiers", [])];
    const out = reducer(state, {
      type: "MOVE_INTO",
      id: "p",
      targetParentId: "tiers",
    });
    expect(out).toBe(state);
  });

  it("detaches and re-appends inside the target", () => {
    const state = [block("p", "paragraph"), block("row", "row", [])];
    const out = reducer(state, {
      type: "MOVE_INTO",
      id: "p",
      targetParentId: "row",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("row");
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("p");
  });
});

describe("reducer — MOVE_OUT (grandparent contract gate, #523)", () => {
  it("promotes a child one level up into its grandparent", () => {
    const state = [block("outer", "row", [block("middle", "row", [block("inner", "paragraph")])])];
    const out = reducer(state, { type: "MOVE_OUT", id: "inner" });
    // After: outer contains [middle, inner] with middle empty.
    expect(out[0].children).toHaveLength(2);
    expect(out[0].children![0].id).toBe("middle");
    expect(out[0].children![0].children).toHaveLength(0);
    expect(out[0].children![1].id).toBe("inner");
  });

  it("at top-level (no grandparent) is a no-op", () => {
    const state = [block("a", "paragraph")];
    const out = reducer(state, { type: "MOVE_OUT", id: "a" });
    expect(out).toBe(state);
  });

  it("rejects when grandparent's allowedChildTypes excludes the source type", () => {
    // outer only accepts pricing-tier; promoting a paragraph from inside
    // the middle would violate that contract.
    const state = [
      block("outer", "pricing-tiers", [block("middle", "pricing-tier", [block("p", "paragraph")])]),
    ];
    // pricing-tier itself isn't acceptsChildren in fixtureDefs, so build
    // a custom registry where it is.
    const customDefs = [
      def("pricing-tiers", {
        acceptsChildren: true,
        allowedChildTypes: ["pricing-tier"],
      }),
      def("pricing-tier", { acceptsChildren: true }),
      def("paragraph"),
    ];
    const customReducer = createEditorReducer(customDefs);
    const out = customReducer(state, { type: "MOVE_OUT", id: "p" });
    expect(out).toBe(state);
  });

  it("rejects when grandparent is at maxChildren", () => {
    // outer is grid (max 3) with 3 children including the middle row;
    // promoting from middle would push to 4.
    const state = [
      block("outer", "grid", [
        block("middle", "row", [block("p", "paragraph")]),
        block("a", "paragraph"),
        block("b", "paragraph"),
      ]),
    ];
    const out = reducer(state, { type: "MOVE_OUT", id: "p" });
    expect(out).toBe(state);
  });
});

describe("reducer — WRAP_IN", () => {
  it("wraps a top-level block in a container", () => {
    const state = [block("a", "paragraph", undefined, { text: "hi" })];
    const out = reducer(state, {
      type: "WRAP_IN",
      id: "a",
      containerType: "row",
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("row");
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("a");
  });

  it("rejects when the wrapper's contract excludes the source type", () => {
    const state = [block("p", "paragraph")];
    const out = reducer(state, {
      type: "WRAP_IN",
      id: "p",
      containerType: "pricing-tiers",
    });
    expect(out).toBe(state);
  });

  it("rejects when the wrapper isn't a container", () => {
    const state = [block("p", "paragraph")];
    const out = reducer(state, {
      type: "WRAP_IN",
      id: "p",
      containerType: "image",
    });
    expect(out).toBe(state);
  });

  it("wraps a nested block without infinite-recursing (regression for the mapTree bug)", () => {
    // Pinning the nested-context fix: locateBlock+updateContainerChildren
    // performs the substitution at the source's depth, never visiting
    // the wrapper's child during the walk. Top-level case lives in the
    // first WRAP_IN test; this one verifies the same fix holds when
    // the source lives one level down.
    const state = [block("outer", "row", [block("p", "paragraph", undefined, { text: "hi" })])];
    const out = reducer(state, {
      type: "WRAP_IN",
      id: "p",
      containerType: "row",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("outer");
    // outer.children replaced its lone child with a row wrapping p.
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].type).toBe("row");
    expect(out[0].children![0].children).toHaveLength(1);
    expect(out[0].children![0].children![0].id).toBe("p");
    expect(out[0].children![0].children![0].props).toEqual({ text: "hi" });
  });
});

describe("reducer — INSERT_PATTERN", () => {
  const pattern = {
    id: "test-pattern",
    label: "Test pattern",
    source: "built-in" as const,
    blocks: [block("p1", "paragraph"), block("p2", "paragraph"), block("p3", "paragraph")],
  };

  it("inserts every pattern block at top level", () => {
    const out = reducer([], { type: "INSERT_PATTERN", pattern });
    expect(out).toHaveLength(3);
    // Fresh ids — pattern block IDs are NOT preserved.
    expect(out[0].id).not.toBe("p1");
  });

  it("filters unknown types from the pattern", () => {
    const mixed = {
      id: "mixed",
      label: "Mixed",
      source: "built-in" as const,
      blocks: [block("p1", "paragraph"), block("u1", "no-such-type")],
    };
    const out = reducer([], { type: "INSERT_PATTERN", pattern: mixed });
    expect(out).toHaveLength(1);
  });

  it("respects parent contract — truncates a pattern that would overflow maxChildren", () => {
    // grid maxChildren=3; 3-block pattern into already-occupied grid (1
    // child) → 2 of the 3 fit, third dropped.
    const state = [block("grid", "grid", [block("a", "paragraph")])];
    const out = reducer(state, {
      type: "INSERT_PATTERN",
      pattern,
      parentId: "grid",
    });
    expect(out[0].children).toHaveLength(3);
  });

  it("respects parent contract — drops blocks not in allowedChildTypes", () => {
    const state = [block("tiers", "pricing-tiers", [])];
    const out = reducer(state, {
      type: "INSERT_PATTERN",
      pattern,
      parentId: "tiers",
    });
    // None of the pattern's paragraphs are pricing-tier — all rejected.
    expect(out).toBe(state);
  });
});

describe("reducer — DELETE_MANY / DUPLICATE_MANY (#523)", () => {
  it("DELETE_MANY removes every targeted id", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph"), block("c", "paragraph")];
    const out = reducer(state, { type: "DELETE_MANY", ids: ["a", "c"] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
  });

  it("DUPLICATE_MANY emits a clone after each selection", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph")];
    const out = reducer(state, { type: "DUPLICATE_MANY", ids: ["a", "b"] });
    expect(out).toHaveLength(4);
    expect(out[0].id).toBe("a");
    expect(out[2].id).toBe("b");
  });

  it("DUPLICATE_MANY drops descendants whose ancestor is also selected (no double-clone)", () => {
    // Selecting both `outer` and `inner`: cloning outer already brings
    // inner along; cloning inner separately would multiply 4× the
    // descendant. Filter ensures only outer (the highest in the
    // selection) duplicates.
    const state = [block("outer", "row", [block("inner", "paragraph")])];
    const out = reducer(state, {
      type: "DUPLICATE_MANY",
      ids: ["outer", "inner"],
    });
    // Two top-level rows — original + clone. Each contains exactly 1
    // inner.
    expect(out).toHaveLength(2);
    expect(out[0].children).toHaveLength(1);
    expect(out[1].children).toHaveLength(1);
  });

  it("DUPLICATE_MANY skips clones that would push parent past maxChildren", () => {
    // grid max=3, currently 2 children both selected. One can fit, the
    // other is dropped.
    const state = [block("grid", "grid", [block("a", "paragraph"), block("b", "paragraph")])];
    const out = reducer(state, {
      type: "DUPLICATE_MANY",
      ids: ["a", "b"],
    });
    expect(out[0].children).toHaveLength(3);
  });
});

describe("reducer — UPDATE_PROPS / REPLACE_PROPS", () => {
  it("UPDATE_PROPS merges into existing props", () => {
    const state = [block("a", "paragraph", undefined, { text: "old", extra: 1 })];
    const out = reducer(state, {
      type: "UPDATE_PROPS",
      id: "a",
      props: { text: "new" },
    });
    expect(out[0].props).toEqual({ text: "new", extra: 1 });
  });

  it("REPLACE_PROPS replaces wholesale", () => {
    const state = [block("a", "paragraph", undefined, { text: "old", extra: 1 })];
    const out = reducer(state, {
      type: "REPLACE_PROPS",
      id: "a",
      props: { text: "new" },
    });
    expect(out[0].props).toEqual({ text: "new" });
    expect(out[0].props.extra).toBeUndefined();
  });
});

describe("reducer — UPDATE_LAYOUT", () => {
  it("sets and removes layout without changing props", () => {
    const state = [block("a", "paragraph", undefined, { text: "hello" })];
    const withLayout = reducer(state, {
      type: "UPDATE_LAYOUT",
      id: "a",
      layout: { colSpan: 6, mdColSpan: 4 },
    });
    expect(withLayout[0]).toMatchObject({
      props: { text: "hello" },
      layout: { colSpan: 6, mdColSpan: 4 },
    });
    expect(withLayout[0].layout).not.toBe(state[0].layout);

    const withoutLayout = reducer(withLayout, { type: "UPDATE_LAYOUT", id: "a" });
    expect(withoutLayout[0].layout).toBeUndefined();
    expect(withoutLayout[0].props).toEqual({ text: "hello" });
  });
});

describe("reducer — REPLACE_TYPE (carried-children re-validation, #523)", () => {
  it("preserves the source's id", () => {
    const state = [block("a", "paragraph", undefined, { text: "hi" })];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "a",
      newType: "heading",
    });
    expect(out[0].id).toBe("a");
    expect(out[0].type).toBe("heading");
  });

  it("preserves parent-owned layout metadata", () => {
    const source = block("a", "paragraph", undefined, { text: "hi" });
    source.layout = { colSpan: 6, lgColSpan: 4 };
    const out = reducer([source], {
      type: "REPLACE_TYPE",
      id: "a",
      newType: "heading",
    });
    expect(out[0].layout).toEqual({ colSpan: 6, lgColSpan: 4 });
    expect(out[0].layout).not.toBe(source.layout);
  });

  it("carries primary text from paragraph to heading by default", () => {
    const state = [block("a", "paragraph", undefined, { text: "hi" })];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "a",
      newType: "heading",
    });
    expect(out[0].props.text).toBe("hi");
  });

  it("drops carried text when preserveText is false", () => {
    const state = [block("a", "paragraph", undefined, { text: "hi" })];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "a",
      newType: "heading",
      preserveText: false,
    });
    expect(out[0].props.text).toBe("");
  });

  it("drops children when the new type is not a container", () => {
    const state = [block("row", "row", [block("p", "paragraph")])];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "row",
      newType: "paragraph",
    });
    expect(out[0].children).toBeUndefined();
  });

  it("carries children forward when the new type is also a container", () => {
    const state = [block("row", "row", [block("p", "paragraph")])];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "row",
      newType: "grid",
    });
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("p");
  });

  it("drops carried children that don't fit the new container's contract", () => {
    // Source row has paragraph + heading. Replace with pricing-tiers
    // which only accepts pricing-tier — both children should drop.
    const state = [block("row", "row", [block("p", "paragraph"), block("h", "heading")])];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "row",
      newType: "pricing-tiers",
    });
    expect(out[0].children).toEqual([]);
  });

  it("preserves children that DO fit the new contract", () => {
    const state = [block("row", "row", [block("t1", "pricing-tier"), block("p", "paragraph")])];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "row",
      newType: "pricing-tiers",
    });
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("t1");
  });

  it("rejects when parent's contract excludes the new type", () => {
    // pricing-tiers parent accepts only pricing-tier; converting a
    // pricing-tier child into a paragraph would violate the parent.
    const state = [block("tiers", "pricing-tiers", [block("t", "pricing-tier")])];
    const out = reducer(state, {
      type: "REPLACE_TYPE",
      id: "t",
      newType: "paragraph",
    });
    expect(out).toBe(state);
  });
});

describe("reducer — WRAP_MANY", () => {
  it("wraps contiguous selection into a single container", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph"), block("c", "paragraph")];
    const out = reducer(state, {
      type: "WRAP_MANY",
      ids: ["a", "b"],
      containerType: "row",
    });
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("row");
    expect(out[0].children).toHaveLength(2);
  });

  it("rejects non-contiguous selection", () => {
    const state = [block("a", "paragraph"), block("b", "paragraph"), block("c", "paragraph")];
    const out = reducer(state, {
      type: "WRAP_MANY",
      ids: ["a", "c"],
      containerType: "row",
    });
    expect(out).toBe(state);
  });

  it("rejects when wrapper's contract excludes a child type", () => {
    const state = [block("p", "paragraph"), block("h", "heading")];
    const out = reducer(state, {
      type: "WRAP_MANY",
      ids: ["p", "h"],
      containerType: "pricing-tiers",
    });
    expect(out).toBe(state);
  });
});
