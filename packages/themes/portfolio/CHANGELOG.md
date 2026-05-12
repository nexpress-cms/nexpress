# @nexpress/theme-portfolio

## 0.1.1

### Patch Changes

- 1221e84: Use logical RTL-safe `padding-inline-start` instead of `padding-left` for mobile sub-nav lists in `theme-magazine` and `theme-portfolio`. The default theme already used logical properties; this brings the v0.2 reference themes into alignment so RTL locales render correctly.
- Updated dependencies [1221e84]
  - @nexpress/core@0.2.0
  - @nexpress/blocks@0.2.0
  - @nexpress/next@0.2.0
  - @nexpress/theme@0.2.0

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
  - @nexpress/next@0.1.0
  - @nexpress/blocks@0.1.0
  - @nexpress/theme@0.1.0
