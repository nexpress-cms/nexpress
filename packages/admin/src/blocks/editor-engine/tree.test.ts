import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { NpBlockInstance } from "@nexpress/blocks";

import {
  arrayMove,
  cloneBlockDeep,
  createBlockId,
  detachBlock,
  filterTree,
  findBlockInTreeFlat,
  isDescendantOf,
  locateBlock,
  mapTree,
  updateContainerChildren,
} from "./tree.js";

// Compact builders so test bodies stay focused on the tree shape
// rather than NpBlockInstance boilerplate.
const block = (
  id: string,
  type: string,
  children?: NpBlockInstance[],
): NpBlockInstance => ({
  id,
  type,
  props: {},
  ...(children !== undefined ? { children } : {}),
});

describe("createBlockId", () => {
  it("returns a UUID-shaped string", () => {
    const id = createBlockId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("returns a fresh value on every call", () => {
    const a = createBlockId();
    const b = createBlockId();
    expect(a).not.toBe(b);
  });
});

describe("arrayMove", () => {
  it("moves an item from one index to another without mutating the input", () => {
    const arr = [1, 2, 3, 4];
    const out = arrayMove(arr, 0, 2);
    expect(out).toEqual([2, 3, 1, 4]);
    expect(arr).toEqual([1, 2, 3, 4]); // input unchanged
  });

  it("returns a copy when from === to (no-op)", () => {
    const arr = [1, 2, 3];
    const out = arrayMove(arr, 1, 1);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(arr);
  });

  it("clamps `to` to the last valid index", () => {
    const arr = [1, 2, 3];
    const out = arrayMove(arr, 0, 99);
    expect(out).toEqual([2, 3, 1]);
  });

  it("returns a fresh copy when `from` is out of range", () => {
    const arr = [1, 2, 3];
    const out = arrayMove(arr, 99, 0);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(arr);
  });
});

describe("mapTree", () => {
  it("walks every block depth-first and applies the mapper", () => {
    const tree = [
      block("a", "row", [block("b", "para"), block("c", "para")]),
      block("d", "para"),
    ];
    const out = mapTree(tree, (b) => ({ ...b, type: b.type.toUpperCase() }));
    expect(out[0].type).toBe("ROW");
    expect(out[0].children?.[0].type).toBe("PARA");
    expect(out[0].children?.[1].type).toBe("PARA");
    expect(out[1].type).toBe("PARA");
  });

  it("preserves child INSTANCE identity when mapper is a no-op", () => {
    // mapTree's docstring claims "cheap immutability" via short-circuit
    // returns, but `Array.map` always allocates a fresh array, so the
    // children-array reference is NOT preserved across calls. Element
    // references ARE preserved when fn is identity. Documenting actual
    // behavior here so future changes to mapTree's optimization don't
    // silently regress this contract.
    const childA = block("b", "para");
    const childB = block("c", "para");
    const tree = [block("a", "row", [childA, childB])];
    const out = mapTree(tree, (b) => b);
    expect(out[0].children![0]).toBe(childA);
    expect(out[0].children![1]).toBe(childB);
  });
});

describe("filterTree", () => {
  it("drops matching blocks at every level", () => {
    const tree = [
      block("a", "row", [block("b", "para"), block("c", "image")]),
      block("d", "image"),
    ];
    const out = filterTree(tree, (b) => b.type !== "image");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children![0].id).toBe("b");
  });

  it("dropped block takes its subtree with it (no orphan recursion)", () => {
    const tree = [block("a", "row", [block("b", "para")])];
    // Filter the parent — children should not be retained.
    const out = filterTree(tree, (b) => b.id !== "a");
    expect(out).toHaveLength(0);
  });
});

describe("locateBlock", () => {
  it("locates a top-level block with parentId=null", () => {
    const tree = [block("a", "para"), block("b", "para")];
    expect(locateBlock(tree, "b")).toEqual({ parentId: null, index: 1 });
  });

  it("locates a nested block with the correct parentId", () => {
    const tree = [
      block("row", "row", [block("a", "para"), block("b", "para")]),
    ];
    expect(locateBlock(tree, "b")).toEqual({ parentId: "row", index: 1 });
  });

  it("returns null when the id isn't in the tree", () => {
    const tree = [block("a", "para")];
    expect(locateBlock(tree, "missing")).toBeNull();
  });
});

describe("updateContainerChildren", () => {
  it("mutates top-level when parentId=null", () => {
    const tree = [block("a", "para")];
    const out = updateContainerChildren(tree, null, (siblings) => [
      ...siblings,
      block("b", "para"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("b");
  });

  it("mutates the named container's children", () => {
    const tree = [block("row", "row", [block("a", "para")])];
    const out = updateContainerChildren(tree, "row", (siblings) => [
      ...siblings,
      block("b", "para"),
    ]);
    expect(out[0].children).toHaveLength(2);
    expect(out[0].children![1].id).toBe("b");
  });

  it("preserves identity of unchanged sibling lists (cheap immutability)", () => {
    const innerChildren = [block("a", "para")];
    const tree = [
      block("row", "row", innerChildren),
      block("solo", "para"),
    ];
    const out = updateContainerChildren(tree, "row", (siblings) => siblings);
    // The mutate function is identity, so the inner children array should
    // be reused. updateContainerChildren rebuilds the outer array though,
    // so we test the inner one specifically.
    expect(out[0].children).toBe(innerChildren);
  });
});

describe("cloneBlockDeep", () => {
  let counter = 0;

  beforeEach(() => {
    counter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-0000-0000-${String(counter++).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues a fresh id on the cloned root", () => {
    const src = block("orig", "para");
    const clone = cloneBlockDeep(src);
    expect(clone.id).not.toBe(src.id);
    expect(clone.type).toBe("para");
  });

  it("issues fresh ids on every nested descendant", () => {
    const src = block("root", "row", [
      block("child-a", "para"),
      block("child-b", "row", [block("grand", "para")]),
    ]);
    const clone = cloneBlockDeep(src);
    expect(clone.id).not.toBe("root");
    expect(clone.children?.[0].id).not.toBe("child-a");
    expect(clone.children?.[1].id).not.toBe("child-b");
    expect(clone.children?.[1].children?.[0].id).not.toBe("grand");
  });

  it("clones props by shallow copy (sufficient for editor's prop shape)", () => {
    const src = block("a", "para");
    src.props = { text: "hello" };
    const clone = cloneBlockDeep(src);
    expect(clone.props).toEqual({ text: "hello" });
    expect(clone.props).not.toBe(src.props);
  });

  it("clones children array (different reference)", () => {
    const src = block("a", "row", [block("b", "para")]);
    const clone = cloneBlockDeep(src);
    expect(clone.children).not.toBe(src.children);
  });
});

describe("findBlockInTreeFlat", () => {
  it("finds top-level blocks", () => {
    const tree = [block("a", "para"), block("b", "para")];
    expect(findBlockInTreeFlat(tree, "b")?.id).toBe("b");
  });

  it("finds nested blocks at any depth", () => {
    const tree = [
      block("row", "row", [block("inner", "row", [block("deep", "para")])]),
    ];
    expect(findBlockInTreeFlat(tree, "deep")?.id).toBe("deep");
  });

  it("returns null for missing ids", () => {
    expect(findBlockInTreeFlat([block("a", "para")], "missing")).toBeNull();
  });
});

describe("isDescendantOf", () => {
  const tree = [
    block("row", "row", [
      block("inner", "row", [block("deep", "para")]),
      block("sibling", "para"),
    ]),
    block("solo", "para"),
  ];

  it("reports true for direct children", () => {
    expect(isDescendantOf(tree, "inner", "row")).toBe(true);
    expect(isDescendantOf(tree, "sibling", "row")).toBe(true);
  });

  it("reports true for transitive descendants", () => {
    expect(isDescendantOf(tree, "deep", "row")).toBe(true);
  });

  it("reports false when the candidate isn't in the ancestor's subtree", () => {
    expect(isDescendantOf(tree, "solo", "row")).toBe(false);
    expect(isDescendantOf(tree, "deep", "sibling")).toBe(false);
  });

  it("reports false when the ancestor doesn't exist", () => {
    expect(isDescendantOf(tree, "deep", "nonexistent")).toBe(false);
  });
});

describe("detachBlock", () => {
  it("removes the block and returns it", () => {
    const tree = [
      block("row", "row", [block("a", "para"), block("b", "para")]),
    ];
    const result = detachBlock(tree, "a");
    expect(result).not.toBeNull();
    expect(result!.removed.id).toBe("a");
    expect(result!.tree[0].children).toHaveLength(1);
    expect(result!.tree[0].children![0].id).toBe("b");
  });

  it("removes the block's entire subtree", () => {
    const tree = [
      block("row", "row", [block("inner", "row", [block("deep", "para")])]),
    ];
    const result = detachBlock(tree, "inner");
    expect(result!.removed.children?.[0].id).toBe("deep");
    expect(result!.tree[0].children).toHaveLength(0);
  });

  it("returns null when the id isn't found", () => {
    const tree = [block("a", "para")];
    expect(detachBlock(tree, "missing")).toBeNull();
  });
});
