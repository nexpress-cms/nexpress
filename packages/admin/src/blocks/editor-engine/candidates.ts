import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { ContainerCandidate } from "./types.js";
import { isDescendantOf } from "./tree.js";

/**
 * Walks the tree and collects container blocks that are valid
 * `MOVE_INTO` targets for `sourceId`: any container block that
 * isn't `sourceId` itself and isn't a descendant of it (which
 * would create a cycle).
 *
 * Both the form-editor's row-header dropdown and Cmd-K read this
 * list. Doc view keeps cross-hierarchy moves in Page builder where
 * container boundaries are visible.
 */
export function collectContainerCandidates(
  blocks: NpBlockInstance[],
  sourceId: string,
  definitions: Map<string, NpBlockMetadata>,
): ContainerCandidate[] {
  const out: ContainerCandidate[] = [];
  const walk = (arr: NpBlockInstance[]): void => {
    for (const b of arr) {
      if (b.id !== sourceId) {
        const def = definitions.get(b.type);
        if (def?.acceptsChildren && !isDescendantOf(blocks, b.id, sourceId)) {
          out.push({ id: b.id, label: def.label });
        }
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
