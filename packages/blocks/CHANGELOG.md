# @nexpress/blocks

## 0.3.25

### Patch Changes

- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/core@0.3.25
  - @nexpress/editor@0.3.25

## 0.3.24

### Patch Changes

- @nexpress/core@0.3.24
- @nexpress/editor@0.3.24

## 0.3.23

### Patch Changes

- @nexpress/core@0.3.23
- @nexpress/editor@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/editor@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/editor@0.3.21

## 0.3.20

### Patch Changes

- @nexpress/core@0.3.20
- @nexpress/editor@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/core@0.3.19
- @nexpress/editor@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/core@0.3.18
- @nexpress/editor@0.3.18

## 0.3.17

### Patch Changes

- 6d55e54: Keep nested array block props editable in the block editor so docs API table rows can edit their cells without JSON fallback.
  - @nexpress/core@0.3.17
  - @nexpress/editor@0.3.17

## 0.3.16

### Patch Changes

- @nexpress/core@0.3.16
- @nexpress/editor@0.3.16

## 0.3.15

### Patch Changes

- @nexpress/core@0.3.15
- @nexpress/editor@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/editor@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/core@0.3.13
- @nexpress/editor@0.3.13

## 0.3.12

### Patch Changes

- Updated dependencies [f4c483c]
- Updated dependencies [fb4ba86]
  - @nexpress/editor@0.3.12
  - @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/core@0.3.11
- @nexpress/editor@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/editor@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/core@0.3.9
- @nexpress/editor@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/editor@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/core@0.3.7
- @nexpress/editor@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/core@0.3.6
- @nexpress/editor@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/core@0.3.5
- @nexpress/editor@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/editor@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/editor@0.3.2

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
  - @nexpress/editor@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [ab3afa7]
- Updated dependencies [f36c0f2]
  - @nexpress/core@0.3.0
  - @nexpress/editor@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/core@0.2.1
- @nexpress/editor@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/core@0.1.6
- @nexpress/editor@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/core@0.1.5
- @nexpress/editor@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/editor@0.1.3

## 0.1.2

### Patch Changes

- @nexpress/core@0.1.2
- @nexpress/editor@0.1.2

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
  - @nexpress/editor@0.1.1

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.

### Patch Changes

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
  - @nexpress/editor@0.1.0
