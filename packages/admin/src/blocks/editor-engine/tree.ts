import type { NpBlockInstance } from "@nexpress/blocks";

/**
 * Recursive tree helpers for the page-builder block tree. Pure
 * data — no React, no DOM. Lives in the engine so the in-page-
 * editor's mutation paths can use the same primitives the form
 * editor's reducer uses.
 *
 * Trees are tiny (handfuls of blocks per page) so straightforward
 * DFS beats threading a path through every action.
 */

declare const crypto: { randomUUID(): string };

/** Stable id generator for newly created block instances. */
export const createBlockId = (): string => crypto.randomUUID();

/**
 * `mapTree(blocks, fn)` walks every block depth-first and replaces
 * each one with `fn(block)`. Unchanged returns short-circuit so
 * children arrays don't get reallocated when nothing in their
 * subtree changed (cheap immutability).
 */
export function mapTree(
  blocks: NpBlockInstance[],
  fn: (block: NpBlockInstance) => NpBlockInstance,
): NpBlockInstance[] {
  return blocks.map((block) => {
    const next = fn(block);
    if (next.children) {
      const nextChildren = mapTree(next.children, fn);
      return nextChildren === next.children ? next : { ...next, children: nextChildren };
    }
    return next;
  });
}

/**
 * `filterTree(blocks, predicate)` keeps the matching blocks at
 * every level and recurses into the kept ones' children. Used by
 * DELETE / detach so a removed block takes its subtree with it
 * (the recursion only fires on retained blocks).
 */
export function filterTree(
  blocks: NpBlockInstance[],
  predicate: (block: NpBlockInstance) => boolean,
): NpBlockInstance[] {
  return blocks
    .filter(predicate)
    .map((block) =>
      block.children
        ? { ...block, children: filterTree(block.children, predicate) }
        : block,
    );
}

/**
 * Locates a block in the tree, returning the parent id (or `null`
 * for top-level) plus the index inside the parent's siblings.
 */
export function locateBlock(
  blocks: NpBlockInstance[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { parentId, index: i };
    const childMatch = blocks[i].children
      ? locateBlock(blocks[i].children!, id, blocks[i].id)
      : null;
    if (childMatch) return childMatch;
  }
  return null;
}

/**
 * Updates the children of a target container (or the top-level
 * when `parentId` is null) by running `mutate` over its current
 * sibling list.
 */
export function updateContainerChildren(
  blocks: NpBlockInstance[],
  parentId: string | null,
  mutate: (children: NpBlockInstance[]) => NpBlockInstance[],
): NpBlockInstance[] {
  if (parentId === null) return mutate(blocks);
  return blocks.map((block) => {
    if (block.id === parentId) {
      return { ...block, children: mutate(block.children ?? []) };
    }
    if (block.children) {
      const nextChildren = updateContainerChildren(block.children, parentId, mutate);
      return nextChildren === block.children ? block : { ...block, children: nextChildren };
    }
    return block;
  });
}

/**
 * Deep clone with fresh ids on every block in the subtree. Used
 * by `DUPLICATE` and `INSERT_PATTERN` so re-insertion never
 * collides with the source's id.
 */
export const cloneBlockDeep = (block: NpBlockInstance): NpBlockInstance => ({
  id: createBlockId(),
  type: block.type,
  props: { ...block.props },
  ...(block.children ? { children: block.children.map(cloneBlockDeep) } : {}),
});

/**
 * Flat tree-walk that returns the block instance with the given
 * id, anywhere in the tree.
 */
export function findBlockInTreeFlat(
  blocks: NpBlockInstance[],
  id: string,
): NpBlockInstance | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const found = findBlockInTreeFlat(b.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * True when `candidateId` lives inside the subtree rooted at
 * `ancestorId`. Used by `MOVE_INTO` to reject moves that would
 * create a cycle (move a block into its own descendant).
 */
export function isDescendantOf(
  blocks: NpBlockInstance[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const ancestor = findBlockInTreeFlat(blocks, ancestorId);
  if (!ancestor || !ancestor.children) return false;
  return findBlockInTreeFlat(ancestor.children, candidateId) !== null;
}

/**
 * Removes the block with `id` from anywhere in the tree, returning
 * the new tree plus the detached block. Returns null when the
 * block isn't found.
 */
export function detachBlock(
  blocks: NpBlockInstance[],
  id: string,
): { tree: NpBlockInstance[]; removed: NpBlockInstance } | null {
  const found = findBlockInTreeFlat(blocks, id);
  if (!found) return null;
  return {
    tree: filterTree(blocks, (b) => b.id !== id),
    removed: found,
  };
}
