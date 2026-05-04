---
"@nexpress/blocks": minor
"@nexpress/admin": minor
---

Page builder editor — phase 2 (grid layout + tree-shaped blocks).

`NxBlockInstance` gains an optional `children: NxBlockInstance[]`,
`NxBlockDefinition` gains `acceptsChildren: boolean`, and the
`render` signature picks up an optional second arg
`(props, children?: ReactNode) => ReactElement`. Existing leaf
blocks (hero, cta, faq, …) keep working unchanged because they
ignore the new arg; their instances on disk continue to have no
`children` field. Pure-additive on the wire format.

A new built-in `gridBlock` (`type: "grid"`) ships as the first
container — 12-column CSS grid with configurable column count and
gap. Each grid child carries an optional `_layout: { colSpan }`
on its props (1–12, defaults to 12 = full row). The renderer
wraps each child in a span div automatically so leaf blocks don't
need to know they sit inside a grid.

`renderBlocks` recurses through `instance.children` and feeds the
rendered subtree to the parent's `render(props, children)`. The
top-level renderer is unchanged for leaf-only pages — output is
byte-equivalent.

The admin block page editor recurses too: container blocks show
a "Children (N)" area with their own SortableContext, an inline
"Add child" popover (same `BlockPalette`), and per-child
collapsibles. Grid children get a dedicated "Grid column span"
1–12 select control inside their props form. Cross-container
drag is intentionally not supported in v1 — operators move blocks
across containers via duplicate-then-delete; nested-DnD shipped
without a clear-collision UX is worse than not shipping it.
