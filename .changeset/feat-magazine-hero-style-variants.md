---
"@nexpress/theme-magazine": minor
---

**F.9.2 — magazine `heroStyle` setting now renders three layout
variants.**

Closes the v0.2 deferred-no-op note on `magazineSettings.heroStyle`.
The setting was carrying the operator's choice (featured / carousel /
grid) but the magazine.hero-feature block ignored it. F.9.2 wires
the choice into actual rendering.

### What changed

The `magazine.hero-feature` block now resolves a layout from two
sources in priority order:

1. The block's own `styleOverride` prop (per-instance pin)
2. The theme-level `heroStyle` setting (site-wide default)

When `styleOverride === "auto"` (default), the setting wins.

| Layout | Renders | Reads |
|---|---|---|
| `featured` | Single lead story with full-bleed background image, headline, subdeck, CTA | `title`, `subtitle`, `ctaText`, `ctaUrl`, `imageUrl` |
| `carousel` | Headline row + horizontally scrollable card track (CSS scroll-snap) | `title`, `subtitle`, `ctaText`, `ctaUrl`, `items[]` |
| `grid` | Headline row + 3-column responsive tile grid | `title`, `subtitle`, `ctaText`, `ctaUrl`, `items[]` |

`items` is a new prop carrying `{ title, url?, imageUrl?, category? }[]`.
Featured layout ignores it; carousel/grid use it. Empty `items`
shows a "Add items in the block's props" placeholder so operators
know what's missing.

### Block prop schema additions

| Prop | Type | Notes |
|---|---|---|
| `styleOverride` | `select` | `auto` / `featured` / `carousel` / `grid`. Default `auto`. |
| `items` | `textarea` (JSON) | Same UX as section-strip's items array. |

The setting's description was updated — no longer claims to be
deferred.

### CSS (in styles.ts)

New rules under data attribute `[data-hero-style="carousel"]` and
`[data-hero-style="grid"]`:

- Shared `.np-magazine-hero-header` for the heading row
- Carousel: `flex` track with `scroll-snap-type: x mandatory`,
  280px-wide cards, 4:3 image aspect
- Grid: `grid-template-columns: repeat(3, 1fr)` ≥768px viewport,
  16:10 image aspect; `auto-fit` minmax(220px) below the breakpoint

### Migration notes

Existing pages with a `magazine.hero-feature` block keep working —
they get `styleOverride: "auto"` implicitly (no prop = default), so
they follow whatever the operator's `heroStyle` setting is. If
the setting is `featured` (the default), behavior is identical to
before this PR.

Operators who set `heroStyle: "carousel"` or `"grid"` BEFORE F.9.2
finally see the layout change — previously the setting was
silently ignored.
