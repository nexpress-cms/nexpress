import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

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
 * `_layout: { colSpan, mdColSpan?, lgColSpan? }` prop on their
 * `props` map (1–12 each).
 *
 * - `colSpan` is the base / mobile span. Defaults to `columns`
 *   (full-width) when unset.
 * - `mdColSpan` overrides on viewports ≥ 768px.
 * - `lgColSpan` overrides on viewports ≥ 1024px.
 *
 * The page-builder admin exposes these as three selects per grid
 * child (Mobile / Tablet / Desktop); themes that render a grid by
 * hand can write the meta directly.
 *
 * The block's renderer wraps each child in a `<div>` whose
 * `--np-cell-span*` CSS custom properties carry the per-breakpoint
 * spans. A scoped `<style>` block emitted alongside the grid
 * applies the spans through media queries — the children themselves
 * don't know they're inside a grid, which keeps every existing
 * leaf block usable inside or outside a grid without changes.
 */
export const gridBlock: NpBlockDefinition = {
  type: "grid",
  label: "Grid",
  description:
    "12-column responsive grid. Drop blocks inside and tune the column span on each child.",
  icon: "LayoutGrid",
  iconKind: "lucide",
  category: "Layout",
  source: "built-in",
  keywords: ["columns", "row", "container"],
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
      <div className="np-block-grid" style={style}>
        {/* Per-breakpoint colSpan vars on each cell. Cascade:
            lg falls back to md, md falls back to base. The selector
            is scoped (`:scope > .np-block-grid-cell`) so a nested
            grid's cells don't pick up an outer grid's rules — each
            grid emits its own copy. */}
        <style
          dangerouslySetInnerHTML={{
            __html: GRID_RESPONSIVE_CSS,
          }}
        />
        {children}
      </div>
    );
  },
};

const GRID_RESPONSIVE_CSS = `
.np-block-grid > .np-block-grid-cell {
  grid-column: span var(--np-cell-span, 12) / span var(--np-cell-span, 12);
}
@media (min-width: 768px) {
  .np-block-grid > .np-block-grid-cell {
    grid-column: span var(--np-cell-span-md, var(--np-cell-span, 12)) / span var(--np-cell-span-md, var(--np-cell-span, 12));
  }
}
@media (min-width: 1024px) {
  .np-block-grid > .np-block-grid-cell {
    grid-column: span var(--np-cell-span-lg, var(--np-cell-span-md, var(--np-cell-span, 12))) / span var(--np-cell-span-lg, var(--np-cell-span-md, var(--np-cell-span, 12)));
  }
}
`;

/**
 * Helper used by the renderer + the editor: read the grid-layout
 * meta off a child's props. Centralizes the default + clamp so
 * the contract is in one place.
 *
 * `colSpan` is required (defaults to `defaultColSpan`); `mdColSpan`
 * and `lgColSpan` are optional — when omitted, the cell uses the
 * next-smaller breakpoint via the CSS fallback chain in
 * `GRID_RESPONSIVE_CSS`.
 */
export function readGridChildLayout(
  childProps: Record<string, unknown>,
  defaultColSpan: number,
): { colSpan: number; mdColSpan?: number; lgColSpan?: number } {
  const layout = childProps._layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    const obj = layout as Record<string, unknown>;
    const colSpan = readNumber(obj.colSpan, defaultColSpan, 1, 12);
    const out: { colSpan: number; mdColSpan?: number; lgColSpan?: number } = {
      colSpan,
    };
    if (obj.mdColSpan !== undefined && obj.mdColSpan !== null) {
      out.mdColSpan = readNumber(obj.mdColSpan, colSpan, 1, 12);
    }
    if (obj.lgColSpan !== undefined && obj.lgColSpan !== null) {
      out.lgColSpan = readNumber(obj.lgColSpan, colSpan, 1, 12);
    }
    return out;
  }
  return { colSpan: defaultColSpan };
}
