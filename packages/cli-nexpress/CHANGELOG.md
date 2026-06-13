# @nexpress/cli

## 0.3.18

### Patch Changes

- @nexpress/core@0.3.18

## 0.3.17

### Patch Changes

- 3d69724: Add the first agent-operated ops status contract, scaffold wiring, and `nexpress ops status` handoff.
- ec64d83: Add read-only executable runbooks.

  Generated apps now include a `runbook` script. `nexpress runbook <name>` emits
  `schemaVersion: "np.runbook.v1"` with evidence, diagnosis, risk, next commands,
  rollback notes, and docs links for worker drain, storage migration, backup drill,
  and migration-crash incident paths.

- 93370bd: Add read-only migration and backup readiness checks for agent-operated release gates.

  Projects now get `ops:migrate` and `ops:backup` scripts, exposed through
  `nexpress ops migrate status|plan` and `nexpress ops backup status|list|verify
latest`. `release check` includes migration safety and required backup
  readiness evidence, while migration and backup runbooks use the dedicated checks.

- 55b9834: Add the agent-operated jobs status check with worker heartbeat, pause state,
  and queue count reporting.
- 696129f: Expand the agent-operated ops loop with `ops preflight`, `ops health`, and
  `nexpress ops doctor` handoffs for generated projects.
- 1fedc19: Add initial ops mutation adapters.

  `nexpress ops backup create` now records an operator-provided backup manifest,
  and `nexpress ops jobs pause|resume` now persists the global jobs pause state
  with mutation audit details in the `np.ops-jobs.v1` report.

- 9d2b25d: Add read-only ops storage and plugin diagnostics.

  Generated apps now include `ops:storage` and `ops:plugins` scripts. The
  project CLI delegates `nexpress ops storage status`, `nexpress ops plugins
list`, and `nexpress ops plugins doctor` to those scripts so agents and
  operators can inspect storage readiness, local media drift, plugin inventory,
  and static plugin conflicts through stable JSON contracts.

- 164889c: Add approval-gated release apply audit artifacts.

  `nexpress release apply --plan <artifact>` now validates a release plan and
  writes a stable `np.release-apply.v1` audit artifact. It dry-runs by default,
  and command execution requires both `--execute` and `--approve <planId>`.

- d704baf: Add release plan audit artifacts.

  `nexpress release plan --target <host>` now runs the pre-release gate and writes
  a stable `np.release-plan.v1` artifact under `.nexpress/releases/` by default,
  including remediation, release, and verify commands plus apply preconditions.

- c602c0f: Add read-only release readiness gates.

  Generated apps now include a `release` script. `nexpress release check`
  combines deploy preflight, jobs, storage, and plugin diagnostics into
  `schemaVersion: "np.release.v1"` before a release. `nexpress release verify`
  combines health, jobs, storage, and plugin diagnostics into the same stable
  envelope after deployment.
  - @nexpress/core@0.3.17

## 0.3.16

### Patch Changes

- @nexpress/core@0.3.16

## 0.3.15

### Patch Changes

- @nexpress/core@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/core@0.3.13

## 0.3.12

### Patch Changes

- @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/core@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/core@0.3.9

## 0.3.8

### Patch Changes

- b331118: Add bundled analytics-lite and webhook-relay plugin examples, and derive admin,
  page-route, and scheduled-task capabilities from `definePlugin()` declarations.
  Also derive page-route and scheduled-task catalog metadata and add typed admin
  action result helpers. Add plugin storage append/listValues helpers for
  event-log style plugin data. Add typed admin action registration helpers and
  pass the runtime context into action handlers. Update plugin scaffolds/tests
  around the newer authoring surface and document the `allowedHosts: ["*"]`
  escape hatch for operator-configured integration endpoints.
- Updated dependencies [b331118]
  - @nexpress/core@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/core@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/core@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/core@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [07c763b]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
  - @nexpress/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [ab3afa7]
  - @nexpress/core@0.3.0

## 0.2.2

### Patch Changes

- e733d47: Replace `pnpm nexpress theme:install <pkg>` with a friendlier two-piece flow: framework-side auto-merge of theme requirements at config-resolution time, plus a single `pnpm nexpress theme add <pkg>` command for installation + registration.

  **`@nexpress/core`** — `defineConfig` now walks every theme on `config.themes` and unions each theme's `manifest.requires.collections` into the resolved `collections` array. For each existing collection slug, the theme's declared fields are appended to that collection's `fields` (operator-authored fields with the same name always win, so the merge is non-destructive). For slugs that don't yet exist AND the theme set `createIfAbsent: true`, a minimal collection is synthesised. The merge is exposed as `mergeThemeRequirements(collections, themes)` for tooling that wants to introspect the resolved shape without going through `defineConfig`.

  **`@nexpress/cli` (`@nexpress/cli-nexpress`)** — new `nexpress theme add <pkg>` command: runs `pnpm/yarn/npm add`, AST-patches `nexpress.config.ts` via two new marker pairs (`@nexpress:themes-imports-start/-end` + `@nexpress:themes-list-start/-end`), and probes the installed package's export shape to confirm it ships a `<name>Theme` named export. `--apply` chains `db:generate` + `db:migrate`; `--dry-run` prints the plan; `--yes` skips the prompt. The legacy `theme:install` command and its AST-patcher (`extract-collection`, `patch-collection`, `generate-collection`) are removed — the auto-merge replaces every reason to touch operator collection files. `theme:uninstall` keeps working unchanged.

  **`@nexpress/admin`** — Themes page guidance no longer suggests `theme:install`. When `checkThemeRequirements` still flags missing fields after the auto-merge (only possible when an operator-declared field has a conflicting TYPE), the hint surfaces the conflicting types and points at `src/collections/*.ts`. Otherwise the hint is the plain `pnpm db:generate && pnpm db:migrate` reminder.

  **`create-nexpress`** — scaffolded `nexpress.config.ts` ships with the new `@nexpress:themes-imports-*` and `@nexpress:themes-list-*` markers so future `theme add` invocations have anchors out of the box.

  **`@nexpress/theme-magazine` / `@nexpress/theme-portfolio`** — their `requires.collections.posts.*Image` upload fields now declare `relationTo: "media"` explicitly. Without it `mergeThemeRequirements` silently skipped the field (no scalar relation target), so the column never landed in the generated schema and the theme's hero/cover slot rendered against an empty value. The merge layer keeps the warning for any other upload requirement missing `relationTo` to surface the same gap in third-party themes.

  Operator-visible migration:

  ```bash
  # Before
  pnpm nexpress theme:install @nexpress/theme-magazine     # ran AST patches on src/collections/*.ts
  pnpm db:migrate

  # After
  pnpm nexpress theme add @nexpress/theme-magazine         # only edits nexpress.config.ts
  pnpm db:generate && pnpm db:migrate                       # (or `theme add --apply` to chain)
  ```

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/core@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/core@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/core@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/core@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3

## 0.1.2

### Patch Changes

- @nexpress/core@0.1.2

## 0.1.1

### Patch Changes

- e062ed7: **0.1.1 — post-launch cleanup + first-time UX.**

  Bundles every change since the v0.1.0 first publish into one patch
  release. The npm registry stays on the 0.1.x track; 0.2.0 was
  attempted (and the version-PR landed locally) but the CI publish
  failed end-to-end due to npm 10 not supporting Trusted Publishing
  (npm 11.5.1+ required) — fixed in the release workflow, but the
  0.2.0 bump itself was premature for the size of changes shipped.

  ### `@nexpress/core`
  - `getPluginConfig` read/write asymmetry fixed (#664). `setPlugin`
    writes to `np_settings` for any pluginId; `getPluginConfig` now
    reads it back regardless of whether the plugin is registered.

  ### `@nexpress/admin`
  - Empty-state CTA on `/admin/collections/<slug>` (#666). Truly-empty
    collections render a "Create your first \<singular>" card instead
    of the generic "No documents found" line.
  - Dashboard welcome card → 5-step setup checklist (#666). Tracks
    site name set / first post published / theme chosen / production
    domain set.
  - Topbar user-menu trigger now has `aria-label="Open user menu"`
    (#664) so the e2e selector matches a stable accessible name.

  ### `@nexpress/theme-magazine`, `@nexpress/theme-portfolio`
  - `padding-inline-start` instead of `padding-left` on mobile sub-nav
    lists (#664). Makes RTL locales render with the correct leading
    edge.

  ### Internal (no operator-facing change)
  - Drizzle migration history squashed to a single `0000_init.sql`
    (#646). New installs run one migration to reach the v0.1 schema.
  - Repository transferred from `hahabsw/nexpress` to
    `nexpress-cms/nexpress` (#647). `repository.url` metadata updated
    across every published package.
  - Release workflow: `publish: pnpm run release` restored + npm 11+
    installed before publish so Trusted Publishing actually
    authenticates (#670). The v0.2.0 attempt's E404 was npm 10 not
    supporting the OIDC TP token, not a TP-config mistake.
  - CI noise reduction: docs / changesets / community-file paths
    no longer trigger main-push CI; E2E gated to PRs only.

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
