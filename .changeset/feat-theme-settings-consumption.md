---
"@nexpress/theme-magazine": minor
"@nexpress/theme-portfolio": minor
---

**Phase F.9.1-A — theme components read `getThemeSettings`.**

Closes the most operator-visible v0.2 follow-up: the
`settingsSchema` field validates and persists, but until now
the rendered themes still used hardcoded defaults — operator
toggles in admin → no site change. This PR wires the visible
settings through to the components.

### Magazine theme — 3 wirings

- `resolveMagazineSettings()` typed helper (mirrors docs theme).
- **`settings.newsletterEnabled`** — toggles the entire
  Subscribe column in the footer. Operators with private/
  paywalled sites flip it off and the column disappears.
- **`settings.socialLinks`** — renders a list of social links
  in the footer's Colophon column when populated. Empty array
  (default) hides the list entirely.
- **`settings.showAuthorByline`** — toggles the byline rule on
  the long-form post template (`PostFeatureTemplate`).
  Editorial preference; defaults to true to match prior
  behavior.

### Portfolio theme — 3 wirings

- `resolvePortfolioSettings()` typed helper.
- **`settings.studioName`** — replaces the hardcoded "NexPress
  Studio" brand label in the masthead and is reused in the
  footer's colophon. Default: "Studio".
- **`settings.gridColumns` + `settings.galleryGutter`** — drive
  the project-index template's grid layout via inline
  `gridTemplateColumns: repeat(N, 1fr)` + `gap`. Operators
  pick 1–6 columns + 0–64px gutter from admin without editing
  CSS.
- **`settings.showFooterCredit` + `settings.copyrightYear`** —
  toggle the "Built with NexPress" credit and override the
  auto-detected year. Studios pin the year to "established"
  date or strip the framework credit per their preference.

### What's still hardcoded (deferred to F.9.1-B)

Magazine settings:
- `heroStyle` (enum: featured / carousel / grid) — would
  require swapping the homepage hero component; current
  template stays single-style.
- `accentColor` — would need to override the `--np-color-primary`
  CSS variable; touches the CSS layer rather than the
  component layer.
- `postsPerPage` — apply in `CategoryArchive` / `AuthorArchive`
  (currently hardcoded at 10).

Portfolio settings:
- `cardAspect` (square / portrait / landscape / golden) — needs
  CSS variable + card component change.
- `hoverStyle` (fade / scale / slide / lift) — same, CSS
  variants.
- `showProjectMeta` / `showProjectTags` — apply in project-detail
  + project-card.
- `accentColor` — same as magazine.
- `aboutCopy` — needs an about-page surface (template + slot).
- `clientLogos` — needs a homepage strip component.

These are tracked as F.9.1-B; the contract surface is shipped,
the rendering wiring continues.

### Validation

Operators can now run, in order:

```
pnpm nexpress theme:install @nexpress/theme-magazine
pnpm db:migrate
# admin → activate magazine → Theme settings tab
# Toggle "newsletterEnabled" off → save → reload public site
# Footer's Subscribe column disappears
# Toggle back on → reappears
```

Same loop works for portfolio's 3 wirings. The "operator
no-code" promise now has visible site changes from settings
toggles.
