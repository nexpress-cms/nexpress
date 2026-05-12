# @nexpress/core

## 0.1.3

### Patch Changes

- bb6f71c: Remove `prepublishOnly: "pnpm build"` from every package. The script
  ran each package's tsup (with `--clean`) in parallel during
  `changeset publish`, so siblings' `dist/` got wiped mid-build and
  the DTS step couldn't find sibling type declarations. The root
  `pnpm release` already runs `pnpm build` upfront, so the
  per-package safety net was redundant AND racy.

## 0.1.2

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
