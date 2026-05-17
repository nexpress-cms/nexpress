---
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Add CSS for the two visible-bug surfaces flagged when the `className ↔ CSS coverage` test (#801) gate landed:

- **Magazine `magazine.hero-feature` page-builder block** — the registered hero block (carousel + grid layouts) had no CSS, so operators who added it from the page builder saw unstyled markup. Adds full styling for the header, CTA, carousel track (with scroll-snap), grid tiles (responsive auto-fit), and card category labels — matching magazine's editorial serif palette.
- **Portfolio `/work/:slug` project-detail template** — public-facing project detail rendered with no CSS. Adds hero image (16:9 cover), display-serif title + body excerpt, optional client/role/year meta `<dl>`, and a max-width content body with full-bleed image override.

Lint baseline trimmed by 17 entries (11 magazine + 6 portfolio). The gate continues to fail if new unstyled classes appear.
