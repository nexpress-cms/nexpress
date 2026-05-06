---
"@nexpress/admin": minor
"@nexpress/blocks": minor
---

Block editor refresh — design alignment + new in-page editor view.

## Form-card editor refresh (every operator gets this)

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

## In-page Doc view — full edit parity

The Doc view ships editing-complete:

- **Autosave** — `SaveEventsProvider` mounted in `CollectionEditView`
  emits `"saving"` / `"saved"` / `"error"` around the form's
  submitWithStatus. The orchestrator subscribes via `useSaveEvents`
  and forwards into `useAutosaveStatus`, so the status-bar pulse
  cycles dirty → saving → saved → idle. Errors stay dirty.
- **HTML5 drag-and-drop reorder** — same-parent reorder via the
  row's grip handle. Module-scoped `activeDragSource` carries the
  source's parentId so cross-parent drops are filtered visually
  (no silent reducer no-ops). Drop indicator anchors above /
  below the target row.
- **Lexical body in Doc view** — `RichTextBody` lazy-loads
  `NpRichTextEditor` from `@nexpress/editor/client`. Same wire
  format as Page builder; the body container's
  `data-np-rich-text-body` marker drives the toolbar's
  inline-mark gating.
- **Container nesting** — `acceptsChildren` blocks render with a
  dashed children area; nested rows use the same `BlockRow`
  component recursively. Inline insert honors the parent's
  `allowedChildTypes` and `maxChildren` contracts; at-cap
  containers swap the "Add into …" button for a cap notice.

## Atom block public-site CSS

The 8 atom blocks now ship default styles in `@layer np-blocks`
(`apps/web/src/app/globals.css`): paragraph spacing, heading sizes,
quote left-border, code block pre/code styling, callout tone
backgrounds, list bullet/decimal markers, image figcaption
treatment, divider hairline. Themes can override via
`@layer np-theme`.

## Cross-parent drag (MOVE_INTO)

The container's children area is a drop zone. Drags from a row
whose parent ISN'T this container highlight the area in primary;
on drop the engine dispatches `MOVE_INTO`. The reducer's existing
cycle / contract guards (allowedChildTypes, maxChildren,
descendant rejection) gate the actual move; bad drops are silent
no-ops.

Same-parent reorder still uses `useRowDrag` with the above /
below indicator — the two paths don't overlap because the row
hook gates on `parentId === source.parentId` and the container
zone gates on the inverse.

## Markdown-style inline marks on atom blocks

Atom blocks (paragraph / heading / quote / list / callout) now
support a small markdown subset for inline formatting at render
time:

- `**bold**` → `<strong>`
- `*italic*` → `<em>`
- `_underline_` → `<u>`
- `~~strike~~` → `<s>`
- `` `code` `` → `<code>`

The toolbar's Bold / Italic / Underline / Strikethrough /
Inline-code buttons wrap the active textarea's selection in the
matching delimiter (no selection → inserts paired delimiters with
the caret between them). New helper exported from
`@nexpress/blocks`: `renderInlineMarks(text)` for theme authors
who want to reuse the parser.

The wire format stays a plain `string` (no marks-array shape) —
operators see the syntax while editing but the public-site render
resolves it into spans. For full WYSIWYG with arbitrary nested
formatting, the rich-text block (Lexical) remains the right
surface.

## Slash menu — container-aware

Typing `/` in an atom row inside a container now opens the slash
menu the same way it does at top level. The picker's type list
respects the parent container's `allowedChildTypes` contract, so
operators only see types the reducer would accept.

## Engine actions + tests

- `EditorAction` gains `REPLACE_TYPE` (id, newType, preserveText?).
  Adding to a discriminated union is non-breaking.
- 51 unit tests in `apps/web/tests/in-page-editor.unit.test.tsx`
  (DB-free, runs via `pnpm --filter @nexpress/web run test`).
  Covers atom registration, Lucide migration, server-render
  output, the new `REPLACE_TYPE` reducer (id preservation,
  preserveText, container children carry-over, parent contract
  rejection, REPLACE_TYPE ↔ UPDATE_PROPS composition), and the
  inline-marks parser (bold / italic / underline / strike / code
  + nesting + unmatched-delimiter fallthrough).

## Atom block default styles

`apps/web/src/app/globals.css` ships default rules for every
atom block class (`np-paragraph`, `np-heading-1/2/3`, `np-quote`,
`np-code`, `np-callout-info|warning|success`, `np-list`,
`np-image`, `np-divider`) inside `@layer np-blocks`. Themes can
override via `@layer np-theme` — the cascade picks theme over
default.
