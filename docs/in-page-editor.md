# In-page block editor

The page-builder editor that mounts on every `type: "blocks"` field
now ships two views — **Document** (a Notion-style inline canvas)
and **Page builder** (the row-card layout that's been there since
day one). Both views work on the same `NpBlockInstance[]` tree, so
content authored in one mode renders correctly in the other.

## Toggling between views

The header of the editor surfaces a Document / Page builder
segmented toggle. Pick once and the choice persists per
`<collection>.<field>` in `localStorage`
(`np-page-builder.editor-view.pages.blocks`, etc.). Default lands
on Page builder.

## Document view

Document view is meant for prose-heavy editing. Each block renders
as an inline body — paragraph / h1-3 / quote / code / callout /
list / image / divider. Hover any row to reveal the left rail:

- **+** — insert a paragraph below.
- **⋯** — opens the actions popover (Duplicate / Move up / Move
  down / Turn into… / Delete).

Typing `/` in an empty paragraph (or heading / quote) opens the
**slash menu** anchored to the row's caret. Filter as you type,
↑/↓ to navigate, ⏎ to insert, Esc to close. The menu lists every
"doc-friendly" block — anything with `docBodyKind` set to a value
other than `"complex"`. Picking an item swaps the source row in
place via the engine's new `REPLACE_TYPE` action.

The sticky toolbar above the canvas exposes the same block-level
type swaps (Pilcrow, H1-3, Quote, Code, List, HR, Image) as the
slash menu, plus the inline-mark buttons (Bold, Italic, Underline,
Strikethrough, Link, Inline-code). The mark buttons disable when
focus sits outside a Lexical body; v1 stores marks only on the
`rich-text` block.

Composite blocks (`hero`, `pricing`, `feature-grid`, etc.) render
as read-only summary cards in Document view — flip to Page
builder to edit their props.

## Page builder view

Page builder keeps the row-card layout, with these design refresh
items applied across the board:

- **Modal block palette** — replaces the popover. Categorized
  sections (Layout, Content, Media, Commerce, Community, Plugin,
  Other), search + favorites + recent, source / container badges
  on every card. Press the trigger or use Cmd-K to open it.
- **Outline panel** — recursive tree of every block, mounted in
  the side aside. Click a row to scroll + focus the matching
  card.
- **Container warnings panel** — surfaces `minChildren` /
  `maxChildren` / `allowedChildTypes` violations, with click-to-
  scroll behavior.
- **Status bar** — registry size, total-block count, container
  warning count, active-block chip, autosave indicator.

## Adding new atom blocks

The 8 atom blocks live under `packages/blocks/src/blocks/`
(`paragraph.tsx`, `heading.tsx`, `quote.tsx`, etc.). To add another:

1. Define the block with an `NpBlockDefinition` (full
   `propsSchema` + `render`).
2. Tag it with `docBodyKind` so the in-page editor's body
   renderer picks the right inline component. Use `"complex"`
   (or omit it) to opt out — the block will still edit cleanly
   in Page builder.
3. Add it to `packages/blocks/src/blocks/index.ts` and seed it
   in `packages/blocks/src/registry.ts`'s `defaultBlocks`.
4. Set `iconKind: "lucide"` and put a Lucide icon name (e.g.
   `"Sparkles"`) in `icon`. Names are resolved against the
   curated allow-list in
   `packages/admin/src/blocks/shared/block-icon-registry.ts` —
   add yours there if it isn't already exported.

Plugin blocks contributed via `definePlugin({ blocks: [...] })`
get the same treatment automatically; the resolver's
`EMOJI_TO_LUCIDE` alias map keeps emoji-iconed legacy plugins
rendering as Lucide SVGs even if the upstream plugin hasn't
migrated.

## Engine extension — `REPLACE_TYPE`

The editor engine (`packages/admin/src/blocks/editor-engine/`)
gains one new action:

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
  a paragraph to a hero inside a `pricing-tiers` container is
  rejected.
- When `preserveText !== false`, copies the source's primary
  text-shaped prop (in priority order: `text` → `heading` →
  `title` → `label` → `code` → `caption` → `items[0]`) into the
  new instance's matching slot.
- When the new type is a container and the source had children,
  the children carry over.
- Same id is preserved — undo/redo lands the operator on the
  same row visually.

## Known limitations (v1)

- **Autosave indicator stays in "dirty" state.** The status bar
  ships the pulse + label scaffolding (`useAutosaveStatus`), but the
  orchestrator doesn't yet receive a save-resolution callback from
  the surrounding form (react-hook-form's submit lives one layer
  up). Until that's plumbed, the indicator marks dirty on every
  edit but never flips back to "saved". The block tree itself is
  saved via the form's existing submit path — the indicator is
  cosmetic.
- **No drag-and-drop reorder in Document view.** Use the row's `⋯`
  popover (Move up / Move down) or switch to Page builder for
  dnd-kit-driven reorder. The form-card editor's nested-container
  drag stays unchanged.
- **Slash menu closes on Esc and re-opens if the text still starts
  with `/`.** The `dismissedTextRef` snapshot keeps the menu shut
  for the just-dismissed `/foo` text — typing past or deleting the
  slash invalidates the snapshot and reopens normally.
- **Inline marks (Bold / Italic / Underline / Strikethrough /
  Inline-code / Link) are rich-text-only.** Atom blocks store plain
  strings; the toolbar's mark segment disables when focus sits
  outside a Lexical body. v1.1 may add a `props.marks` shape on
  atom bodies — additive, no wire-format break.
- **The rich-text body in Doc view is a placeholder.** Existing
  rich-text content edits in Page builder (full Lexical UI). The
  in-page Lexical body lands in a follow-up PR.
- **Doc view edits top-level blocks only.** Containers (`grid`,
  `tabs`) render as read-only summary cards in Doc view; nest into
  them via Page builder.

## Testing

Pure-logic smoke tests live in
`apps/web/tests/in-page-editor.unit.test.ts` and cover:

- Atom block registration + metadata invariants.
- Lucide-name migration on the 13 legacy built-ins.
- Server-render output for every atom block.

Run with `pnpm --filter @nexpress/web run test`. The unit suite
runs without a database; the existing integration suite at
`pnpm --filter @nexpress/web run test:integration` still requires
`TEST_DATABASE_URL`.
