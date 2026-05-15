---
"@nexpress/core": patch
"@nexpress/app": patch
---

fix(admin): hide per-kind sidebar entries whose contributing theme isn't active

The bundled-themes prebake unions every built-in theme's
`requires.collections.<slug>.kinds` onto `admin.kinds`. Without
a per-kind theme-origin gate, an operator running the `default`
theme would still see a "Documentation" entry under Content
because `theme-docs`'s `kinds.doc` landed on `posts.admin.kinds`
during the merge.

Fix mirrors the existing collection-level `_themeOrigin`
pattern: `mergeThemeRequirements` now stamps `_themeOrigin` on
each merged kind entry, and the admin layout's projection
filters kinds whose origin doesn't match the active theme id.
Operator-declared kinds (no origin tag) always show.

Tests: `core` 442/442 (+1 covering the origin stamp), `web`
85/85 (builtin-themes-union gate unchanged).
