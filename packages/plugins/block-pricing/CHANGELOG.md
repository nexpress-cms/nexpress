# @nexpress/plugin-block-pricing

## 0.3.10

### Patch Changes

- @nexpress/blocks@0.3.10
- @nexpress/plugin-sdk@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/blocks@0.3.9
- @nexpress/plugin-sdk@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/plugin-sdk@0.3.8
  - @nexpress/blocks@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/blocks@0.3.7
- @nexpress/plugin-sdk@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/plugin-sdk@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/plugin-sdk@0.3.5

## 0.3.4

### Patch Changes

- @nexpress/blocks@0.3.4
- @nexpress/plugin-sdk@0.3.4

## 0.3.3

### Patch Changes

- @nexpress/blocks@0.3.3
- @nexpress/plugin-sdk@0.3.3

## 0.3.2

### Patch Changes

- @nexpress/blocks@0.3.2
- @nexpress/plugin-sdk@0.3.2

## 0.3.1

### Patch Changes

- @nexpress/blocks@0.3.1
- @nexpress/plugin-sdk@0.3.1

## 0.3.0

### Patch Changes

- @nexpress/blocks@0.3.0
- @nexpress/plugin-sdk@0.3.0

## 0.2.2

### Patch Changes

- @nexpress/blocks@0.2.2
- @nexpress/plugin-sdk@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/plugin-sdk@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/plugin-sdk@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/plugin-sdk@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/plugin-sdk@0.1.5

## 0.1.4

### Patch Changes

- @nexpress/blocks@0.1.3
- @nexpress/plugin-sdk@0.1.3

## 0.1.3

### Patch Changes

- @nexpress/blocks@0.1.2
- @nexpress/plugin-sdk@0.1.2

## 0.1.2

### Patch Changes

- 6029918: Add missing `homepage` / `repository` / `bugs` metadata to the six block-plugin packages. Sigstore provenance validation rejects publishes whose `repository.url` doesn't match the OIDC token's source repo, so the CI publish was returning E422 ("repository.url is empty") for these packages even though the OIDC TP auth itself worked. Adding the standard metadata block (matching every other published `@nexpress/*` package) makes provenance validation pass.

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
  - @nexpress/blocks@0.1.1
  - @nexpress/plugin-sdk@0.1.1
