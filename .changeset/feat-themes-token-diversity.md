---
"@nexpress/blocks": minor
"@nexpress/core": minor
"@nexpress/theme": minor
"@nexpress/theme-magazine": minor
"@nexpress/theme-portfolio": minor
---

PR B of 3 in the "make defaults look properly designed" cluster.
Themes now ship distinct palettes that actually reach the rendered
page, and the built-in section blocks pick those palettes up via
CSS variables.

**Token wiring**

`getTheme()` in `@nexpress/core` now layers three sources before
serving tokens, last-writer-wins:

1. `DEFAULT_THEME` — framework baseline.
2. The active theme's `impl.tokens` — author-shipped overrides
   (e.g. magazine's warm cream palette, portfolio's dark surface).
3. The DB row in `np_settings.theme` — admin overrides via the
   theme settings tab.

Each layer is a `NpThemeTokensOverlay` (sub-tree-Partial), so a
theme that sets only `colors.primary` doesn't blow away the rest
of `colors`. Previously the active theme's tokens were ignored at
runtime — `getTheme()` only read the DB row, so swapping themes
changed the layout but every theme rendered with the framework
default's indigo+gray palette.

The page-builder preview API (`apps/web/src/app/api/admin/preview-blocks`)
already merged tokens, but did so with a shallow spread that lost
sub-objects whenever a theme overrode only a handful of fields.
Now it calls `getTheme()` so preview and public render resolve to
identical tokens for the same active theme.

**New type**

`NpThemeTokensOverlay` (`@nexpress/core/theme`) — `{ colors?:
Partial<NpThemeColors>; typography?: Partial<NpThemeTypography>;
shape?: Partial<NpThemeShape> }`. Replaces the `Partial<NpThemeTokens>`
shape on `NpThemeImpl.tokens` so authors don't have to copy
unset sub-trees.

**Theme palettes**

- `@nexpress/theme-magazine` ships a warm cream + serif palette
  (terracotta primary, deep brown text on cream background, Source
  Serif Pro fonts). Editorial sites read more comfortably on the
  warm off-white than on pure white.
- `@nexpress/theme-portfolio` moves its dark surface from
  hardcoded `#0b0b0c` CSS into `impl.tokens` (`oklch(0.16 0.005
  285)` background, light foreground). The theme's own CSS now
  reads `var(--np-color-*)` and `color-mix(in oklab, ...)` for
  semi-transparent dividers, so admin token overrides reflow the
  whole shell — flipping to a light variant is a token edit, no
  longer a theme fork.

**Block tokenization**

The five PR-A built-ins (`section-header`, `testimonials`,
`stats-grid`, `logos-cloud`, `tabs`) plus `feature-grid`, `cta`,
`faq` now read brand colors via `var(--np-color-*)` with the
previous hex as the fallback. Drop a `cta` into a portfolio-themed
page: it uses portfolio's primary, not the framework default.

`hero` keeps its hardcoded dark gradient (the gradient is a
readability overlay over a background image, not a brand surface).
`pricing`, `image-gallery`, `contact-form`, `rich-text`,
`grid` weren't visually brand-driven; they're untouched in this
pass.

Existing pages render identically when the active theme doesn't
override tokens — the merge falls through to `DEFAULT_THEME`.
