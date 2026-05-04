import type { CSSProperties } from "react";

import type { NxBlockDefinition } from "../types.js";

const readNumber = (value: unknown, fallback: number, min = 1, max = 12): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(min, Math.min(max, Math.round(n)));
  return clamped;
};

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

/**
 * 12-column CSS grid container. Children carry an optional
 * `_layout: { colSpan }` prop on their `props` map (1–12, default
 * `columns / max(1, childCount)` so unsplit children share the row
 * evenly). The page-builder admin exposes this as a slider on each
 * grid child; themes that render a grid by hand can write the meta
 * directly.
 *
 * The block's renderer wraps each child in a `<div>` with the
 * span style — the children themselves don't know they're inside a
 * grid, which keeps every existing leaf block (hero, cta, …)
 * usable inside or outside a grid without changes.
 */
export const gridBlock: NxBlockDefinition = {
  type: "grid",
  label: "Grid",
  description:
    "12-column responsive grid. Drop blocks inside and tune the column span on each child.",
  icon: "▦",
  defaultProps: {
    columns: 12,
    gap: "1rem",
  },
  propsSchema: [
    {
      name: "columns",
      label: "Columns",
      type: "number",
      defaultValue: 12,
    },
    {
      name: "gap",
      label: "Gap (CSS length)",
      type: "text",
      defaultValue: "1rem",
    },
  ],
  acceptsChildren: true,
  render: (props, children) => {
    const columns = readNumber(props.columns, 12, 1, 12);
    const gap = readString(props.gap, "1rem");
    const style: CSSProperties = {
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap,
    };
    return (
      <div className="nx-block-grid" style={style}>
        {children}
      </div>
    );
  },
};

/**
 * Helper used by the renderer + the editor: read the grid-layout
 * meta off a child's props. Centralizes the default + clamp so
 * the contract is in one place.
 */
export function readGridChildLayout(
  childProps: Record<string, unknown>,
  defaultColSpan: number,
): { colSpan: number } {
  const layout = childProps._layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    const colSpan = readNumber(
      (layout as Record<string, unknown>).colSpan,
      defaultColSpan,
      1,
      12,
    );
    return { colSpan };
  }
  return { colSpan: defaultColSpan };
}
