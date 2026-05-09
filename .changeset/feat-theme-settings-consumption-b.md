---
"@nexpress/theme-magazine": minor
"@nexpress/theme-portfolio": minor
---

**Phase F.9.1-B — more theme settings consumption.**

Continuation of F.9.1-A. Wires the next batch of settings
through to components, leaving only the heaviest 3 (heroStyle
component swap, aboutCopy surface, clientLogos strip) for
F.9.1-C.

### Magazine wirings (2)

- **`settings.postsPerPage`** — `CategoryArchive` and
  `AuthorArchive` use it for their `findDocuments` limit
  (was hardcoded 10). Operators who want a longer or shorter
  archive page set it from admin (range 1–50 from the
  schema).
- **`settings.accentColor`** — `MagazineShell` injects an
  inline `<style>` scoping `.np-magazine` to override
  `--np-color-primary` with the operator's hex. Per-request
  application means changes show on next reload — no full
  build / token-save round-trip needed.

### Portfolio wirings (5)

- **`settings.cardAspect`** — `PortfolioShell` sets
  `--np-portfolio-card-aspect` (1/1 / 3/4 / 4/3 / 1/1.618)
  on the root; `styles.ts` reads it via `aspect-ratio:
  var(--np-portfolio-card-aspect, 4/3)` on
  `.np-portfolio-project-cover`.
- **`settings.hoverStyle`** — `PortfolioShell` sets a
  `data-hover-style="<x>"` attribute on the root;
  `styles.ts` provides 4 variant rules:
    - `fade` (default): caption fades + image scales
    - `scale`: only image zooms
    - `slide`: image static, caption slides up further
    - `lift`: card lifts with shadow
- **`settings.showProjectMeta`** — `ProjectDetailTemplate`
  hides the `<dl>` meta strip (Client / Role / Year) when off.
  Studios with anonymous client work flip it off.
- **`settings.showProjectTags`** — `PortfolioProjectCard`
  hides the category chip on the index grid when off.
  Operators who want a cleaner unannotated grid flip it off.
- **`settings.accentColor`** — `PortfolioShell` sets
  `--np-color-primary` inline (same pattern as magazine).

### Built-in CSS reads new variables

`styles.ts` updated:
- `.np-portfolio-project-cover` aspect now reads
  `var(--np-portfolio-card-aspect, 4 / 3)`.
- 4 `[data-hover-style="<x>"]` blocks (fade/scale/slide/lift).

### What's still hardcoded (deferred to F.9.1-C)

The heaviest 3 settings — each needs a new component or
surface, not just a wiring change:

- **magazine `heroStyle` (featured / carousel / grid)** — the
  homepage hero is a single block today. Adding "carousel" +
  "grid" variants means three new block types and a hero-
  switching component.
- **portfolio `aboutCopy`** — needs an about-page surface
  (template + slot wiring) to render the copy. Today there's
  nowhere to display it.
- **portfolio `clientLogos`** — needs a homepage strip
  component reading the array; not currently part of any
  template.

These are real polish items but each is its own component
piece. They land as F.9.1-C.

### Validation

Operators can now toggle 8 settings (3 from F.9.1-A + 5 from
F.9.1-B) and see immediate visible site changes. Combined
with magazine's `postsPerPage` and both themes'
`accentColor`, that's **10 of the 18 v0.2 settings live**.
The remaining 8 are either CSS-only (3 already covered here),
component-swap (heroStyle), or new-surface (aboutCopy,
clientLogos).
