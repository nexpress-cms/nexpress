---
"@nexpress/core": minor
"@nexpress/admin": patch
"@nexpress/web": patch
---

**Phase F.1 — `manifest.requires`: theme data-shape declaration + admin warning surface.**

First implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md`). Themes whose
components assume specific collection fields can now declare
those expectations in their manifest, and the admin theme
switcher reads the declarations to surface mismatches before the
operator clicks "activate".

### Surface added

- `NpThemeManifest.requires` — optional declaration of expected
  collections + fields per collection.
- `NpThemeCollectionRequirement` / `NpThemeFieldRequirement` —
  the type building blocks. Field `type` strings match
  `NpFieldConfig` variants exactly (`"checkbox"`, `"upload"`,
  `"richText"`, etc.) so the runtime check can compare without
  translation.
- `checkThemeRequirements(manifest, collections)` — pure function
  that compares a theme's declared requirements against the
  site's registered collections. Returns structured
  `missingCollections` / `missingFields` / `typeConflicts` /
  `relationConflicts` plus `hasMismatches` and
  `hasHardMismatches` summaries.
- `NpThemeRequirementResult` and friends — the result types,
  exported.

### Admin integration

- `GET /api/admin/themes` now includes a `requirements` field per
  theme entry summarizing the check result. The check runs
  in-memory only (no DB), so listing cost is unchanged.
- The theme switcher (`packages/admin/src/settings/theme-switcher.tsx`)
  surfaces a warning chip + summary line on each theme card
  with mismatches, including a copy of the
  `pnpm nexpress theme:install <id>` command operators will run
  in Phase F.8 to resolve. Hard requirements show as destructive
  (red); soft (`hard: false`) as amber.

### Soft vs hard

Field requirements default to `hard: true`. Set `hard: false`
when the theme degrades gracefully without the field — admin
shows a softer warning, and the future Phase F.8 CLI may treat
soft fields as opt-in patches.

### What's not in this phase

Per the design doc:

- The `pnpm nexpress theme:install` CLI that AST-patches
  collections to satisfy these requirements is **Phase F.8**.
  F.1 only ships the contract type + admin warning surface.
- Activation is not blocked by mismatches — the operator can
  still activate a theme with warnings (and might choose to do
  so during dev). The warning is informational.

### Tests

9 unit tests covering: no-requires no-op, missing collection,
missing field, soft-vs-hard severity routing, type conflict on
existing field, relationship target mismatch, relationship
target subset acceptance, row+collapsible field walker, and
array/group sub-record non-descent.

Total core tests: 291 (was 282).
