# AGENTS.md

This file provides guidance to Agents when working with code in this repository.

## Commands

Package manager is pnpm (v10.33, required). Node >=20.

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d db   # Postgres 16 on :5433
cp .env.example .env                                    # DATABASE_URL, NX_SECRET, SITE_URL
pnpm build                                              # build all packages (dist/) — needed before dev
pnpm dev                                                # turbo watch: runs tsup --watch per pkg + next dev
```

- `pnpm build` / `pnpm dev` / `pnpm test` — turbo fan-out over all workspaces
- `pnpm lint` — ESLint at the repo root (type-checked rules via `projectService`)
- `pnpm typecheck` — **maps to `turbo run lint`**, which runs `tsc --noEmit` in each package (not ESLint). The `lint` turbo task in each package is `tsc --noEmit`; the root `lint` script is the ESLint one. Both exist, and they are not the same thing.
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations (turbo tasks; wired per-app)
- `pnpm format` / `pnpm format:check` — Prettier
- No tests exist yet. `pnpm test` runs `turbo run test` but no package defines a `test` script.

Running a single package's build/typecheck:
```bash
pnpm --filter @nexpress/core build
pnpm --filter @nexpress/core lint     # tsc --noEmit for just that package
```

## Architecture

Monorepo: `packages/*` (library code) + `apps/web` (Next.js 15 reference app). Workspaces are declared in `pnpm-workspace.yaml`. Turborepo orchestrates builds; `^build` in `turbo.json` means dependent packages are built first.

### Dependency graph

```
core  ←  editor, theme, plugin-sdk
core, editor  ←  blocks
core, editor, blocks  ←  admin
all of the above  ←  apps/web
cli  (standalone scaffolder, no workspace deps)
```

`@nexpress/core` is **server-only**. It imports `pg`, `sharp`, `@node-rs/argon2`, `pg-boss`, `jose`. `apps/web/next.config.ts` declares it in `serverExternalPackages`; all other `@nexpress/*` packages live in `transpilePackages`. Do not import `@nexpress/core` from a client component — it will break the build.

### Module system — `.js` extensions in TS imports

All packages set `"module": "NodeNext"` and `"type": "module"`. Relative imports inside packages must use `.js` extensions even in `.ts` source:

```ts
import { foo } from "./bar.js";        // correct
import { foo } from "./bar";           // breaks the build
```

Package-to-package imports use the bare specifier (e.g. `from "@nexpress/core"`) and resolve through each package's `exports` map to `dist/`. That means **consumers need `dist/` to exist** — if a package rebuild hasn't finished, sibling packages will fail to type-check. Run `pnpm build` once after fresh clone; `pnpm dev` keeps dists fresh with `tsup --watch`.

### Core service singletons (critical)

`@nexpress/core` exposes a module-scoped singleton pattern:

- `setDb(db)` / `getDb()` — Drizzle connection
- `setMediaDb(db)` — media service's DB handle (often the same instance)
- `setStorageAdapter(adapter)` — local or S3
- `setJobQueue(queue)` / `startWorker()` — pg-boss
- `loadPlugins(plugins)` — registers hooks/routes/actions

The reference app wires these up in `apps/web/src/lib/init-core.ts` via `ensureCoreServices()` and `ensurePluginsLoaded()`. Any route/server-component touching collections, media, or plugins must first call `ensureCoreServices()` or the singletons will be null. This is the idiomatic pattern — don't create parallel DB connections from elsewhere.

### Collections = codegen, not runtime

Collections are declared with `defineCollection({ slug, fields, ... })` and registered with `registerCollection()`. The Drizzle schema and TypeScript types are **generated** from these configs:

- `packages/core/src/db/generator.ts` → `generateDrizzleSchema()`
- `packages/core/src/db/type-generator.ts` → `generateTypeScript()`

Adding or changing a collection's fields requires regenerating the schema and running a migration (`pnpm db:generate && pnpm db:migrate`). A user project's collections live in `src/collections/` (see the `create-nexpress` scaffold); for this monorepo itself, collections for the reference app would live in `apps/web/src/collections/` (currently none committed).

The data pipeline (`packages/core/src/collections/pipeline.ts`) handles access control, hook invocation, validation via generated Zod schemas (`validation.ts`), revision tracking, media-ref tracking, and search-vector builds for every document write.

### Plugin model (v1)

See `docs/plugin-system-design.md`. v1 plugins are **npm-package + rebuild**, not hot-loadable. A plugin can register hooks (`content:afterCreate`, etc.), actions (custom API handlers), routes, and scheduled tasks at startup. It **cannot** add collections/fields at runtime — those require codegen + migrate. Plugins run in-process with full Node access; there is no sandbox in v1. Author plugins with `definePlugin()` from `@nexpress/plugin-sdk`.

Plugin wiring is centralized in `packages/core/src/plugins/host.ts` (registry + `runHook`) and surfaced via `loadPlugins()` / `runHook()` / `getPluginRoutes()` exports.

### Next.js app structure (`apps/web/src/app`)

Route groups:
- `(site)` — public site. Catch-all `[[...slug]]` renders pages from the content service.
- `(admin)/admin` — admin UI (Radix + Tailwind v4 via `@nexpress/admin`). Split into `login/` and `(protected)/`.
- `api/` — REST endpoints. Rate limiting + security headers applied in `src/middleware.ts` (in-memory per-IP buckets, per-path-pattern limits).

Auth is JWT + Argon2 (`packages/core/src/auth`); sessions have a `tokenVersion` that can be bumped to invalidate. CSRF is enforced on state-changing endpoints via `verifyCsrf`.

### Frontend package split

- `@nexpress/editor` — Lexical rich-text. Exports `./client` (the React editor) and `./server` (the SSR renderer). Keep server rendering in the server entry to avoid dragging Lexical client code into RSC bundles.
- `@nexpress/blocks` — Block registry, 8 default blocks, drag-and-drop editor (`@dnd-kit`), and `renderBlocks` for the public site. Also splits `./client` vs root.
- `@nexpress/admin` — shadcn-style primitives + admin views. Notice `next-shim.d.ts` — this package is built with `tsup` (no Next), so Next types are shimmed to keep tsc happy.
- `@nexpress/theme` — CSS-custom-property generation from design tokens.

### Storage

`createStorageAdapter(config)` returns either `LocalStorageAdapter` (writes under `./uploads`, served at `/uploads`) or `S3StorageAdapter`. Selection is env-driven: `NX_STORAGE_ADAPTER=s3` + `NX_S3_BUCKET`/`NX_S3_REGION`/`NX_S3_ENDPOINT`, otherwise local with `NX_STORAGE_DIR` / `NX_STORAGE_URL`. A MinIO service is defined in `docker/docker-compose.yml` under the `s3` profile for local S3 development.

### Jobs

`pg-boss`-backed queue. Handlers register via `registerJobHandler(name, fn)`; built-in handlers (media cleanup, etc.) register via `registerBuiltinHandlers()`. The worker is started by the app (not by core) via `startWorker()`.

## Conventions

- **Error types**: throw `NxForbiddenError` / `NxNotFoundError` / `NxValidationError` / `NxAuthError` / `NxConflictError` from `@nexpress/core`. The API layer converts these to HTTP responses.
- **Type-only imports**: enforced by ESLint (`@typescript-eslint/consistent-type-imports` with inline fix style). Prefer `import { type Foo } from "..."`.
- **No import cycles**: enforced by `import-x/no-cycle`.
- **React packages** declare React as a `peerDependency`; do not bundle it.
- `NEXPRESS_DB_PORT` in `.env` must match the port Postgres is bound to in `docker-compose.yml` (default 5433, not 5432).
