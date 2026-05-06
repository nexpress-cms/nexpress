---
"@nexpress/admin": minor
"@nexpress/blocks": minor
---

Block editor refresh — design alignment + new in-page editor view.

The form-card page-builder editor (mounted by `BlockPageEditor`) gets
a coordinated visual + interaction pass and a new alongside view:

- **Document view (new)** — a Notion-style inline canvas reachable
  from a header toggle. Renders the same `NpBlockInstance[]` tree
  as a flat sequence of inline-editable rows: paragraph / heading
  (h1-3) / quote / code / callout / list / image / divider. Hover
  reveals the row rail (add-below, actions popover). Typing `/` in
  an empty atom body opens a slash-menu of doc-friendly types
  (filtered by label / type / category / keywords). Picking an item
  swaps the source row in place via the new `REPLACE_TYPE` engine
  action. Containers / hero / pricing etc. render as read-only
  summary cards in Doc view — operators switch to Page builder to
  edit those.

- **Page builder refresh** — every operator sees this on next deploy.
  The popover-style block palette is replaced with a centered Dialog
  that surfaces source (`built-in` / `plugin` / `theme`) and
  `container` badges, larger cards with descriptions, and a footer
  showing total registry size + keyboard hints. The row card adopts
  hairline (`border-neutral-200/80`) borders + `rounded-2xl` corners
  + `bg-white/95 backdrop-blur-sm` per the design tokens. A new side
  outline panel and footer status bar mount alongside the row list,
  driven by the existing `useEditorState` hook plus a new
  `evaluateContainerWarnings(tree, defs)` helper that surfaces
  `min` / `max` / `allowedChildTypes` violations as inline alerts
  and a side warnings panel.

- **Lucide icon migration** — the 13 built-in blocks switch from
  emoji `icon` strings to Lucide icon names (`"Sunrise"`, `"LayoutGrid"`,
  `"FileText"`, etc.) and add `iconKind: "lucide"`. The new
  `BlockIcon` resolver maps Lucide names to `lucide-react` SVG
  components; an `EMOJI_TO_LUCIDE` alias map keeps un-migrated
  plugin blocks rendering as proper SVGs (`📝` → `FileText`) without
  any plugin API change.

- **8 new built-in atom blocks** — `paragraph`, `heading`, `quote`,
  `code`, `callout`, `list`, `image`, `divider`. Public block types
  with full `propsSchema` / `render` / `defaultProps`; round-trip
  cleanly through Page builder as row cards. Each carries a
  `docBodyKind` that the in-page editor's body renderer consumes.

Type extensions on `NpBlockMetadata` (additive — adding optional
fields is non-breaking per the v0.1 stability rules):

- `iconKind?: "lucide" | "emoji"` — resolver hint.
- `docBodyKind?: "paragraph" | "heading" | "heading-2" | "heading-3" | "quote" | "code" | "callout" | "list" | "image" | "divider" | "rich-text" | "complex"`
  — picks the in-page editor body component.

`EditorAction` gains a new variant: `REPLACE_TYPE` (id, newType,
preserveText?) — used by the slash menu and the toolbar's
block-level buttons. Adding to a discriminated union is non-breaking.

The view toggle persists per `<collection-slug>.<field-name>` in
localStorage. Default lands on Page builder so existing operators
see no behavior change until they opt in. The dispatcher in
`field-renderer.tsx` passes `viewScope` through automatically.

`BlockPalette` is preserved as a thin shell around the new
`PaletteModal` — plugin authors importing it directly keep
working. New code should reach for `PaletteModal` from
`@nexpress/admin/src/blocks/shared/palette-modal.js`.
