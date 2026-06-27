# In-page block editor

The page-builder editor that mounts on every `type: "blocks"` field
ships two views — **Document** (a server-rendered preview with
hover-edit affordances) and **Page builder** (the row-card form
layout that's been there since day one). Both views work on the
same `NpBlockInstance[]` tree, so content authored in one mode
renders correctly in the other.

## Toggling between views

The header of the editor surfaces a Document / Page builder
segmented toggle. Pick once and the choice persists per
`<collection>.<field>` in `localStorage`
(`np-page-builder.editor-view.pages.blocks`, etc.). Default lands
on Page builder.

## Document view

Document view is the WYSIWYG preview surface. Blocks render
through the same server-side pipeline the public site uses
(`/api/admin/preview-blocks` → `renderBlocks()` with the active
theme's CSS), so what the operator sees in the canvas matches
what visitors will see — theme tokens, plugin blocks, async data
all resolved.

The page lives inside an iframe (`srcDoc`, same-origin sandbox)
so theme CSS stays scoped. Above it, the editor surfaces hover
controls in the parent React tree.

When the block tree is empty, Document view keeps the preview
frame mounted and overlays a small empty-state panel with the same
starter-block choices Page builder exposes. The trailing quick-
insert bar remains available, so the first block can still be
plain rich text without opening a modal.

### Hover affordances

Hovering any block in the canvas highlights it with a primary-
color ring and surfaces a compact action rail beside the block:

- **Insert below (plus)** — opens the inline quick-insert bar
  directly after the hovered block.
- **Drag (grip)** — reorders top-level blocks in Document view.
  Nested reordering still lives in Page builder where container
  boundaries are visible.
- **Settings (gear)** — opens a `BlockSettingsDialog` modal that
  walks the block's `propsSchema` and renders one `FieldControl`
  per field. The form respects `hiddenWhen` / `visibleWhen`
  predicates the same way the form-card editor does. Edits stay
  in a draft until Save; Cancel discards them.
- **Delete (trash)** — dispatches `DELETE` for the hovered block.

For deeper structural changes (nested drag-reorder, multi-select,
wrap in container, undo across many edits) operators flip to
**Page builder** view — the row-card layout still exposes the full
toolbox.

### Adding blocks

Document view has a quick-insert bar at the end of the preview
and can also open the same bar below a hovered block. Plain text
submitted there creates a populated rich-text block. Typing `/`
switches into the slash menu, which filters the shared block
registry and inserts the selected structural block.

The palette behind slash insertions is the same registry Page
builder uses; there's no per-view block filter.

### Why no inline atom blocks

Doc view used to ship per-paragraph / per-heading "atom" blocks
edited via inline textareas. The rich-text block already covers
paragraphs, headings, lists, code, image, HR, and inline marks
through Lexical — running atom blocks alongside duplicated the
same content types under a different wire format. The atoms were
removed before #511 merged. Operators who want long-form prose
add a single rich-text block; structural blocks (hero, feature
grid, pricing, CTA, etc.) sit alongside it. Both edit cleanly
through the settings dialog in Doc view or the row card in Page
view.

## Page builder view

Page builder keeps the row-card layout, with the design-system
pass applied across the board:

- **Modal block palette** — replaces the popover. Categorized
  sections (Layout, Content, Media, Commerce, Community, Plugin,
  Other), search + favorites + recent, source / container badges
  on every card. Press the trigger or use Cmd-K to open it.
- **Outline panel** — recursive tree of every block, mounted in
  the host's sticky right sidebar via a portal so the canvas
  takes full width. Click a row to scroll + focus the matching
  card.
- **Container warnings panel** — surfaces `minChildren` /
  `maxChildren` / `allowedChildTypes` violations, with click-to-
  scroll behavior.
- **Status bar** — registry size, total-block count, container
  warning count, active-block chip, autosave indicator.

## Engine extension — `REPLACE_TYPE`

The editor engine (`packages/admin/src/blocks/editor-engine/`)
keeps one type-swap action available for convert-type affordances:

```ts
| {
    type: "REPLACE_TYPE";
    id: string;
    newType: string;
    preserveText?: boolean; // default true
  }
```

Behavior:

- Locates the block by id; no-op if missing.
- Looks up the new type in the closure-bound `definitions` map;
  no-op if unregistered.
- Honors the parent's `allowedChildTypes` contract — converting
  a block inside a strict container to a disallowed type is
  rejected.
- When `preserveText !== false`, copies the source's primary
  text-shaped prop (`text` / `heading` / `title` / `label` /
  `code` / `caption` / `items[0]`) into the new instance's
  matching slot.
- When the new type is a container and the source had children,
  the children carry over.
- Same id is preserved — undo/redo lands the operator on the
  same row visually.

## Notes & limitations (v1)

- **Document drag-and-drop is top-level only.** Nested reorder and
  cross-container movement stay in Page builder so container
  boundaries remain explicit.
- **Settings dialog drives one block at a time.** Multi-select +
  bulk-edit lives in Page builder.
- **Plugin blocks render via the server preview** — same path the
  public site uses, so plugin / theme contributions appear
  correctly in Doc view's canvas.

## Testing

Pure-logic smoke tests live in
`apps/web/tests/in-page-editor.unit.test.tsx` and cover:

- Lucide-name migration on the 14 built-in blocks.
- `REPLACE_TYPE` reducer cases (id preservation, parent
  contract rejection, container children carry / drop, unknown
  type no-op, missing id no-op).
- `MOVE_WITHIN_PARENT` side semantics used by Document drag
  indicators.
- Quick-insert slash filtering.
- Document-mode text metrics, including rich-text Lexical content
  and nested structural copy.

Rendered golden paths live in `apps/web/tests/e2e/`:

- `in-page-editor.spec.ts` edits a preview block in Document view,
  publishes the page, verifies the public URL renders that block,
  then reopens the admin editor to confirm the saved preview.
- `publish.spec.ts` creates a page, authors a rich-text block from
  Document view's quick insert, publishes it, and verifies the
  authored text renders on the public site.

Run with `pnpm --filter @nexpress/web run test`. The unit suite
runs without a database; the existing integration suite at
`pnpm --filter @nexpress/web run test:integration` still requires
`TEST_DATABASE_URL`.
