import type { NpBlockMetadata } from "@nexpress/blocks";

/**
 * Decides whether the container described by `parentDef` can
 * accept a child of `childType` given its current children
 * count.
 *
 * - No `allowedChildTypes` (or `["*"]`) → accept everything.
 * - `maxChildren` (when set) → cap the count.
 *
 * Used by every reducer case that adds blocks to a container
 * (ADD / INSERT_BEFORE / INSERT_AFTER / INSERT_PATTERN /
 * MOVE_INTO / WRAP_IN), so the gate is unified across surfaces.
 */
export function canAcceptChild(
  parentDef: NpBlockMetadata,
  childType: string,
  currentCount: number,
): boolean {
  if (
    typeof parentDef.maxChildren === "number" &&
    currentCount >= parentDef.maxChildren
  ) {
    return false;
  }
  const allowed = parentDef.allowedChildTypes;
  if (!allowed || allowed.length === 0) return true;
  if (allowed.includes("*")) return true;
  return allowed.includes(childType);
}
