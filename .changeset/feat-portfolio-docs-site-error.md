---
"@nexpress/theme-portfolio": patch
"@nexpress/theme-docs": patch
---

**Portfolio + docs ship theme-flavored public-site error pages.**

Both themes now provide `./components/error` (client subpath) —
the same F.7.1 delegation pattern magazine has used since #466.
The host's `(site)/error.tsx` registers them in `THEME_ERRORS`
alongside magazine, so a 500 in the `(site)` tree renders with
the active theme's chrome instead of the framework's stripped
default.

Closes the trigger-skipped item from the previous
member-surface PR (#631): "portfolio/docs `impl.error` (public-
site error subpath)".

**Portfolio** ships `PortfolioError` — minimal serif heading
("Something didn't load."), uppercase eyebrow, dual CTA ("Try
again" + "Back home"). Matches the rest of the portfolio
member-surface aesthetic (sharp corners, hairline borders,
muted-foreground accents).

**Docs** ships `DocsError` — monospace eyebrow ("500 · docs"),
technical voice ("The page failed to render."), same dual CTA
shape with 0.375rem corners. Matches `DocsMembersError`
visually so the two surfaces feel like one theme.

No change to either theme's `impl.error` field — that's a
forward-compat type marker per the F.7.1 contract; the actual
render goes through the host's lazy-imported client subpath
keyed by the active-theme `<style data-np-theme>` tag.

`default` theme deliberately remains bare — sites running on
`default` still see the framework `DefaultError` when a 500
fires, demonstrating the framework fallback baseline.
