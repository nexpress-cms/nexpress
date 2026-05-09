---
"@nexpress/admin": minor
"@nexpress/blocks": patch
---

**F.5.2 — pattern library side panel + broken-image fallback +
preview URL convention.**

Three follow-ups bundled, building on F.5.1's Cmd-K
enhancement:

### 1. Pattern library dialog (`PatternLibraryDialog`)

A richer browse-and-pick UI for patterns: full-width
thumbnail tiles in a 1/2/3-column grid, a search box, and
source-filter chips (All / Built-in / Theme / Plugin /
Saved). Complements the Cmd-K menu's text-line shortcut for
operators who want to *see* their options before inserting.

Opens via:
- New "Patterns" button next to Undo/Redo in the page-builder
  header
- Cmd-Shift-P keyboard shortcut (Shift-P is unbound in
  Chrome / Safari / Firefox; Cmd-P / Cmd-L are reserved by
  the browser)

Selecting a tile fires `INSERT_PATTERN` and closes the
dialog — single-action by design so the operator goes back
to the editor immediately to position the inserted block.

### 2. Broken-image fallback (`PatternPreview`)

Reusable component for rendering pattern thumbnails. Two
sizes: `thumb` (24×36px, used inline by Cmd-K menu) and
`card` (16:10 aspect, used in the library grid).

Behavior:
- Renders `<img loading="lazy">` when `src` is set
- Catches `onError` and falls back to a labeled icon tile
  (lucide `LayoutGrid`) so the picker stays usable when a
  theme ships a 404 preview path
- When `src` is omitted (built-in / saved patterns without
  thumbnails), renders the same fallback for visual
  consistency with theme-shipped patterns

The Cmd-K menu's existing inline thumbnail also routes
through this component now, picking up the fallback for
free.

### 3. Preview URL convention (documented on `NpPattern.preview`)

Theme authors who ship preview images should:

- Place files under the theme package's
  `public/themes/<theme-id>/patterns/` directory
- Reference them as `/themes/<theme-id>/patterns/<pattern-id>.png`
- Use PNG or WebP (transparent backgrounds OK)
- Source size 800×500px (admin renders 16:10 cards)
- Keep individual thumbnails under ~100 KB

The convention is documented; the field still accepts any
URL string, and the picker tolerates 404s via the fallback.

### What's NOT in this PR

- No changes to existing patterns. None of the built-in
  patterns / theme patterns currently set `preview`, so the
  library dialog opens with the icon-tile fallback for now.
  Theme authors can add previews incrementally.
- No server-side preview validation. The framework doesn't
  HEAD the URL at registration time — that'd be a bootstrap
  cost for every theme cold-start.
