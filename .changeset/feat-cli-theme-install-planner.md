---
"@nexpress/cli": minor
---

**Phase F.8-A — `nexpress theme:install` planner.**

First half of the v0.2 theme contract's CLI installer (design
doc §4.8). Adds the `theme:install` subcommand to the existing
`@nexpress/cli` package — operators run
`pnpm nexpress theme:install <pkg>` to preview what a theme
expects from the site's collections before any file mutation
lands.

F.8 is split across two PRs because the apply phase carries
the highest implementation risk in the v0.2 extension (AST
patching live operator config files); keeping the planner's
review separate buys the apply phase a focused review.

### What this ships

- `nexpress theme:install <pkg>` — loads the theme module via
  `import(pkg)`, reads `manifest.requires`, walks
  `src/collections/*.ts` for existing slug names, and prints a
  human-readable plan (mirrors the design doc §4.8 example).
- Pure planner (`planThemeInstall`) — the side-effect-free
  diff calculator. Takes manifest + existing slugs +
  pre-computed `checkThemeRequirements` result and emits an
  ordered list of `ThemeInstallStep`s plus blockers.
- Plan formatter (`formatThemeInstallPlan`) — picocolors
  output with create-collection / patch-collection /
  warn-soft-mismatch / blocker sections.
- Args wiring — `theme:install <pkg> [--dry-run] [--yes]`.
  Help text updated.

### What's NOT in this phase

- **Field-level diff** — F.8-A discovers slug names only
  (regex over `src/collections/*.ts`). Loading full collection
  configs (which would surface field-level mismatches via
  `checkThemeRequirements`) requires tsx-based dynamic import
  and ships in F.8-B.
- **AST patching** — F.8-A prints the plan and exits. F.8-B
  ships the ts-morph AST patcher that adds missing fields to
  existing `defineCollection` calls + the new-collection file
  generator + the drizzle-kit subprocess.
- **Confirmation prompt** — current planner exits without
  prompting (the apply step is a stub today). Real prompt +
  apply lands in F.8-B.

### Tests

7 new unit tests in `theme-install/plan.test.ts`:
- isNoop when nothing to do
- create-collection step for missing slug
- patch-collection step for hard missing fields
- warn-soft-mismatch step for soft fields
- blockers list collects type conflicts
- relationship conflict format
- patch-collection skipped when collection itself is being created

Total `@nexpress/cli` tests: 41 (was 34).

### Dependency note

`@nexpress/cli` gains `@nexpress/core` (workspace) + picocolors
deps. Core is needed for `NpThemeManifest` /
`NpThemeRequirementResult` types only — we don't import any
DB-touching modules from core, so the CLI bundle stays small.
The `bin: nexpress` entry point is unchanged; existing scaffold
already wires `@nexpress/cli` as a devDep (line 141 of
`packages/cli/src/templates.ts`) so `pnpm nexpress
theme:install` works in scaffolded sites with no extra setup.
