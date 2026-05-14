---
"@nexpress/next": patch
"@nexpress/theme-default": patch
"@nexpress/theme-docs": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Theme polish bundle:

- **`@nexpress/next`** ships a new `getCachedSite()` (+
  `siteCacheTag`) so themes can read the operator's site name
  from the `np_sites` row without each one wiring its own DB
  query. Same `unstable_cache` pattern as the other cached
  helpers; tag is `np:site:<siteId>`.
- **`@nexpress/theme-default`** and **`@nexpress/theme-docs`**
  now read the site name from `getCachedSite()` for the
  masthead logo, footer brand, and footer copyright. Operators
  who rename their site in the Setup wizard or in admin no
  longer see "NexPress" baked into the chrome. Empty / missing
  rows fall back to the literal `"NexPress"` so a degraded DB
  doesn't leave the header blank.
- **`@nexpress/theme-magazine`** adds optional
  `leadIssueNumber` to its settings schema. When unset, the
  cover-story figure falls back to an ISO-style week-of-year so
  a fresh install ships with a sensibly rotating counter
  (previously hardcoded to `47`).
- **`@nexpress/theme-portfolio`** restores typecheck on `main`:
  - `socialLinks` added to `portfolioSettingsSchema` (the
    template was rendering it but the schema didn't declare it
    — a regression from #736's self-review).
  - `publishedAt` added to `PortfolioProjectDoc` so the year
    fallback in the project-index template compiles.
  - Removes `gridColumns` / `cardAspect` / `galleryGutter` /
    `hoverStyle` from settings + shell (orphaned by the #736
    redesign — the redesigned card grid uses hardcoded
    per-span `aspect-ratio` and dropped the per-card hover-
    variant data attribute). The auto-form drops these
    sections automatically.

The portfolio settings drop is the only intentionally-breaking
piece here. Operators who had values saved against
`gridColumns` / `cardAspect` / `galleryGutter` / `hoverStyle`
will see them silently ignored on the next save; the strings
weren't doing anything since #736 anyway.
