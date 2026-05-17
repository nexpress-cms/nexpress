/**
 * Shared doc-tree assembly for the docs theme.
 *
 * Both the sidebar (a navigation tree) and the front-page landing
 * (a featured-children grid) need to walk a flat list of doc rows
 * and turn it into a parent → children tree, sorted by `order` at
 * every level. The two surfaces project different fields onto the
 * node (the sidebar doesn't need `lede`/`updatedAt`; the front
 * page does), so the build function is generic over the node
 * shape — callers pass a row-to-node mapper.
 *
 * Lives in `lib/` rather than alongside either surface so neither
 * is the "owner" — the function belongs to the docs theme as a
 * whole.
 */

/**
 * The minimal shape every node needs to participate in the tree
 * walk. Concrete callers extend this with whatever extra fields
 * the surface renders.
 */
export interface NpDocTreeNode<Self extends NpDocTreeNode<Self>> {
  id: string;
  parent: string | null;
  order: number;
  children: Self[];
}

/**
 * Builds a sorted tree of nodes from a flat list of rows.
 *
 * `toNode` returns the typed node for a row, or `null` to skip
 * the row (e.g. when required fields like `id` / `slug` are
 * malformed). The function preserves the order rows are mapped
 * in for the `byId` map's iteration but re-sorts every level by
 * `order` afterward.
 */
export function buildDocTree<N extends NpDocTreeNode<N>, R>(
  rows: R[],
  toNode: (row: R) => N | null,
): N[] {
  const byId = new Map<string, N>();
  for (const row of rows) {
    const node = toNode(row);
    if (node) byId.set(node.id, node);
  }
  const roots: N[] = [];
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent)) {
      byId.get(node.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortLevel = (list: N[]) => {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortLevel(n.children);
  };
  sortLevel(roots);
  return roots;
}
