---
"@nexpress/theme-docs": patch
"@nexpress/theme-portfolio": patch
---

Aligns the docs + portfolio masthead/GNB markup and layout with the design-system prototype bundle. Operator-visible changes:

**`@nexpress/theme-docs`** — three corrections to the masthead:

- Header grid now uses `auto 1fr auto` (search fills the free middle track). Previously `minmax(220px, 1fr) minmax(0, 2fr) auto` pinned the brand column at ≥220px and gave the search input less room than the design intends. The search now expands to the full middle track up to its own 520px clamp.
- The brand wordmark's extra `<span class="np-docs-brand-name">` wrapper is gone; the bare `<span>{siteName}</span>` inherits `font-weight: 700` from `.np-docs-brand`. Visual no-op; structural cleanup.
- The conditional GitHub icon link in the header is removed. The design's masthead has three slots (brand / search / primary nav); the GitHub link wasn't one of them. Operators who want a GitHub entry add it to the primary header navigation (Settings → Menus → header), pointing at the same `settings.githubRepo` value. The doc-page footer's "Edit this page" and "Report issue" links continue to read `settings.githubRepo` independently.

Orphan CSS rules (`.np-docs-brand-name`, `.np-docs-github`, `.np-docs-github-link`) are removed.

**`@nexpress/theme-portfolio`** — three corrections to the masthead:

- The desktop nav is now a flat `<ul class="np-portfolio-nav">` directly under the header-inner grid track (matching the design). The previous extra `<nav class="np-portfolio-nav-desktop">` wrapper, the per-`<li>` `np-portfolio-nav-item` class, and the unstyled hover-revealed `<ul class="np-portfolio-subnav">` dropdown are all gone.
- Portfolio's design intent is editorial / studio-minimal — flat single-level nav, no dropdowns. Operators with nested header menus only see the children on mobile now (the drawer continues to surface them via `np-portfolio-mobile-subnav`); on desktop only the top-level items appear. Themes that ship multi-level desktop dropdowns: `default` and `magazine`.

Orphan CSS rules (`.np-portfolio-nav-desktop` in the combined selector + the responsive `display: none`) are removed.

No public-API change in either theme. Class-name coverage baseline in the framework's `builtin-themes-classnames.unit.test.ts` is updated to reflect the dropped portfolio classes.
