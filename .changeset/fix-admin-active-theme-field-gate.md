---
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/app": patch
---

fix(core, next, app): active-theme gate for theme-contributed fields in the admin editor

Magazine-active sites surfaced Portfolio's sidebar group cards on
the post editor — the bundled-themes prebake merges every built-in
theme's `requires.collections.<slug>.fields` into the resolved
config, but only collections / kinds / blocks / patterns were
gated by the active theme. Theme-contributed FIELDS slipped
through, so an operator on Magazine saw "Portfolio" sidebar
chrome anyway.

- `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>`
  on every theme-contributed field (same convention as the
  collection-level and per-kind tags). Operator-declared fields
  carry no origin; they always pass the gate.
- `toClientCollectionConfig(config, activeThemeId)` takes a new
  optional argument and filters out fields whose `_themeOrigin`
  doesn't match. Recurses into `row` / `collapsible` containers;
  drops empty containers after gating.
- The admin's edit + create pages resolve the active theme via
  `getCachedActiveTheme()` and pass the id through.

Bump kind: patch on all three. The `_themeOrigin` field on
`NpFieldBase.admin` is internal-by-convention (never set from
operator config); the optional arg on `toClientCollectionConfig`
is additive.

Tests:
- `merge-requirements.test.ts` — new case asserts `_themeOrigin`
  lands on every theme-contributed field across two themes.
- `client-safe.test.ts` — new suite covering the gate, container
  recursion, empty-container drop, and operator-field pass-through.
