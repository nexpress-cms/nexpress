---
"@nexpress/admin": minor
"@nexpress/blocks": minor
---

Block editor refresh — design alignment + new Document view.

## Page builder refresh (every operator gets this)

- **Modal block palette** — popover replaced by a centered Dialog
  with categorized sections (Layout / Content / Media / Commerce
  / Community / Plugin / Other), search + favorites + recent,
  source (built-in / plugin / theme) + container badges on every
  card. Same data-flow as before; deeper UI.
- **Hairline + rounded-2xl row cards** with refined source /
  container badges in the row header.
- **Outline panel + Container warnings panel** mounted via portal
  in the host's sticky right sidebar, so the editor canvas keeps
  full width. Outline = recursive block tree (click → scroll +
  focus); warnings surface `minChildren` / `maxChildren` /
  `allowedChildTypes` violations with click-to-scroll.
- **Status bar** in the editor footer — registry size, total
  block count, warnings count, active-block chip, autosave pulse
  with a custom box-shadow ripple keyframe matching the design's
  `.be-pulse`.

## Document view (new)

A second view alongside Page builder, picked by a header toggle
(Document / Page builder). Doc view renders the page **as a
server-side preview** — the same `/api/admin/preview-blocks`
pipeline the existing PreviewPanel uses, but now the operator's
primary editing surface. Theme CSS, plugin blocks, async data
all resolve correctly so what the operator sees matches what
visitors will see.

Hovering any block in the canvas surfaces a small action rail:

- **Settings (gear)** — opens a `BlockSettingsDialog` modal that
  walks the block's `propsSchema` and renders one `FieldControl`
  per field. Honors `hiddenWhen` / `visibleWhen` predicates the
  same way the form-card editor does. Save dispatches
  `REPLACE_PROPS`; Cancel discards.
- **Delete (trash)** — dispatches `DELETE` for the hovered block.

Block insertion routes through the same `<PaletteModal>` Page
builder uses — Doc and Page modes share one picker.

The view choice persists per `<collection>.<field>` in
localStorage. Default lands on Page builder; opting into Doc is
one click.

## Engine extension — `REPLACE_TYPE`

`EditorAction` gains one new variant — `REPLACE_TYPE` — used by
the form-card editor's bulk "Convert to" flow. Adding to a
discriminated union is non-breaking. Reducer behavior:

- Locate by id; no-op if missing.
- Honor parent's `allowedChildTypes` contract.
- Optional `preserveText` (default true) carries the source's
  primary text-shaped prop into the new block's matching slot.
- Container children carry over when both old and new types
  accept children.

## Lucide icon migration

The 14 built-in blocks switched from emoji `icon` strings to
Lucide icon names (`"Sunrise"`, `"LayoutGrid"`, `"FileText"`,
etc.) and added `iconKind: "lucide"`. New `BlockIcon` resolver
maps Lucide names to `lucide-react` SVG components; an
`EMOJI_TO_LUCIDE` alias map keeps un-migrated plugin blocks
rendering as proper SVGs without API churn.

## CSRF + autosave

- All admin mutations now route through `npFetch` so the proxy's
  auto-CSRF check (#281) succeeds: PreviewPanel
  (`/api/admin/preview-blocks`), patterns service
  (`/api/admin/patterns`), and the block image picker upload
  (`/api/media`). Raw `fetch(POST, ...)` was returning 403
  CSRF_INVALID and silently breaking those flows.
- New `SaveEventsProvider` mounted in `CollectionEditView` emits
  `"saving"` / `"saved"` / `"error"` around the form's submit
  flow. The block-editor orchestrator subscribes via
  `useSaveEvents` and forwards to its autosave indicator —
  status-bar pulse cycles dirty → saving → saved → idle as
  expected.

## Type extensions on `NpBlockMetadata`

- `iconKind?: "lucide" | "emoji"` — advisory hint for the icon
  resolver. Optional and additive.

(`docBodyKind` was added during the design pass and removed
before merge — Doc view uses server-side preview now, no
per-block kind hint required.)
