import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

/**
 * Reads the first non-empty string-shaped prop named in
 * `definition.summaryFields` and returns it for display on the
 * collapsed block row header. Falls back to `null` so callers
 * can render a different layout (block type only) when no
 * summary is available.
 *
 * Form editor uses this for the row card header. In-page editor
 * could surface it on a hovering label / breadcrumb.
 */
export function getRowSummary(
  definition: NpBlockMetadata | undefined,
  block: NpBlockInstance,
): string | null {
  const fields = definition?.summaryFields;
  if (!fields || fields.length === 0) return null;
  for (const name of fields) {
    const value = block.props[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
