# AGENTS.md

This file provides guidance to Agents when working with code in this repository.

**Last refreshed:** 2026-04-29 (Phase 19 worker heartbeat + plugin cron)

## Commands

Package manager is pnpm (v10.33, required). Node >=20.

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d db   # Postgres 16 on :5433
cp .env.example .env                                    # DATABASE_URL, NX_SECRET, SITE_URL
pnpm build                                              # build all packages (dist/) — needed before dev
pnpm dev                                                # turbo watch: tsup --watch per pkg + next dev + collection schema:gen on src/collections/* changes
```

- `pnpm build` / `pnpm dev` / `pnpm test` — turbo fan-out over all workspaces
- `pnpm lint` — ESLint at the repo root (type-checked rules via `projectService`)
- `pnpm typecheck` — `turbo run typecheck`, which runs `tsc --noEmit` in each package. Distinct from `pnpm lint` (ESLint).
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations (turbo tasks; wired per-app)
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` runs the vitest unit suite across every workspace (no DB required). `pnpm test:integration` runs the Postgres-backed suite, gated on `TEST_DATABASE_URL` (skips silently when unset). See `docs/testing.md` for setup.

Running a single package's build/typecheck:

```bash
pnpm --filter @nexpress/core build
pnpm --filter @nexpress/core typecheck # tsc --noEmit for just that package
```

## Architecture

Monorepo: `packages/*` (library code) + `apps/web` (Next.js 15 reference app). Workspaces are declared in `pnpm-workspace.yaml`. Turborepo orchestrates builds; `^build` in `turbo.json` means dependent packages are built first.

### Dependency graph

```
core  ←  editor, theme, plugin-sdk, next
core, editor  ←  blocks
core, editor, blocks  ←  admin
all of the above  ←  apps/web
cli  (standalone scaffolder, no workspace deps)
```

`@nexpress/core` is **server-only**. It imports `pg`, `sharp`, `@node-rs/argon2`, `pg-boss`, `jose`. `apps/web/next.config.ts` declares it in `serverExternalPackages`; all other `@nexpress/*` packages live in `transpilePackages`. Do not import `@nexpress/core` from a client component — it will break the build.

### Module system — `.js` extensions in TS imports

All packages set `"module": "NodeNext"` and `"type": "module"`. Relative imports inside packages must use `.js` extensions even in `.ts` source:

```ts
import { foo } from "./bar.js"; // correct
import { foo } from "./bar"; // breaks the build
```

Package-to-package imports use the bare specifier (e.g. `from "@nexpress/core"`) and resolve through each package's `exports` map to `dist/`. That means **consumers need `dist/` to exist** — if a package rebuild hasn't finished, sibling packages will fail to type-check. Run `pnpm build` once after fresh clone; `pnpm dev` keeps dists fresh with `tsup --watch`.

### Core service singletons (critical)

`@nexpress/core` exposes a module-scoped singleton pattern:

- `setDb(db)` / `getDb()` — Drizzle connection (single source of truth shared by the pipeline, media service, and every other consumer)
- `setStorageAdapter(adapter)` — local or S3
- `setJobQueue(queue)` / `startWorker()` — pg-boss
- `loadPlugins(plugins)` — registers hooks/routes/actions

The reference app wires these up in `apps/web/src/lib/init-core.ts` via `ensureCoreServices()` and `ensurePluginsLoaded()`. Any route/server-component touching collections, media, or plugins must first call `ensureCoreServices()` or the singletons will be null. This is the idiomatic pattern — don't create parallel DB connections from elsewhere.

### Collections = codegen, not runtime

Collections are declared with `defineCollection({ slug, fields, ... })` and registered with `registerCollection()`. The Drizzle schema and TypeScript types are **generated** from these configs:

- `packages/core/src/db/generator.ts` → `generateDrizzleSchema()`
- `packages/core/src/db/type-generator.ts` → `generateTypeScript()`

Adding or changing a collection's fields requires regenerating the schema and running a migration. The Drizzle schema codegen step (`pnpm schema:gen`, which writes `src/db/generated/collections.ts`) runs automatically inside `pnpm dev` whenever a file under `src/collections/` or `src/nexpress.config.ts` changes (#271). The Postgres migration is still manual (`pnpm db:generate && pnpm db:migrate`) so the SQL gets a human review before it touches the DB. A user project's collections live in `src/collections/` (see the `create-nexpress` scaffold); for this monorepo itself, collections for the reference app live in `apps/web/src/collections/`.

The data pipeline (`packages/core/src/collections/pipeline.ts`) handles access control, hook invocation, validation via generated Zod schemas (`validation.ts`), revision tracking, media-ref tracking, and search-vector builds for every document write.

### Plugin model (v1)

See `docs/plugin-system-design.md`. v1 plugins are **npm-package + rebuild**, not hot-loadable. A plugin can register hooks (`content:afterCreate`, etc.), actions (custom API handlers), routes, and scheduled tasks at startup. It **cannot** add collections/fields at runtime — those require codegen + migrate. Plugins run in-process with full Node access; there is no sandbox in v1. Author plugins with `definePlugin()` from `@nexpress/plugin-sdk`.

Plugin wiring is centralized in `packages/core/src/plugins/host.ts` (registry + `runHook`) and surfaced via `loadPlugins()` / `runHook()` / `getPluginRoutes()` exports.

### Next.js app structure (`apps/web/src/app`)

Route groups:

- `(site)` — public site. Catch-all `[[...slug]]` renders pages from the content service.
- `(admin)/admin` — admin UI (Radix + Tailwind v4 via `@nexpress/admin`). Split into `login/` and `(protected)/`.
- `api/` — REST endpoints. Rate limiting + security headers applied in `src/proxy.ts` (in-memory per-IP buckets, per-path-pattern limits). The file is the Next 16 rename of the legacy `middleware.ts` convention; behavior is identical. **Rate limiting is per-process and intentional best-effort** — multi-node deployments need an upstream rate limiter (CDN / NGINX / Caddy). See `docs/deployment.md` "Multi-node notes" and issue #269.

Auth is JWT + Argon2 (`packages/core/src/auth`); sessions have a `tokenVersion` that can be bumped to invalidate. CSRF is enforced on state-changing endpoints via `verifyCsrf`.

### Frontend package split — client/server boundary

Packages that contain React UI split exports to keep client-only code out of RSC bundles:

| Package            | Root export (server-safe) | `./client` export               | `./server` export |
| ------------------ | ------------------------- | ------------------------------- | ----------------- |
| `@nexpress/editor` | types + renderRichText    | NxRichTextEditor, ToolbarPlugin | renderRichText    |
| `@nexpress/blocks` | registry, renderBlocks    | BlockPageEditor, BlockPalette   | —                 |
| `@nexpress/admin`  | types + views             | AdminShell, all client views    | —                 |

Each `./client` bundle is built by tsup with `"use client"` banner injection. Consumers import `@nexpress/editor/client` for interactive components; server code imports the root or `./server`. Admin lazy-loads heavy editors via `React.lazy(() => import("@nexpress/editor/client"))`.

- `@nexpress/theme` — CSS-custom-property generation from design tokens. `NxThemeStyle` component emits `<style>` tag.

### Storage

`createStorageAdapter(config)` returns either `LocalStorageAdapter` (writes under `./uploads`, served at `/uploads`) or `S3StorageAdapter`. Selection is env-driven: `NX_STORAGE_ADAPTER=s3` + `NX_S3_BUCKET`/`NX_S3_REGION`/`NX_S3_ENDPOINT`, otherwise local with `NX_STORAGE_DIR` / `NX_STORAGE_URL`. A MinIO service is defined in `docker/docker-compose.yml` under the `s3` profile for local S3 development.

### Jobs

`pg-boss`-backed queue. Handlers register via `registerJobHandler(name, fn)`; built-in handlers (media cleanup, etc.) register via `registerBuiltinHandlers()`. The worker is started by the app (not by core) via `startWorker()`.

## WHERE TO LOOK

| Task                                             | Location                                                | Notes                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/modify a collection                          | `apps/web/src/collections/*.ts`                         | Drizzle schema codegen reruns automatically in `pnpm dev`; if column shapes changed, also run `pnpm db:generate && pnpm db:migrate`                                              |
| Change content pipeline (ACL, hooks, validation) | `packages/core/src/collections/pipeline.ts`             | 1043 lines — the critical write path                                                                                                                                            |
| Add a block type                                 | `packages/blocks/src/blocks/`                           | Register in `registry.ts` `getDefaultBlocks()`                                                                                                                                  |
| Modify rich-text rendering (SSR)                 | `packages/editor/src/render-rich-text.tsx`              | Server-safe; used by blocks and site pages                                                                                                                                      |
| Add editor toolbar features                      | `packages/editor/src/toolbar-plugin.tsx`                | Client-only; exports via `./client`                                                                                                                                             |
| Add admin UI field type                          | `packages/admin/src/collections/field-renderer.tsx`     | Add component in `fields/`, update renderer switch                                                                                                                              |
| Add admin UI primitive                           | `packages/admin/src/ui/`                                | shadcn pattern: Radix + cva + cn()                                                                                                                                              |
| Write a plugin                                   | Copy `packages/plugins/reading-time/src/index.ts`       | Use `definePlugin()` from `@nexpress/plugin-sdk`. New plugin packages live under `packages/plugins/<name>/`; the SDK itself stays at `packages/plugin-sdk` (it's not a plugin). |
| Change auth flow                                 | `packages/core/src/auth/` + `packages/next/src/auth.ts` | JWT sign/verify in core; cookie helpers in next                                                                                                                                 |
| Change middleware (rate limits, CSP)             | `apps/web/src/proxy.ts`                                 | In-memory rate limiter, security headers (Next 16 renamed `middleware.ts` → `proxy.ts`)                                                                                         |
| Modify bootstrap / service wiring                | `packages/next/src/bootstrap.ts`                        | `createBootstrap()` — the singleton factory                                                                                                                                     |
| Change DB schema (system tables)                 | `packages/core/src/db/schema/`                          | nxUsers, nxMedia, nxRevisions, nxSettings                                                                                                                                       |
| Scaffold templates (create-nexpress)             | `packages/cli/src/templates.ts`                         | 1664 lines of string templates                                                                                                                                                  |
| Theme token → CSS mapping                        | `packages/theme/src/generate-css.ts`                    | Custom properties under `:root`                                                                                                                                                 |
| Docker / deployment                              | `docker/Dockerfile`                                     | Multi-stage, uses Next standalone output                                                                                                                                        |

## Conventions

- **Error types**: throw `NxForbiddenError` / `NxNotFoundError` / `NxValidationError` / `NxAuthError` / `NxConflictError` / `NxRateLimitError` / `NxSiteContextMissingError` from `@nexpress/core`. The API layer converts these to HTTP responses with stable `code` strings — see `docs/api-error-codes.md` for the catalogue and stability guarantee. New codes extend the `NxErrorCode` union (#290).
- **Type-only imports**: enforced by ESLint (`@typescript-eslint/consistent-type-imports` with inline fix style). Prefer `import { type Foo } from "..."`.
- **No import cycles**: enforced by `import-x/no-cycle`.
- **React packages** declare React as a `peerDependency`; do not bundle it.
- **Formatting**: Prettier — double quotes (`singleQuote: false`), semicolons, trailing commas, 100 char width.
- **tsup builds**: all packages use `format: ["esm"]`, `dts: true` (except CLI). Multi-entry packages (editor, blocks, admin) produce separate client bundles with `"use client"` banner.
- `NEXPRESS_DB_PORT` in `.env` must match the port Postgres is bound to in `docker-compose.yml` (default 5433, not 5432).

## ANTI-PATTERNS (THIS PROJECT)

- **Never import `@nexpress/core` from client components** — it pulls in `pg`, `sharp`, `argon2` and breaks the build. In UI packages, use `import type` only.
- **Never import `@nexpress/admin` from `(site)/*` routes** — leaks admin bundle to public pages.
- **Never import `next/cache` directly** — use `revalidateCollection()` from `@nexpress/next`.
- **Never edit generated files by hand** — `apps/web/src/db/generated/collections.ts` and `apps/web/next-env.d.ts` are generated. Edit source definitions and re-run generators.
- **Never suppress type errors** — no `as any`, `@ts-ignore`, `@ts-expect-error`. A few `as never` casts exist in admin field editors and plugin host — minimize, don't add more.
- **Never create parallel DB connections** — use `ensureCoreServices()` to get the singleton. One pool per process.
- **Never run `pnpm db:generate` without reviewing output** — destructive schema changes are not auto-applied.

## NOTES

- **CI** — `.github/workflows/ci.yml` runs install → build → typecheck → `pnpm test` on Ubuntu (Node 22, pnpm 10.33). Currently `workflow_dispatch` only (manual) while Actions billing is sorted; push/PR triggers will be re-enabled without other changes. Integration tests are not run in CI yet — they require Postgres in the runner.
- **No pre-commit hooks** — no husky or lint-staged configured.
- **`@nexpress/next` package name** — not the framework. It's NexPress's Next.js integration helpers (`createBootstrap`, `createAuthHelpers`, `createCollectionHelpers`).
- **LocalStorageAdapter** is not multi-node safe. Use S3 for production deployments with multiple instances.
- **Turbo typecheck/test tasks depend on `^build`** — packages must be built before typecheck/test will run. This increases CI time.
