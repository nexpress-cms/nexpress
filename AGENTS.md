# AGENTS.md

This file provides guidance to Agents when working with code in this repository.

**Last refreshed:** 2026-07-11 (XLIFF 1.2 now round-trips Lexical rich text
through protected inline codes. Import validates live source paths, ordering,
and text before replacing leaves, preserving formatting and non-text nodes.)

**Earlier:** 2026-07-11 (the remaining plugin definition surfaces are
now contract-complete: page templates, ICU translations, config/lifecycle
callbacks, teardown/reload cleanup, and doctor inventories share validated
runtime rules. The never-implemented custom-field registration surface was
removed.)

**Earlier:** 2026-07-11 (plugin page-builder patterns now share one
validated recursive definition and block-reference contract across blocks, the
SDK, Next bootstrap, the shared registry, and plugin doctor. Bootstrap assigns
concrete sources and registers all blocks before patterns.)

**Earlier:** 2026-07-10 (plugin scheduled tasks now share one validated
definition across the SDK, core host, pg-boss registration, and plugin doctor.
Invalid cron expressions, duplicate task ids, and non-void results fail
explicitly; schedules use five-field UTC cron.)

**Earlier:** 2026-07-10 (plugin blocks now share one validated
definition and props-schema contract across blocks, the SDK, Next bootstrap,
the shared registry, and plugin doctor. Invalid and same-plugin duplicate
definitions fail before registration.)

**Earlier:** 2026-07-10 (plugin page routes now share one validated
pattern and definition contract across the SDK, core host, Next dispatcher,
and plugin doctor. `locale: "none"` matches the raw URL and omits automatic
hreflang aliases.)

**Earlier:** 2026-07-10 (plugin API routes now share a typed core/SDK
request and response contract. Definition and host validation reject malformed
or duplicate static routes, handler results are validated before dispatch, and
GET registrations also serve bodyless HEAD responses.)

**Earlier:** 2026-07-10 (plugin content, auth, media, and render hooks
now share one typed hook registry. Lifecycle payloads are exact per name,
validated at dispatch, and fire-and-forget handlers must return void.)

**Earlier:** 2026-07-10 (plugin render contributions now use the single typed
`render:beforePage` hook for both `head` and `bodyEnd`; definition-time hook
validation rejects unsupported names and malformed descriptors.)

**Earlier:** 2026-07-10 (plugin Admin actions now support a definition-level
typed registry, while setup-time `ctx.actions.register*` remains the
compatibility path.)

**Earlier:** 2026-06-17 (docs-currentness pass — `CLAUDE.md`
now delegates here, `apps/web/AGENTS.md` reflects the thin
`@nexpress/app` wrapper structure, CI/Release notes match the active
GitHub workflows, and plugin `surface: "member"` route docs reflect
the shipped member-shell wrapping.)

**Earlier:** 2026-05-05 (post `np` prefix migration — every public
framework-owned `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` identifier moved to
`np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. Package names `@nexpress/*` are
unchanged. See `.changeset/breaking-np-prefix-rename.md` for the migration
runbook.)

## Naming convention

The framework reserves a single prefix for every symbol/identifier it
owns: **`np` / `Np` / `NP_` / `np_` / `np-` / `--np-`**. The choice of
casing follows the host language:

| Layer                                    | Form                                                   | Example                                               |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| TypeScript type / interface / class      | `Np<Capital>`                                          | `NpAuthUser`, `NpForbiddenError`, `NpBlockDefinition` |
| Runtime variable / function              | `np<Capital>`                                          | `npFetch`, `npUsers` (Drizzle), `npMedia`             |
| Environment variable                     | `NP_<UPPER>`                                           | `NP_SECRET`, `NP_S3_BUCKET`                           |
| Database table                           | `np_<lower>`                                           | `np_users`, `np_settings`, `np_c_posts`               |
| Cookie / HTTP header                     | `np-<lower>` / `x-np-<lower>`                          | `np-session`, `x-np-admin-site`                       |
| CSS custom property                      | `--np-<lower>`                                         | `--np-color-primary`, `--np-radius-md`                |
| CSS class / `@layer` / `data-` attribute | `np-<lower>` / `@layer np-<lower>` / `data-np-<lower>` | `.np-form-input`, `@layer np-theme`, `data-np-theme`  |

Package names use the brand name `@nexpress/*` and stay as-is — they're
orthogonal to the `np` prefix.

Compatibility exception: older internal Next data-cache tags and Redis
rate-limit keys still use the `nx:*` namespace (`nx:sitemap`,
`nx:theme:<siteId>`, `nx:rl:`, etc.). Keep those where the implementation
and docs already name them; do not introduce new public `nx` identifiers.

## Commands

Package manager is pnpm (v10.33, required). Node >=20.

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d       # Postgres :5433 + Mailpit (SMTP :1025, inbox http://localhost:8025)
cp .env.example .env                                    # DATABASE_URL, NP_SECRET, SITE_URL, SMTP defaults pointing at Mailpit
pnpm build                                              # build all packages (dist/) — needed before dev
pnpm dev                                                # next dev (apps/web only) + collection schema:gen on src/collections/* changes
```

### Dev workflows (which `dev` to run)

`pnpm dev` watches **only `apps/web`** (next dev + schema-gen).
Other packages serve from their last-built `dist/`. This keeps the
process count and memory footprint sane — the full-watch shape we
shipped before brought 30 `tsup --watch` instances and ~3 GB of
resident watcher memory.

- **Default — app-level work in `apps/web/src/*`:**
  ```bash
  pnpm install && pnpm build   # one-time, builds every package
  pnpm dev                     # next dev only; subsequent runs skip the build
  ```
- **Editing a leaf package — `@nexpress/admin`, `@nexpress/blocks`, etc.:**
  ```bash
  pnpm --filter @nexpress/admin... dev
  ```
  The `...` expands to that package + every workspace dep. Watcher count scales with the slice you actually touched.
- **Cross-package refactor — every `dist/` should rebuild on save:**
  ```bash
  pnpm dev:full                # current full-fan-out behavior
  ```
  Heavy (~30 watchers, ~3 GB RSS) — reach for it when you really do need everyone watching at once.

When a leaf package changes and you used the default `pnpm dev`, the leaf's `dist/` is stale. Either rebuild that leaf (`pnpm --filter <pkg> build`) or switch to the `... dev` filter for the rest of the session.

- `pnpm build` / `pnpm test` — turbo fan-out over all workspaces. `pnpm dev` is now scoped to apps/web (see above).
- `pnpm lint` — fans out via `turbo run lint --concurrency=2`. Each package runs `eslint . --cache --cache-location node_modules/.cache/eslint`, so the heavy `recommendedTypeChecked` rule set's TS programs stay bounded per process and incremental runs hit cache. The previous root `eslint .` over 1000+ files OOMed at an 8 GB heap; the per-package fan-out caps peak RSS at ~1.2 GB. Use `pnpm --filter <pkg> lint` to target one package, or `turbo run lint --filter=<pkg>...` for a dependency-aware subset.
- `pnpm typecheck` — `turbo run typecheck`, which runs `tsc --noEmit` in each package. Distinct from `pnpm lint` (ESLint).
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations (turbo tasks; wired per-app)
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` runs the vitest unit suite across every workspace (no DB required). `pnpm test:integration` runs the Postgres-backed suite, gated on `TEST_DATABASE_URL` (skips silently when unset). See `docs/testing.md` for setup.
- `pnpm verify` — pre-merge gate. Runs `turbo run build typecheck test` in one shot. CI also runs on PRs and selected `push: main` changes (see NOTES below), but this is still the fastest local equivalent — run it before merging anything that touches schema, migrations, codegen, or risky surface a typecheck-only pass might miss (#586). Cheap thanks to turbo caching when you've been building during dev.
- `pnpm changeset` opens the changesets prompt — run it whenever you make a user-facing change to a `@nexpress/*` package (Phase 22.1). The generated file in `.changeset/` is committed with the code. See `.changeset/README.md` for the rule of thumb on when a changeset is needed.

Running a single package's build/typecheck:

```bash
pnpm --filter @nexpress/core build
pnpm --filter @nexpress/core typecheck # tsc --noEmit for just that package
```

## Architecture

Monorepo: `packages/*` (library code) + `apps/web` (Next.js 16 reference app). Workspaces are declared in `pnpm-workspace.yaml`. Turborepo orchestrates builds; `^build` in `turbo.json` means dependent packages are built first.

### Dependency graph

```
core  ←  editor, theme, plugin-sdk, next, wp-import
core, editor  ←  blocks
core, editor, blocks  ←  admin
all of the above  ←  apps/web
cli  (standalone scaffolder, no workspace deps)
```

`@nexpress/core` is **server-only**. It imports `pg`, `sharp`, `@node-rs/argon2`, `pg-boss`, `jose`. `apps/web/next.config.ts` declares it in `serverExternalPackages`; all other `@nexpress/*` packages live in `transpilePackages`. Do not import `@nexpress/core` from a client component — it will break the build.

#### Subpath imports (preferred for new code)

`@nexpress/core` exposes domain-bounded subpath entries (Phase 22.6). New code should reach in through the subpath that fits the call site rather than the catch-all root, so the v1 commitment surface is bounded by domain:

| Subpath                        | Domain                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| `@nexpress/core/auth`          | capability checks, JWT/OAuth, password, sessions, principal           |
| `@nexpress/core/community`     | comments, reactions, follows, reports, bans, audit, mentions, digests |
| `@nexpress/core/db`            | connection factory, runtime accessors, schema codegen                 |
| `@nexpress/core/i18n`          | locale registry, translations, formatting, per-site overrides         |
| `@nexpress/core/jobs`          | pg-boss adapter, handlers, worker, heartbeat, pause state, job logs   |
| `@nexpress/core/media`         | media service, processor, ref tracking                                |
| `@nexpress/core/observability` | logger, error reporter, `verifyStartupSafety`                         |
| `@nexpress/core/seo`           | sitemap, page metadata, Atom feeds, JSON-LD                           |

The root `@nexpress/core` keeps re-exporting everything for back-compat; existing call sites are not forced to migrate. Treat the root as the lowest-common-denominator surface and the subpaths as the canonical domain APIs.

### Module system — `.js` extensions in TS imports

All packages set `"module": "NodeNext"` and `"type": "module"`. Relative imports inside packages must use `.js` extensions even in `.ts` source:

```ts
import { foo } from "./bar.js"; // correct
import { foo } from "./bar"; // breaks the build
```

Package-to-package imports use the bare specifier (e.g. `from "@nexpress/core"`) and resolve through each package's `exports` map to `dist/`. That means **consumers need `dist/` to exist** — if a package rebuild hasn't finished, sibling packages will fail to type-check. Run `pnpm build` once after fresh clone; `pnpm dev` keeps dists fresh with `tsup --watch`.

Dev watch reads `NP_DEV_FAST` from `.env` (default `1`); when set, each package's `tsup.config.ts` skips dts emit and sourcemaps during the watch loop (the dts step alone runs a full type emit per package and dominates startup). Sibling packages keep using the `.d.ts` files from the last `pnpm build` — runtime is unaffected, but if you change an exported type's _signature_ during dev, IDE/typecheck won't see it across packages until the next `pnpm build` (or a targeted `pnpm --filter @nexpress/<pkg> build`). `pnpm build` defensively prefixes `NP_DEV_FAST=0`, so the published `dist/` always ships with full dts regardless of `.env`.

### Core service singletons (critical)

`@nexpress/core` exposes a module-scoped singleton pattern:

- `setDb(db)` / `getDb()` — Drizzle connection (single source of truth shared by the pipeline, media service, and every other consumer)
- `setStorageAdapter(adapter)` — local or S3
- `setJobQueue(queue)` / `startWorker()` — pg-boss
- `loadPlugins(plugins)` — registers hooks/routes/actions

The reference app wires these up in `apps/web/src/lib/init-core.ts`. New code should use the single intent-based entry point `ensureFor("read" | "plugins" | "write")`:

- `await ensureFor("read")` — DB + storage + collections (read-only RSC, GET routes).
- `await ensureFor("plugins")` — read + plugin loading (render paths that need `runHook` to fire).
- `await ensureFor("write")` — plugins + email + pg-boss producer (any mutating API route / server action / import).

All app routes use `ensureFor` directly — the old route-level pattern of
choosing among `ensureCoreServices` / `ensurePluginsLoaded` /
`ensureJobProducer` / `ensureWriteReady` was retired in #266. The
`createBootstrap()` result still exposes low-level compatibility helpers for
the app adapter, but new route or server-component code should not call them
directly. Any route or server component touching collections, media, or
plugins MUST initialize before reading the singletons; otherwise they're null.
Don't create parallel DB connections from elsewhere.

### Collections = codegen, not runtime

Collections are declared with `defineCollection({ slug, fields, ... })` and registered with `registerCollection()`. The Drizzle schema and TypeScript types are **generated** from these configs:

- `packages/core/src/db/generator.ts` → `generateDrizzleSchema()`
- `packages/core/src/db/type-generator.ts` → `generateTypeScript()`

Adding or changing a collection's fields requires regenerating the schema and running a migration. The Drizzle schema codegen step (`pnpm schema:gen`, which writes `src/db/generated/collections.ts`) runs automatically inside `pnpm dev` whenever a file under `src/collections/` or `src/nexpress.config.ts` changes (#271). The Postgres migration is still manual (`pnpm db:generate && pnpm db:migrate`) so the SQL gets a human review before it touches the DB. A user project's collections live in `src/collections/` (see the `create-nexpress` scaffold); for this monorepo itself, collections for the reference app live in `apps/web/src/collections/`.

The data pipeline (`packages/core/src/collections/pipeline.ts`) handles access control, hook invocation, validation via generated Zod schemas (`validation.ts`), revision tracking, media-ref tracking, and search-vector builds for every document write.

### Plugin model (v1)

For original rationale see `docs/design/plugin-system-design.md` (frozen 2026-04-17 snapshot — high-level decisions still apply, code samples may have drifted). v1 plugins are **npm-package + rebuild**, not hot-loadable. A plugin can register hooks (`content:afterCreate`, etc.), actions (custom API handlers), routes, **public-site page routes** (`definePlugin({ pageRoutes: NpPluginPageRouteRegistration[] })` — see `docs/plugin-pages.md`), scheduled tasks, and **page builder blocks** (`definePlugin({ blocks: NpBlockDefinition[] })`) at startup. It **cannot** add collections/fields at runtime — those require codegen + migrate. Plugins run in-process with full Node access; there is no sandbox in v1. Author plugins with `definePlugin()` from `@nexpress/plugin-sdk`.

Plugin-contributed blocks merge into the same shared registry as the built-ins (`@nexpress/blocks`'s `getSharedRegistry()`). `definePlugin()`, the Next bootstrap, `registerBlock()`, and plugin doctor use the same canonical definition/props-schema validator; malformed blocks and same-plugin duplicates fail before registration. The `@nexpress/next` bootstrap calls `registerBlock` for each plugin block right after `loadPlugins`. The admin's Add-block popover (`field-renderer.tsx`) reads via `getRegisteredBlocks()` so plugin blocks surface there automatically. Re-registering the same source stays idempotent for HMR/reload; cross-source collisions retain last-loaded-wins behavior with an operator-visible warning. Author docs: `docs/plugin-blocks.md`.

Plugin page-builder patterns use the same contract shape across
`@nexpress/blocks/contracts`, `definePlugin()`, the Next bootstrap, the shared
registry, and plugin doctor. Author contributions use `NpPatternDefinition`
and may omit `source`; bootstrap validates every recursive block instance and
referenced block type, assigns `plugin:<id>` / `theme:<id>`, registers all
blocks before patterns, and derives pattern ids into
`manifest.provides.patterns`. Author docs: `docs/plugin-patterns.md`.

Plugin page templates and UI translations are definition-level registries.
Templates validate collection/id metadata and function components;
translations validate canonical BCP 47 locales plus ICU MessageFormat. Both
derive catalog inventory, retain source ownership for doctor, and cleanly
restore overridden values on reload/unload. Config schema/version/migrator and
setup/teardown callbacks are also validated; lifecycle callbacks resolve to
void and teardown runs in reverse load order before reload. Author docs:
`docs/plugin-templates.md`, `docs/plugin-i18n.md`, and `docs/plugin-reload.md`.

Plugin scheduled tasks use one canonical core validator from `definePlugin()`,
the core host, and plugin doctor. Task ids are safe per-plugin queue segments,
cron expressions use canonical five-field UTC syntax, handlers are functions
that resolve to void, and same-plugin duplicate ids are errors. The core host
repeats validation for SDK-bypassing definitions and validates handler results
at dispatch. Author docs: `docs/plugin-scheduled-tasks.md`.

Plugin wiring is centralized in `packages/core/src/plugins/host.ts` (registry + `runHook`) and surfaced via `loadPlugins()` / `runHook()` / `getPluginRoutes()` exports. API routes use uppercase `GET`/`POST`/`PUT`/`PATCH`/`DELETE`, canonical static paths, and exact `{ status, body?, headers? }` results; GET registrations also handle HEAD. Definition validation, the core host, and plugin doctor enforce the same contract. See `docs/plugin-api-routes.md`. The catch-all plugin route (`/api/plugins/<id>/<...>` for paths other than `/actions`) is rate-limited at the framework level by `apps/web/src/proxy.ts` (#316) — the conservative default applies to anything matching the catch-all pattern, so plugin authors get a sane floor automatically. A plugin that needs a higher ceiling for a specific endpoint must add its own per-handler rate-limiter on top.

Plugin **page routes** (`pageRoutes` field — #623) let a plugin own public-site URLs end-to-end. `definePlugin()`, the core host, and plugin doctor share the same canonical pattern/handler validation; malformed or same-plugin duplicate routes fail before dispatch. The host catch-all (`apps/web/src/app/(site)/[[...slug]]/page.tsx`) calls `dispatchPluginRoute()` from `@nexpress/next` after the page-slug + slug-redirect + theme-route lookups; a matched plugin component receives `{ params, searchParams, blockCtx }` and renders into the active shell. `locale: "auto"` matches the locale-stripped path, while `locale: "none"` matches only the raw path and does not add automatic hreflang aliases. `surface: "site"` routes use the site shell; `surface: "member"` routes use `impl.members.shell` with the member-surface fallback chain. The flag controls chrome only and is not an auth gate. Server / client boundaries follow the same pattern as `@nexpress/admin`: route components (server) import client widgets via the package's own `./client` subpath (e.g. `@nexpress/plugin-forum/client`), which is marked external in the index entry's tsup config so the bundle preserves the `"use client"` directive. Reference: `packages/plugins/forum/` migrated 2026-05-10. Author docs in `docs/plugin-pages.md`.

### Next.js app structure (`apps/web/src/app`)

Route groups:

- `(site)` — public site. Catch-all `[[...slug]]` renders pages from the content service.
- `(admin)/admin` — admin UI (Radix + Tailwind v4 via `@nexpress/admin`). Split into `login/` and `(protected)/`.
- `api/` — REST endpoints. Rate limiting + security headers applied in `src/proxy.ts` (in-memory per-IP buckets, per-path-pattern limits). The file is the Next 16 rename of the legacy `middleware.ts` convention; behavior is identical. **Rate limiting is per-process and intentional best-effort** — multi-node deployments need an upstream rate limiter (CDN / NGINX / Caddy). See `docs/deployment.md` "Multi-node notes" and issue #269.

Auth is JWT + Argon2 (`packages/core/src/auth`); sessions have a `tokenVersion` that can be bumped to invalidate. CSRF is enforced on state-changing endpoints via `verifyCsrf`.

Role checks go through `can(user, capability)` from `@nexpress/core/auth` (#273). Naming the behavior (`"community.moderate"`, `"content.publish"`) instead of the role hierarchy lets reviewers spot wrong checks at a glance and decouples call sites from future role-table changes. The legacy `hasRole(user, minRole)` / `isStaffMod(user)` helpers were retired — they no longer exist on the public surface. Client UI components (e.g. `AdminShell`) MUST receive resolved capability flags as props from a server parent — calling `can()` from a client component drags `@nexpress/core` into the browser bundle (#343).

The "actor on an operation" is modeled as a single union `NpPrincipal = { kind: "staff"; user } | { kind: "member"; memberId }` (#319). The pipeline, plugin hooks (`NpHookPrincipal` is the same shape under a historical name), and `principalCan()` all consume this union. Adding a new variant requires updating every `switch (principal.kind)` site — exhaustive switches with `_exhaustive: never` (#313) deliberately fail to compile when the union grows.

Member-side write services (comments, reactions, reports, follows) MUST go through `withMemberWrite(memberId, scopes, async () => { ... })` from `@nexpress/core/community` (#311). The wrapper enforces the ban-check gate by structure — adding a new write path without `withMemberWrite` is impossible to do silently. Pre-validation that doesn't write (input shape, target lookup) can run before the call; the wrapper guards the moment between "we know enough to attempt the write" and the first DB mutation.

CSRF on state-changing API routes is applied automatically by `apps/web/src/proxy.ts` (#281); per-handler `requireCsrf()` calls are no longer needed and have been removed. The proxy lists CSRF-exempt path patterns (login, webhook receivers) explicitly — if you add a new public-form endpoint, add it to the exempt list there rather than skipping the proxy.

### Frontend package split — client/server boundary

Packages that contain React UI split exports to keep client-only code out of RSC bundles:

| Package            | Root export (server-safe)                | `./client` export               | `./server` export |
| ------------------ | ---------------------------------------- | ------------------------------- | ----------------- |
| `@nexpress/editor` | types + renderRichText                   | NpRichTextEditor, ToolbarPlugin | renderRichText    |
| `@nexpress/blocks` | types, registry, renderBlocks, blocks/\* | —                               | —                 |
| `@nexpress/admin`  | types + views                            | AdminShell, all client views    | —                 |

`@nexpress/blocks` is server-safe end-to-end now (registry, renderBlocks, block definitions). The page-builder UI itself lives in `@nexpress/admin/src/blocks/` so it can use admin's Radix/Tailwind primitives directly. The old `@nexpress/blocks/client` export was removed when the editor moved.

Each `./client` bundle is built by tsup with `"use client"` banner injection. Consumers import `@nexpress/editor/client` for interactive components; server code imports the root or `./server`. Admin lazy-loads heavy editors via `React.lazy(() => import("@nexpress/editor/client"))`.

- `@nexpress/theme` — CSS-custom-property generation from design tokens. `NpThemeStyle` component emits `<style>` tag.

### Storage

`createStorageAdapter(config)` returns either `LocalStorageAdapter` (writes under `./uploads`, served at `/uploads`) or `S3StorageAdapter`. Selection is env-driven: `NP_STORAGE_ADAPTER=s3` + `NP_S3_BUCKET`/`NP_S3_REGION`/`NP_S3_ENDPOINT`, otherwise local with `NP_STORAGE_DIR` / `NP_STORAGE_URL`. A MinIO service is defined in `docker/docker-compose.yml` under the `s3` profile for local S3 development.

### Jobs

`pg-boss`-backed queue. Handlers register via `registerJobHandler(name, fn)`; built-in handlers (media cleanup, etc.) register via `registerBuiltinHandlers()`. The worker is started by the app (not by core) via `startWorker()`.

`startWorker()` owns the full shutdown lifecycle (#318): it installs SIGINT/SIGTERM handlers, drains in-flight jobs, and tears down the pg-boss instance when the process exits. If any setup step throws partway through, it cleans up the partial state (already-armed signal handlers, half-connected pool) so the next call boots cleanly. App code should not install competing SIGINT/SIGTERM handlers that race with the worker's drain.

Phase 20 added an admin Jobs surface (`/admin/jobs`): manual enqueue, pause/resume per queue, archived-job tab, and a worker-health widget driven by the heartbeat record from Phase 19. The admin endpoints are gated by the `admin.manage` capability and live under `apps/web/src/app/api/admin/jobs/`.

### WordPress import (`@nexpress/wp-import`)

A separate package (not part of `@nexpress/core`) that ingests a WXR export end-to-end (Phase 21.1–21.17): WXR XML parsing, HTML → Lexical conversion (including a Gutenberg fence parser), media download + dedup, taxonomy/term mapping, comment threading, custom post types, an audit log, a resume marker for crash recovery, and per-document visibility flags. Drives a long-running pg-boss job; surface state through the standard jobs admin. CLI entry at `packages/wp-import/src/cli/`. Documented in `docs/wordpress-import-guide.md`.

## WHERE TO LOOK

| Task                                             | Location                                                                              | Notes                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add/modify a collection                          | `apps/web/src/collections/*.ts`                                                       | Drizzle schema codegen reruns automatically in `pnpm dev`; if column shapes changed, also run `pnpm db:generate && pnpm db:migrate`                                                                                                                                                              |
| Change content pipeline (ACL, hooks, validation) | `packages/core/src/collections/pipeline.ts`                                           | 1043 lines — the critical write path                                                                                                                                                                                                                                                             |
| Add a block type                                 | `packages/blocks/src/blocks/`                                                         | Register in `registry.ts` `getDefaultBlocks()`                                                                                                                                                                                                                                                   |
| Modify rich-text rendering (SSR)                 | `packages/editor/src/render-rich-text.tsx`                                            | Server-safe; used by blocks and site pages                                                                                                                                                                                                                                                       |
| Add editor toolbar features                      | `packages/editor/src/toolbar-plugin.tsx`                                              | Client-only; exports via `./client`                                                                                                                                                                                                                                                              |
| Add admin UI field type                          | `packages/admin/src/collections/field-renderer.tsx`                                   | Add component in `fields/`, update renderer switch                                                                                                                                                                                                                                               |
| Add admin UI primitive                           | `packages/admin/src/ui/`                                                              | shadcn pattern: Radix + cva + cn()                                                                                                                                                                                                                                                               |
| Write a plugin                                   | Copy `packages/plugins/reading-time/src/index.ts`                                     | Use `definePlugin()` from `@nexpress/plugin-sdk`. New plugin packages live under `packages/plugins/<name>/`; the SDK itself stays at `packages/plugin-sdk` (it's not a plugin).                                                                                                                  |
| Add public routes to a plugin                    | `packages/plugins/forum/src/routes/`                                                  | `pageRoutes` array on `definePlugin`. Server-component routes import client widgets via the package's own `./client` subpath (NOT relative paths — relative bypasses RSC banner). Forum is the reference impl. Docs: `docs/plugin-pages.md`. Dispatcher: `packages/next/src/route-dispatcher.ts` |
| Change auth flow                                 | `packages/core/src/auth/` + `packages/next/src/auth.ts`                               | JWT sign/verify in core; cookie helpers in next                                                                                                                                                                                                                                                  |
| Change middleware (rate limits, CSP)             | `apps/web/src/proxy.ts`                                                               | In-memory rate limiter, security headers (Next 16 renamed `middleware.ts` → `proxy.ts`)                                                                                                                                                                                                          |
| Modify bootstrap / service wiring                | `packages/next/src/bootstrap.ts`                                                      | `createBootstrap()` — the singleton factory                                                                                                                                                                                                                                                      |
| Change DB schema (system tables)                 | `packages/core/src/db/schema/`                                                        | npUsers, npMedia, npRevisions, npSettings                                                                                                                                                                                                                                                        |
| Scaffold templates (create-nexpress)             | `packages/cli/templates/` (real .ts files) + `packages/cli/src/templates.ts` (loader) | 7-PR split (#268) moved templates to on-disk files with their own `tsconfig.templates.json`; loader is the 384-line orchestrator. Edit the file, not a string literal                                                                                                                            |
| Modify worker shutdown / signal handling         | `packages/core/src/jobs/worker.ts`                                                    | Owns SIGINT/SIGTERM, drains in-flight jobs, cleans up partial state on setup failure (#318)                                                                                                                                                                                                      |
| Run a WordPress import                           | `packages/wp-import/src/`                                                             | `parse/`, `convert/`, `media/`, `apply/`, `cli/`. Long-running pg-boss job; surfaces in `/admin/jobs`                                                                                                                                                                                            |
| Admin jobs UI (enqueue / pause / archive)        | `apps/web/src/app/(admin)/admin/(protected)/jobs/`                                    | Phase 20.1–20.4. Capability `admin.manage` required                                                                                                                                                                                                                                              |
| Theme token → CSS mapping                        | `packages/theme/src/generate-css.ts`                                                  | Custom properties under `:root`                                                                                                                                                                                                                                                                  |
| Docker / deployment                              | `docker/Dockerfile`                                                                   | Multi-stage, uses Next standalone output                                                                                                                                                                                                                                                         |

## Conventions

- **Error types**: throw `NpForbiddenError` / `NpNotFoundError` / `NpValidationError` / `NpAuthError` / `NpConflictError` / `NpRateLimitError` / `NpSiteContextMissingError` from `@nexpress/core`. The API layer converts these to HTTP responses with stable `code` strings — see `docs/api-error-codes.md` for the catalogue and stability guarantee. New codes extend the `NpErrorCode` union (#290).
- **Type-only imports**: enforced by ESLint (`@typescript-eslint/consistent-type-imports` with inline fix style). Prefer `import { type Foo } from "..."`.
- **No import cycles**: enforced by `import-x/no-cycle`.
- **React packages** declare React as a `peerDependency`; do not bundle it.
- **Formatting**: Prettier — double quotes (`singleQuote: false`), semicolons, trailing commas, 100 char width.
- **tsup builds**: all packages use `format: ["esm"]`, `dts: true` (except CLI). Multi-entry packages (editor, blocks, admin) produce separate client bundles with `"use client"` banner.
- `NEXPRESS_DB_PORT` in `.env` must match the port Postgres is bound to in `docker-compose.yml` (default 5433, not 5432).

## PR cadence (for agents)

- **Don't open a PR for every unit task.** Group related work into one branch / one PR. Two reasons: reviewer load scales with PR count (six 10-line PRs are noisier than one 60-line PR), AND **GitHub Actions minutes are billed per run** — every PR triggers CI ×3 jobs on open + a re-run on merge, and every push to `main` additionally fires the Release workflow. A six-PR cluster pays for ~30 workflow runs to land work that one PR would have shipped in 5.
- A reasonable bundle is everything that lands together to ship a single user-visible outcome (one feature, one bug fix, one cluster of consistent refactors). The Phase 23 / onboarding cluster (#397–#418) is the cautionary precedent — most of those should have been one or two PRs, not twenty-two.
- Split when (and only when) one of these is true: the changes are independently revertable and one might need to be backed out without the other; the work touches a sensitive surface (security gate, auth flow, billing) that benefits from a focused review; or the bundle has grown past ~800 lines and is genuinely two stories.
- Don't mistake "I finished a sub-step" for "ready to PR." Keep working on the branch until the user-visible outcome is whole, then open one PR. Mid-work check-ins go in the conversation, not GitHub.
- **One-line / docs-only changes**: prefer pushing directly to `main` (no PR). Branch protection isn't enforced on this repo, and a PR for a 7-line README edit costs five workflow runs to deliver three lines of value.

## ANTI-PATTERNS (THIS PROJECT)

- **Never import `@nexpress/core` from client components** — it pulls in `pg`, `sharp`, `argon2` and breaks the build. In UI packages, use `import type` only.
- **Never import `@nexpress/admin` from `(site)/*` routes** — leaks admin bundle to public pages.
- **Never import `next/cache` directly** — use `revalidateCollection()` from `@nexpress/next`.
- **Never edit generated files by hand** — `apps/web/src/db/generated/collections.ts` and `apps/web/next-env.d.ts` are generated. Edit source definitions and re-run generators.
- **Never suppress type errors** — no `as any`, `@ts-ignore`, `@ts-expect-error`. A few `as never` casts exist in admin field editors and plugin host — minimize, don't add more.
- **Never create parallel DB connections** — call `ensureFor(...)` (or rely on the routes that do) and read from the `getDb()` singleton. One pool per process.
- **Never run `pnpm db:generate` without reviewing output** — destructive schema changes are not auto-applied.
- **Never assume `withCurrentSite` covers fire-and-forget async work** (#320) — it restores the previous resolver as soon as the callback returns, so any pending `void someAsyncFn()` or already-enqueued pg-boss handler runs with the OUTER site context (typically `null` in a worker). Stamp `siteId` onto job payloads at enqueue time and have the handler wrap its own work in `withCurrentSite(payload.siteId, ...)`.

## STABILITY (v0.1)

What v0.1 of the published `@nexpress/*` packages commits to. Anything not on this list is either internal-by-default or hasn't yet earned a stability promise — treat as moveable.

### Stable surface

These are the public APIs we'll honor with semver and migration notes. Breaking them rides a **minor bump pre-1.0** and ships a CHANGELOG line operators can search for.

- **Collection authoring** — `defineCollection({ slug, fields, hooks, access, … })` and the field-config types (`NpTextField`, `NpRichTextField`, `NpRelationshipField`, `NpBlocksField`, `NpArrayField`, `NpGroupField`, `NpRowField`, `NpCollapsibleField`, …). Adding a new field type is non-breaking. Renaming or removing one is a minor with a migration note.
- **Plugin authoring** — `definePlugin({ manifest, hooks, actions, routes, pageRoutes, scheduled, blocks })`. `actions` is a definition-level `Record<actionId, { kind, handler }>` with `action | metric | status | table` kinds; the compatible setup-time `ctx.actions.register*` methods remain supported. Content hooks use the operation-specific names `content:beforeCreate`, `content:afterCreate`, `content:beforeUpdate`, `content:afterUpdate`, `content:beforeDelete`, `content:afterDelete`, `content:beforePublish`, `content:afterPublish`, and `content:beforeUnpublish`; every phase receives its exact `document` / `documentId` / `originalDocument` / `operation` / `source` / `principal` payload. Auth and media hooks have the same per-name typed-data contract, and lifecycle handlers return void. The single render hook is `render:beforePage`; its typed `NpRenderContribution` return separates `head` from `bodyEnd`. `scheduled` ships typed five-field UTC cron tasks whose handlers return void. `blocks` ships an `NpBlockDefinition[]` registered into the shared block registry at boot.
- **Bootstrap intent enum** — `ensureFor("read" | "plugins" | "write")`. Adding a new intent is non-breaking; semantics of the existing three are pinned.
- **Error classes + codes** — `NpForbiddenError`, `NpNotFoundError`, `NpValidationError`, `NpAuthError`, `NpConflictError`, `NpRateLimitError`, `NpSiteContextMissingError`, and the `NpErrorCode` union. The string code per class is stable per [docs/api-error-codes.md](./docs/api-error-codes.md).
- **Capability vocabulary** — `can(user, capability)` and the existing capability strings: `"admin.manage"`, `"content.publish"`, `"content.author"`, `"community.moderate"`. New capability strings will be added; existing ones won't be renamed or removed in 0.x.
- **Subpath exports** — `@nexpress/core/auth`, `/community`, `/db`, `/i18n`, `/jobs`, `/media`, `/observability`, `/seo`. Symbols inside each are stable per the rules above.
- **Adapters** — `NpStorageAdapter` (`LocalStorageAdapter`, `S3StorageAdapter`), `NpJobQueue` (with `PgBossAdapter`), `NpLogger` + `setLogger`, `NpErrorReporter` + `setErrorReporter`, `NpEmailAdapter` + `setEmailAdapter`. Optional methods (e.g. `NpJobQueue.isHealthy?`) may be promoted to required only with a minor + migration note.
- **`NpPrincipal` union** — adding a variant is breaking (every `switch (principal.kind)` site needs updating, enforced by `_exhaustive: never`). The existing `"staff"` / `"member"` shape is committed.
- **Block authoring** — `NpBlockDefinition` (`type`, `label`, `defaultProps`, `propsSchema`, `acceptsChildren?`, `render(props, children?)`) and the `NpBlockInstance` wire shape (`id`, `type`, `props`, optional `children: NpBlockInstance[]`). Adding optional fields to either is non-breaking. `NpBlockMetadata` (= `NpBlockDefinition` minus `render`) is the serializable subset the admin uses for the picker / props form. The shared registry helpers `registerBlock`, `getRegisteredBlocks`, `getRegisteredBlockMetadata`, `getSharedRegistry` are stable. The lightweight `@nexpress/blocks/contracts` subpath exports `npValidateBlockDefinition`, `npAnalyzeBlockDefinitions`, and `npBlockPropFieldTypes` for authoring tools.
- **Plugin block contribution** — `definePlugin({ blocks: NpBlockDefinition[] })`. Definition, bootstrap, registry, and doctor validation reject malformed definitions/props schemas and same-plugin duplicate types before registration. The bootstrap (`@nexpress/next`) registers each enabled plugin block into the shared registry at boot. Same-source re-registration is idempotent for HMR/reload; cross-source type collisions remain last-loaded-wins with a warning. Author docs: `docs/plugin-blocks.md`.
- **Plugin page-route contribution** (added 2026-05-11, #623) — `definePlugin({ pageRoutes: NpPluginPageRouteRegistration[] })`. Each entry has a function `component`, optional function `metadata`, plus `surface: "site" | "member"` and `locale: "auto" | "none"` knobs. Definition and host validation reject malformed patterns/handlers and same-plugin duplicates; plugin doctor reports those errors plus cross-plugin conflicts. The catch-all dispatches via `dispatchPluginRoute` (`@nexpress/next`); precedence is page > slug-redirect > theme > plugin > 404. `locale: "none"` uses the raw URL and receives no automatic hreflang aliases. Adding optional fields to the registration type is non-breaking. Author docs: `docs/plugin-pages.md`. Pattern grammar (`/`, `:name`, `:name(regex)`, segment-count match) is stable; glob / catch-all is **not** part of the v0.1 commitment. The `surface: "member"` shell wrap is **stable** as of the v0.2 layout refactor (2026-05-11) — `surface: "member"` plugin routes render with `impl.members.shell` + the F-track fallback chain via `apps/web/src/components/shell-wrap.tsx`, dispatched from the (site) catch-all based on `match.route.surface` (no parallel `(member)` catch-all is needed; a layout-bound dispatch isn't possible in Next.js anyway).
- **Block server → client metadata bridge** — host apps wrap their admin children with `<BlocksRegistryProvider metadata={getRegisteredBlockMetadata()}>` (called server-side). The page builder reads it via the `useBlocksRegistry()` hook. Without the provider, plugin blocks render correctly on the public site but are absent from the admin's Add-block popover (the registry singleton is module-scoped and the browser instance only has the built-in defaults).

### Experimental — no stability promise

These exist on the published surface but are explicitly NOT covered by the rules above. Use them; expect to migrate when they shift.

- **Lexical content shape** — `NpRichTextContent` is whatever Lexical's serializer emits. We track Lexical upstream; their JSON shape is not part of NexPress's commitment.
- **`_layout` meta convention on grid children** — children of a `gridBlock` carry `props._layout: { colSpan: 1–12 }`. Today only the built-in `gridBlock` reads it; if more container blocks land before 1.0 the convention may move to a top-level `NpBlockInstance.layout?` field instead of being nested inside `props`.
- **Block prop field types** — the `propsSchema` field type set (`text` / `textarea` / `number` / `boolean` / `select` / `url` / `richtext` / `image`) is what the admin renders today. Adding new types is non-breaking; existing ones won't be renamed in 0.x but the _editor renderer_ for a type may upgrade visually (e.g. phase 5 swapped the `richtext` JSON-textarea for a Lexical editor without changing the wire format).
- **Theme token names** — `colors`, `fonts`, `radii`, etc. are stable as a _category_, but specific token keys may be renamed if a token system overhaul lands before 1.0.
- **WordPress import internals** — the CLI surface (`packages/wp-import/src/cli/`) is stable; `parse/` / `convert/` / `media/` / `apply/` modules are not a public API. Importing from them will break.
- **Generated schema output** — `apps/web/src/db/generated/collections.ts` and friends are codegen artifacts. Don't import from generated paths in user code outside the file Drizzle expects.
- **Bootstrap singletons exposed at the root** — `setDb`, `getDb`, `setStorageAdapter`, `setJobQueue`, `loadPlugins`, `runHook`, `createDbConnection`. Required for `@nexpress/next`'s `createBootstrap()`; not intended for app-level use. May move to an `@internal` or `@nexpress/core/bootstrap` subpath in a later 0.x.
- **Internal auth helpers** — `signToken`, `verifyToken`, `hashPassword`, `ARGON2_OPTIONS`. Keep using `verifyTokenFull` (which is part of the auth subpath); the lower-level helpers may be removed from the public surface.

### Removed in 0.1

- `hasRole(user, minRole)` / `isStaffMod(user)` — replaced by `can(user, capability)` (#273).
- `@nexpress/blocks/client` subpath — the page-builder editor moved into `@nexpress/admin` (#444). `@nexpress/blocks` is server-safe end-to-end now (types, registry, renderBlocks, block definitions). Sites importing `BlockPageEditor` from the old subpath should switch to letting `field-renderer` handle blocks fields automatically.
- `NpBlockRegistration` (the legacy `component: string` shape exported from `@nexpress/plugin-sdk`) — replaced by the real `NpBlockDefinition` from `@nexpress/blocks` on `NpPluginDefinition.blocks` (#446). The old type stays exported as `@deprecated` for type compatibility but was never wired and has no consumers.

### What this section is NOT

It's not a roadmap. It says what's pinned today, not what 1.0 will look like. The Lexical and theme-token entries are the most likely to evolve before 1.0; the rest of the experimental list is expected to either firm up (move to stable) or shrink (move to internal).

## NOTES

- **CI** — `.github/workflows/ci.yml` runs on every `pull_request`,
  manual `workflow_dispatch`, and selected `push: main` changes (docs-only
  and changeset-only pushes are ignored on `main`; PR triggers stay
  unconditional so required checks are never missing):
  1. `typecheck + build + test` — install → build → typecheck → `pnpm test`.
  2. `integration tests (Postgres)` — Postgres 16 service container + `pnpm test:integration` against `TEST_DATABASE_URL` (#275). Covers the pipeline / write-path code that mocked unit tests can't.
  3. `E2E (Playwright)` — Postgres 16 + Playwright + `next start` against the built bundle. Runs on PRs and manual dispatch, not push-to-main.
  4. `scaffold smoke (fresh scaffold journey)` — packs the workspace packages, scaffolds a temp project outside the monorepo, installs it, typechecks it, and runs the deploy-readiness journey smoke.
- **Release** — `.github/workflows/release.yml` runs on `push: main`
  and manual `workflow_dispatch`. It uses `changesets/action` to open/update
  the "Version Packages" PR when changesets are queued, and publishes via
  `pnpm run release` after that PR lands. npm auth uses Trusted Publishing
  (OIDC, `id-token: write`, `NPM_CONFIG_PROVENANCE=true`), not `NPM_TOKEN`.
  The workflow also dispatches CI for GITHUB_TOKEN-created Version PRs and
  mirrors required job conclusions onto the Version PR commit.
- **No pre-commit hooks** — no husky or lint-staged configured.
- **`@nexpress/next` package name** — not the framework. It's NexPress's Next.js integration helpers (`createBootstrap`, `createAuthHelpers`, `createCollectionHelpers`).
- **LocalStorageAdapter** is not multi-node safe. Use S3 for production deployments with multiple instances.
- **Turbo typecheck/test tasks depend on `^build`** — packages must be built before typecheck/test will run. This increases CI time.
