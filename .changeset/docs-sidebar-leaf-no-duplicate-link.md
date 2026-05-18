---
"@nexpress/theme-docs": patch
---

Docs sidebar — leaf top-level doc no longer renders an eyebrow + a duplicate same-name link below it. A top-level doc that has no children now renders as a single clickable eyebrow (uppercase mono row in the sidebar's group rhythm), with primary-color current state and foreground-color hover. Top-level docs that *do* have children continue to render their eyebrow as a non-interactive section heading above the nested link list — only the leaf case changes.

New class `.np-docs-sidebar-eyebrow-link` inherits the eyebrow's typography (font, color, letter-spacing, text-transform) so the visual rhythm with sibling group eyebrows is preserved; the link is `text-decoration: none` and only changes color on hover / current. Themes that consume the docs CSS string verbatim get the new selector automatically.
