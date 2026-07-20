import type { NpCommentListItemWire } from "@nexpress/core/community-contract";

export interface NpCommentTreeNode {
  comment: NpCommentListItemWire;
  children: NpCommentTreeNode[];
  /** The parent exists outside this response window or the relation is malformed. */
  detached: boolean;
}

function hasParentCycle(
  comment: NpCommentListItemWire,
  nodes: ReadonlyMap<string, NpCommentTreeNode>,
): boolean {
  const visited = new Set([comment.id]);
  let parentId = comment.parentId;
  while (parentId) {
    if (visited.has(parentId)) return true;
    visited.add(parentId);
    parentId = nodes.get(parentId)?.comment.parentId ?? null;
  }
  return false;
}

/**
 * Builds the visible portion of a comment tree while preserving API order for
 * roots and siblings. Offset pagination can place a reply in a different
 * window from its parent; those rows remain renderable as detached roots.
 * Corrupt self/cyclic parent links also fail closed as detached roots instead
 * of recursing forever in the browser.
 */
export function npBuildCommentTree(
  comments: readonly NpCommentListItemWire[],
): NpCommentTreeNode[] {
  const nodes = new Map<string, NpCommentTreeNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { comment, children: [], detached: false });
  }

  const roots: NpCommentTreeNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parent = comment.parentId ? nodes.get(comment.parentId) : undefined;
    if (!comment.parentId) {
      roots.push(node);
    } else if (!parent || hasParentCycle(comment, nodes)) {
      node.detached = true;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}
