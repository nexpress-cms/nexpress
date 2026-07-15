# packages/core — AGENTS.md

Server-only CMS engine: config, DB, auth, collections pipeline, media, jobs, plugins, storage, cache, theme.

**Refreshed:** 2026-07-15

## STRUCTURE

```
src/
├── bootstrap/    # Framework-host-only singleton and registry wiring boundary
├── cache/        # Exact invalidation request/result, host adapter, diagnostics, lifecycle
├── config/       # NpConfig types, defineConfig/defineCollection, validation schemas
├── db/           # createDbConnection, Drizzle schema (npUsers/npMedia/npRevisions/npSettings), generators
├── auth/         # JWT (jose), Argon2 password, CSRF, session helpers, access control
├── collections/  # Registry, content pipeline (1043 lines), Zod validation, search vectors
├── community/    # Server services, adapter registries, moderation dispatch, diagnostics
├── community-contract/ # Client-safe exact requests, rows, settings, adapters, and wire parsers
├── content/      # Thin helpers: getTheme, getNavigation, getPageBySlug, findPosts
├── media/        # Upload/process lifecycle, media DB singleton, sharp processing
├── storage/      # Exact runtime/object contract, adapters, registry, operations, lifecycle
├── rate-limit/   # Exact request/decision contract, adapters, registry, lifecycle
├── observability/ # Exact logger/reporter contract, safe dispatch, diagnostics, lifecycle
├── jobs/         # pg-boss queue abstraction, handler registry, worker lifecycle, builtin handlers
├── jobs-contract/ # client-safe names, payloads, persisted rows, schedules, and Admin wire parsers
├── sites/        # canonical site ids, async-local execution context, registry, memberships
├── plugins/      # Plugin host: registry, runHook, route dispatch, capability enforcement
├── routes/       # Client-safe custom route definition/wire contract + source registry
├── seo/          # Exact metadata, JSON-LD, sitemap/feed, robots contribution contracts
├── theme/        # Token types, defaults, sanitizeTokenValue
├── errors.ts     # NpError hierarchy (Forbidden/NotFound/Validation/Auth/Conflict)
└── index.ts      # Barrel — 161 lines re-exporting the full public API
```

## SINGLETONS (wiring order matters)

| Singleton                              | Defined in            | Set by app via                        |
| -------------------------------------- | --------------------- | ------------------------------------- |
| `setDb(db)` / `getDb()`                | `db/runtime.ts`       | `createBootstrap` in `@nexpress/next` |
| `setStorageAdapter(adapter)`           | `storage/registry.ts` | Bootstrap validates `config.storage`  |
| cache invalidation adapter             | `cache/runtime.ts`    | Bootstrap installs the Next host      |
| logger / error reporter                | `observability/`      | Bootstrap validates env + adapters    |
| `setJobQueue(queue)` / `getJobQueue()` | `jobs/queue.ts`       | Bootstrap producer or worker          |
| `pluginRegistry` / `globalHooks`       | `plugins/host.ts`     | `loadPlugins()` at startup            |

**Init order**: configureObservability → createDbConnection/setDb → cache host → setStorageAdapter → registerCollections → loadPlugins → email/producer or worker. Shutdown reverses dependencies and closes observability last. Wrong order = runtime "not initialized" errors or missed boot diagnostics.

Raw setters, registry mutation, and plugin dispatch live under the host-only
`@nexpress/core/bootstrap` subpath and are absent from the root barrel. Normal
application code uses `createBootstrap().ensureFor(...)` and domain subpaths.

Rate limiting is initialized independently by the Next proxy entrypoint. Keep
its contract pure under `@nexpress/core/rate-limit`; custom multi-node adapters
must be injected from `src/proxy.ts`, not assumed to share app bootstrap state.

Storage uses the same separation under `@nexpress/core/storage`. That domain
subpath exposes contracts, factories, reads, and object operations without
singleton mutation. Built-in and custom intent are installed through the
host-only `configureStorageRuntime(config, adapter?)`. Framework call sites
use the `np*StorageObject` operations so safe keys, metadata, and results are
checked even for custom adapters. Do not bypass them with direct adapter calls.

Observability uses `@nexpress/core/observability`. Environment intent and both
adapters are installed transactionally before startup warnings. Framework code
must log/report through the safe facade, never call a raw adapter; dispatch and
async failures are deliberately contained and recorded for Admin Health.

Cache invalidation uses `@nexpress/core/cache`. Core never imports `next/cache`;
bootstrap injects the Next host, and plugins/jobs call `npInvalidateCache()`.
Concrete requests and adapter results are exact and bounded. Runtime failures
are contained as partial/unavailable results and recorded for Admin Health.

## WHERE TO LOOK

| Task                        | File(s)                                                          | Notes                                                              |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Change content write path   | `collections/pipeline.ts`                                        | ACL → validate → hooks → persist → revisions → media refs → search |
| Add/change system DB tables | `db/schema/system.ts`, `db/schema/media.ts`                      | npUsers, npMedia, npRevisions, npSettings, npNavigation            |
| Modify collection codegen   | `db/generator.ts` (496 lines)                                    | Produces Drizzle table definitions from NpCollectionConfig         |
| Modify TS type codegen      | `db/type-generator.ts`                                           | Produces TypeScript interfaces from configs                        |
| Change JWT/password logic   | `auth/token.ts`, `auth/password.ts`                              | jose for JWT, @node-rs/argon2 for passwords                        |
| Add session features        | `auth/session.ts`                                                | `verifyTokenFull`, `invalidateAllSessions`, tokenVersion checks    |
| Change media processing     | `media/processor.ts`                                             | sharp-based, `DEFAULT_IMAGE_SIZES` for variants                    |
| Change storage contracts    | `storage/contract.ts`, `storage/operations.ts`                   | Keep bootstrap, media, doctor, health, and ops on one boundary     |
| Change observability        | `observability/contract.ts`, `logger.ts`, `error-reporter.ts`    | Preserve failure isolation and direct-console fallback             |
| Change cache invalidation   | `cache/contract.ts`, `cache/runtime.ts`                          | Keep Next, plugins, jobs, CDN, health, and ops on one boundary     |
| Change custom routes        | `routes/contract.ts`, `routes/registry.ts`                       | Keep app declarations, Admin/API, scaffold, and doctor aligned     |
| Change community contracts  | `community-contract/`, `community/`                              | Keep services, API/Admin, doctor, and health on one exact boundary |
| Change SEO output contracts | `seo/contract.ts`, `seo/{sitemap,feed,page-metadata,json-ld}.ts` | Keep Core, Theme hooks, App routes, and crawler caches aligned     |
| Add job handler             | `jobs/handlers.ts`, `jobs-contract/`                             | `{ parsePayload, resolveSiteId }`; site ids live in exact payloads |
| Add plugin capabilities     | `plugins/host.ts` + `plugin-sdk/src/types.ts`                    | Hook capability = `hooks:<namespace>` prefix matching              |
| Add error type              | `errors.ts`                                                      | Extend `NpError` with code + statusCode                            |

## INTERNAL DEPENDENCY FLOW

```
config/types ──→ used by ALL modules (canonical types)
db/schema    ──→ used by collections, media, auth, content
collections  ──→ imports jobs/queue (enqueueJob), plugins/host (runHook)
media        ──→ imports storage, jobs/queue, db/schema
content      ──→ imports collections (getDb, findDocuments), theme
plugins/host ──→ dynamic import of jobs/queue (avoids static cycle)
jobs/builtin ──→ uses configureBuiltinJobContext indirection (avoids importing collections)
jobs/handlers ──→ sites/context (optional payload-derived async-local dispatch scope)
```

No static import cycles exist. Cycle avoidance is via: dynamic imports in `plugins/host`, `configureBuiltinJobContext` indirection in `jobs/builtin-handlers`, and per-subsystem singletons.

## CONVENTIONS

- Public build entries are declared in `tsup.config.ts`; client-safe contracts such as `jobs-contract` and `community-contract` must not import server dependencies. Apps reference the `db-schema` entry in `drizzle.config.ts`.
- `pipeline.ts` is the single largest file (1043 lines). Changes here affect every document write. Read the full flow before modifying.
- Content helpers in `content/helpers.ts` are thin wrappers over `getDb()` + direct SQL queries — they bypass the pipeline (no hooks/validation). Use `saveDocument`/`findDocuments` from collections for pipeline-protected writes.

## ANTI-PATTERNS

- **Never import index.ts from internal modules** — barrel is for external consumers only. Internal imports use relative paths (`../jobs/queue.js`).
- **Never add static imports between jobs and collections/plugins** — use the existing indirection patterns (dynamic import, builtinJobContext).
- **Never rely on ambient request state in a durable job** — persist `siteId`, validate it in the payload parser, and register `resolveSiteId`; async-local state cannot cross a queue/process boundary.
- **Never call getDb()/getMediaDb()/getStorageAdapter() before the app has called the corresponding setter** — will throw at runtime.
