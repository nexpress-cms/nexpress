# @nexpress/admin

## 0.2.1

### Patch Changes

- Updated dependencies [3fff335]
  - @nexpress/core@0.2.1
  - @nexpress/blocks@0.2.1
  - @nexpress/editor@0.2.1

## 0.2.0

### Minor Changes

- b37aba7: **First-time UX (items 1 + 2 of 5).**
  1. **Collection list empty-state CTA.** `/admin/collections/<slug>` used to show "No documents found." for both "operator hasn't created any yet" and "no docs match the current filter". Truly-empty collections (no `search` / `status` filter active) now render a centered "Create your first <singular>" card with a primary action button. Filtered-empty collections keep the old behavior.
  2. **Dashboard welcome card → 5-step checklist.** Replaces the single welcome message (#618) with a 5-step setup checklist that reads its state from new `DashboardStats.onboarding` flags:
     - ✓ Admin account created (always true if the page renders)
     - Name your site (`np_sites.name !== "Default site"`)
     - Publish your first post (`np_c_posts` count > 0 with `_status='published'`)
     - Pick a theme (`activeTheme !== "default"`)
     - Connect a production domain (`SITE_URL` is not localhost)

     The card hides only when every step is ✓, so the operator always has a single place that says what's left.

### Patch Changes

- 1221e84: **Fix two pre-existing CI failures exposed once push-time triggers were
  restored** (#640).

  ### `getPluginConfig` read/write asymmetry

  `ctx.settings.setPlugin(data)` writes to `np_settings` for any
  `pluginId`, regardless of whether the plugin is registered in the
  in-process host. But `getPluginConfigWithStatus` short-circuited with
  `{ value: {}, hasPersisted: false }` whenever registration was missing,
  **before** querying the table — so the stored row was silently
  unreadable.

  The asymmetry surfaced as the `ctx-settings` integration test failing
  with `expected {} to deeply equal { apiKey: 'abc', refreshInterval:
60 }`. Real-world impact is bigger: a plugin that registers later than
  the first read (HMR re-boot, dynamic plugin install) loses access to
  its own persisted config until restart.

  Fix: drop the early return on missing registration. Treat
  "unregistered" the same as "registered without `configSchema`":
  surface the row raw if it exists, return empty if it doesn't.
  Validation paths that require a schema still gate on
  `if (!schema)` — semantics there are unchanged.

  ### E2E admin sign-in flow

  `tests/e2e/auth.spec.ts` waited 30s for a button matching
  `/E2E Admin/` in the topbar dropdown, but the topbar shows only the
  first word of `user.name` (`"E2E"`), so the regex never matched the
  button's accessible name.

  Fix: add `aria-label="Open user menu"` to the dropdown trigger in
  `admin-topbar.tsx` and switch the test to locate by that stable
  label. The visible-text behavior is unchanged.

- Updated dependencies [1221e84]
  - @nexpress/core@0.2.0
  - @nexpress/blocks@0.2.0
  - @nexpress/editor@0.2.0

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
  - @nexpress/blocks@0.1.0
  - @nexpress/editor@0.1.0
