---
"@nexpress/blocks": minor
"@nexpress/theme": minor
"@nexpress/next": patch
"@nexpress/web": patch
---

**Phase F.5 — `impl.patterns`: theme-shipped block patterns + active-source filter.**

Fifth implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md` §4.5). Themes can ship
pre-shaped block subtrees that operators drop into pages in one
click. Patterns participate in the same `theme:<id>` source
identity model as F.4 blocks, so multi-site processes filter
patterns per active site exactly like blocks.

### Surface added

#### `@nexpress/blocks`
- `NpPattern.preview?: string` — optional preview image path
  (typically served from the theme's `public/`). Picker UI
  thumbnail rendering is tracked as a follow-up; the field
  persists today regardless.
- `NpPattern.category?: "homepage" | "page" | "section" | string`
  — optional grouping label.
- `getRegisteredPatternsForActiveSources(ctx)` — sister of the
  F.4 block filter. Theme patterns are scoped by `themeId`;
  plugin / built-in / custom patterns always pass.

#### `@nexpress/theme`
- `NpThemeImpl.patterns?: NpPattern[]` — theme-shipped patterns.

#### `@nexpress/next`
- Bootstrap auto-stamps `source: "theme:<theme.manifest.id>"` on
  each pattern at registration. Theme patterns survive plugin
  reload (re-registered after `resetSharedPatternRegistry`)
  exactly like F.4 theme blocks.

#### `apps/web`
- Admin layout now filters patterns through
  `getRegisteredPatternsForActiveSources` so the page-builder's
  pattern picker only shows the current site's patterns. Same
  `getCachedActiveTheme()` resolution as F.4 — admin and
  renderer agree on the active theme.

### Plugin/theme parity

Plugin patterns already get `source: "plugin:<plugin.id>"`
(stamped in F.4). Theme patterns now get `source: "theme:<id>"`.
The activation filter follows the same rule as for blocks —
plugin / core / custom patterns always pass; only theme
patterns are gated by the active theme id.

### Tests

3 new unit tests in `packages/blocks/src/source.test.ts`:
- Filters theme patterns by active theme id
- Filters out all theme patterns when no theme active
- Preserves `preview` + `category` fields through the filter

Total `@nexpress/blocks` tests: 17 (was 14).

### What's not in this phase (deferred — explicit follow-up)

The design doc §4.5 promises a redesigned **picker UI** with
category grouping + preview thumbnails. Today's Cmd-K command
menu lists patterns under a flat "Pattern" group label —
operators CAN insert theme patterns through it, but the
visual experience is plain.

The picker UI redesign is **F.5.1**, a follow-up PR within
the F.5 phase. Splitting it off keeps this PR focused on the
contract surface (which downstream phases F.6+ depend on)
without ballooning into a UI redesign. The deferred work:

- Replace flat list with category-grouped sections
- Render `preview` image thumbnails next to pattern entries
- Filter / search by category in the picker

Recorded here because the user-visible operator experience
isn't fully shipped until F.5.1 lands.
