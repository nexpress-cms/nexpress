# @nexpress/core

## 0.2.1

### Patch Changes

- 3fff335: Re-sync `FRAMEWORK_VERSION_FROM_PACKAGE` constant after the 0.1.0 → 0.2.0 fixed-group bump (#666 → #665). The version-sync test caught the drift on the post-merge main CI; this changeset captures the fix so plugin compatibility checks see the correct framework version in published 0.2.x packages.

## 0.2.0

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

## 0.1.0

### Minor Changes

- 952483c: Phase 22.2 — surface known-unsafe configurations at boot via the
  structured logger.

  `@nexpress/core` adds `verifyStartupSafety(input)` (re-exported from
  the package root) — a pure function that takes the resolved storage
  adapter id, the auth secret, `NODE_ENV`, and the `NP_MULTI_NODE` flag,
  and emits warnings through `getScopedLogger({ subsystem: "boot" })`
  for the two operationally-bitten cases:
  - `LocalStorageAdapter` running with `NP_MULTI_NODE=true` (or `=1`),
    which silently drops uploads as nodes diverge on the local
    `./uploads` dir.
  - `NODE_ENV=production` with `NP_SECRET` unset or shorter than 32
    characters, which lets sessions be forged with a weak key.

  `@nexpress/next` calls the helper once per process from
  `createBootstrap()`'s `ensureServices`, so any app using the standard
  bootstrap (apps/web, scaffolded sites) picks the warnings up
  automatically. Operators with `setLogger(...)` already in place get
  the warnings in their structured-log pipeline; others see them on
  stdout via the default `consoleLogger`.

  Returns the list of emitted warning ids so tests can assert on them;
  nothing in production reads the return value.

- 4c01668: Phase 22.4 — readiness probe round-trip for the job queue.

  Adds an optional `isHealthy?(): Promise<boolean>` method to the
  `NpJobQueue` interface and implements it on `PgBossAdapter` via
  `PgBoss.isInstalled()` (a single SELECT against `pgboss.version`).
  Adapters that don't implement it are assumed healthy — the readiness
  probe never fails on a missing answer.

  Before: `/api/health/ready` only checked whether the queue object had
  been set on the singleton. A dead pool, a half-applied schema, or a
  silently-rejected `startProducer()` left readiness reporting `ok` while
  the queue was unusable.

  After: when the wired adapter exposes `isHealthy()`, the probe round-
  trips it and reports `ok: false` + `detail` on failure (and the
  endpoint returns 503, matching the existing degraded-mode contract).
  The pg-boss adapter swallows exceptions internally and returns
  `false`, so callers never see a thrown error.

- 75f65a2: Phase 22.6 — domain-bounded subpath exports for `@nexpress/core`.

  The single root `index.ts` had grown to ~91 export blocks across DB,
  auth, community, jobs, i18n, media, observability, and SEO surfaces.
  For a published package, that's a v1 commitment to the entire mixture.
  This carves the surface into subpath entries so consumers can reach a
  single domain without pulling in the others' types and so future
  deprecations are scoped per domain:
  - `@nexpress/core/auth` — capabilities, JWT, OAuth, sessions
  - `@nexpress/core/community` — comments, reactions, reports, bans, …
  - `@nexpress/core/db` — connection, runtime, schema codegen
  - `@nexpress/core/i18n` — locales, translations, formatting
  - `@nexpress/core/jobs` — pg-boss, handlers, heartbeat, pause
  - `@nexpress/core/media` — service, processor, refs
  - `@nexpress/core/observability` — logger, error reporter, safety check
  - `@nexpress/core/seo` — sitemap, page metadata, JSON-LD

  Additive only — the root `@nexpress/core` continues to re-export
  everything in those domains, so existing call sites do not need to
  migrate. New code should prefer the subpath that fits its call site.

  Two existing aggregator files (`auth/index.ts`, `db/index.ts`) were
  incomplete; they now mirror the root re-exports for their domain.
  Two new aggregators (`i18n/index.ts`, `seo/index.ts`) were added.

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
