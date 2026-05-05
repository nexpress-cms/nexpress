---
"@nexpress/blocks": minor
"@nexpress/next": patch
"@nexpress/admin": minor
---

Page builder palette — categories, recent picks, keyword search (#467, "Better block palette organization").

Fourth PR off the #467 phase 2-4 queue. The Add-block popover now
groups blocks by category, floats the operator's recent picks to
the top, and matches against a richer set of search tokens. Helps
discovery as plugin / theme blocks accumulate.

`@nexpress/blocks` — three new optional fields on
`NpBlockMetadata`:

- `category?: string` — group key for the palette (e.g. "Layout",
  "Content", "Media", "Commerce", "Community"). Free-form so
  themes / plugins can add their own sections without lobbying
  for a hard-coded slot.
- `keywords?: readonly string[]` — fuzzy-match tokens beyond
  `label` / `type` / `description`. Operators who don't remember
  the exact label still find the block (e.g. `["call to action",
  "button banner"]` on CTA).
- `source?: "built-in" | "plugin" | "theme" | (string & {})` —
  ownership scope. Drives a small "plugin" badge in the palette
  and lets the framework group plugin contributions. The
  `@nexpress/next` bootstrap auto-tags `source: "plugin"` on every
  block registered through `pluginBlocks(plugin)` (both initial
  load and `reloadPlugins()`), so plugin authors don't have to
  set it manually unless they want a different scope.

Wired on the nine built-in blocks:

- Layout: `grid`
- Content: `hero`, `cta`, `faq`, `feature-grid`, `rich-text`
- Media: `image-gallery`
- Commerce: `pricing`
- Community: `contact-form`

`@nexpress/admin` `BlockPalette`:

- Renders sectioned headers per category. Order:
  Recent → Layout → Content → Media → Commerce → Community →
  Plugin → Other → custom-categories alphabetical.
- Recent section pulls the last 5 picks from `localStorage`
  (`np-page-builder.recent-blocks`). Stale types (plugin disabled,
  theme swap) get filtered out at render time.
- Search filter now matches `label` + `type` + `description` +
  `category` + `keywords`.
- Plugin contributions show a small "plugin" badge.

Backward compatible. All metadata fields are optional; blocks
without `category` fall into "Other" so existing definitions keep
showing up unchanged. Pre-PR plugin blocks without `source` get
auto-tagged "plugin" by the bootstrap. No wire-format changes.
