---
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": minor
---

**Phase F.9.1-C — last batch of settings consumption.**

Continuation of F.9.1-A/B. Wires the remaining 2 portfolio
settings and explicitly defers magazine's `heroStyle` (which
needs new hero render variants — out of scope for a wiring
PR).

### Portfolio wirings (2)

- **`settings.aboutCopy`** — `PortfolioFooter` renders the bio
  as a small paragraph above the contact line when present.
  Operators who want a fuller about page do that through the
  page builder; this is the ambient bio that appears on every
  page. Empty default (`""`) hides the line entirely.
- **`settings.clientLogos`** — new theme-shipped block
  `portfolio.client-logos`. Reads from `settings.clientLogos`
  (single source of truth for logos — operators manage them
  in admin's Theme settings panel rather than per-block-
  instance). Block props only carry the section heading.
  Empty list shows a "configure logos in admin" placeholder
  so operators see the wiring is live; populated list renders
  as a responsive grid of greyscale logos with optional links.

### Magazine — explicit deferral (F.9.2)

`settings.heroStyle` (`featured | carousel | grid`) stays a
no-op. The setting persists and validates, but the magazine
theme renders one hero style regardless because:

- The `magazine.hero-feature` block carries a single
  `imageUrl` + `title` + `subtitle` — by design, ONE story.
- "carousel" and "grid" variants need MULTIPLE stories'
  worth of data, which means new hero blocks
  (`magazine.hero-carousel`, `magazine.hero-grid`) and a
  homepage template that picks among them based on the
  setting.

Building those blocks + template is a meaningful piece of
work — not a one-line wiring like the other 13. The schema
description now spells out the no-op state; the F.9.2
follow-up handles the variants.

### Status across F.9.1 phase

| Wave | Settings live |
|---|---|
| F.9.1-A | 6 (newsletter, social, byline, studioName, gridColumns/gutter, footer credit/year) |
| F.9.1-B | 7 (postsPerPage, accentColor x2, cardAspect, hoverStyle, showProjectMeta, showProjectTags) |
| F.9.1-C (this) | 2 (aboutCopy, clientLogos) + 1 explicit no-op (heroStyle) |

**15 of 18 v0.2 settings produce visible site changes from
admin toggles.** The remaining 3 (magazine heroStyle, plus
docs `showTableOfContents` which awaits TOC component, and
docs `version` which is partially wired through the header
already) need new components rather than wiring — F.9.2
territory.

### Validation

End-to-end loop holds: operator installs theme, activates,
opens Theme settings panel, toggles a value → save → reload
public site → visible change. The "operator no-code" promise
shipped + delivers immediate feedback for almost every
declared setting.
