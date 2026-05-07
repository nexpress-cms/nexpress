import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

/**
 * Container contract violation surfaced by the editor's warning
 * panel. The reducer fail-closes most insert paths; warnings here
 * cover the situations the reducer can't reject:
 *
 * - `min`: the container has fewer children than `minChildren`
 *   (an in-progress page mid-edit naturally violates lower bounds —
 *   warn but don't block save).
 * - `max`: the container has more children than `maxChildren`
 *   (only reachable when a plugin tightens the cap after content
 *   was authored against an earlier, looser contract).
 * - `type`: a child's type is no longer in the parent's
 *   `allowedChildTypes` (same retroactive-tightening case).
 */
export interface ContainerWarning {
  /** The container block id the warning applies to. */
  id: string;
  kind: "min" | "max" | "type";
  /** Operator-facing copy. Keep terse. */
  message: string;
}

/**
 * Walks the block tree and produces a flat list of container
 * contract violations. Cheap — pages have dozens of blocks at
 * most. Used by the warnings panel + the inline alert on each
 * affected row.
 */
export function evaluateContainerWarnings(
  tree: NpBlockInstance[],
  definitions: ReadonlyMap<string, NpBlockMetadata>,
): ContainerWarning[] {
  const out: ContainerWarning[] = [];
  const walk = (nodes: NpBlockInstance[]): void => {
    for (const node of nodes) {
      const meta = definitions.get(node.type);
      if (meta?.acceptsChildren) {
        const children = node.children ?? [];
        if (typeof meta.minChildren === "number" && children.length < meta.minChildren) {
          const noun = meta.minChildren === 1 ? "child" : "children";
          out.push({
            id: node.id,
            kind: "min",
            message: `${meta.label} expects at least ${meta.minChildren} ${noun} (has ${children.length}).`,
          });
        }
        if (typeof meta.maxChildren === "number" && children.length > meta.maxChildren) {
          out.push({
            id: node.id,
            kind: "max",
            message: `${meta.label} caps at ${meta.maxChildren} children (has ${children.length}).`,
          });
        }
        const allowed = meta.allowedChildTypes;
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes("*")) {
          for (const child of children) {
            if (!allowed.includes(child.type)) {
              out.push({
                id: node.id,
                kind: "type",
                message: `${meta.label} doesn't allow "${child.type}" as a child.`,
              });
            }
          }
        }
        walk(children);
      }
    }
  };
  walk(tree);
  return out;
}
