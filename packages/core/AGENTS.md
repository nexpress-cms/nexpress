# packages/core — AGENTS.md

Server-only CMS engine: config, DB, auth, collections pipeline, media, jobs, plugins, storage, theme.

**Generated:** 2026-04-22 | **Commit:** 2e07135

## STRUCTURE

```
src/
├── config/       # NpConfig types, defineConfig/defineCollection, validation schemas
├── db/           # createDbConnection, Drizzle schema (npUsers/npMedia/npRevisions/npSettings), generators
├── auth/         # JWT (jose), Argon2 password, CSRF, session helpers, access control
├── collections/  # Registry, content pipeline (1043 lines), Zod validation, search vectors
├── content/      # Thin helpers: getTheme, getNavigation, getPageBySlug, findPosts
├── media/        # Upload/process lifecycle, storage adapter singletons, sharp processing
├── storage/      # LocalStorageAdapter, S3StorageAdapter, createStorageAdapter factory
├── jobs/         # pg-boss queue abstraction, handler registry, worker lifecycle, builtin handlers
├── jobs-contract/ # client-safe names, payloads, persisted rows, schedules, and Admin wire parsers
├── sites/        # canonical site ids, async-local execution context, registry, memberships
├── plugins/      # Plugin host: registry, runHook, route dispatch, capability enforcement
├── theme/        # Token types, defaults, sanitizeTokenValue
├── errors.ts     # NpError hierarchy (Forbidden/NotFound/Validation/Auth/Conflict)
└── index.ts      # Barrel — 161 lines re-exporting the full public API
```

## SINGLETONS (wiring order matters)

| Singleton                              | Defined in                | Set by app via                          |
| -------------------------------------- | ------------------------- | --------------------------------------- |
| `setDb(db)` / `getDb()`                | `collections/pipeline.ts` | `createBootstrap` in `@nexpress/next`   |
| `setMediaDb(db)` / `getMediaDb()`      | `media/service.ts`        | Same bootstrap (often same DB instance) |
| `setStorageAdapter(adapter)`           | `media/service.ts`        | Bootstrap reads `config.storage`        |
| `setJobQueue(queue)` / `getJobQueue()` | `jobs/queue.ts`           | App calls after DB init                 |
| `pluginRegistry` / `globalHooks`       | `plugins/host.ts`         | `loadPlugins()` at startup              |

**Init order**: createDbConnection → setDb/setMediaDb → setStorageAdapter → registerCollections → configureBuiltinJobContext → loadPlugins → startWorker. Wrong order = runtime "not initialized" errors.

## WHERE TO LOOK

| Task                        | File(s)                                       | Notes                                                              |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Change content write path   | `collections/pipeline.ts`                     | ACL → validate → hooks → persist → revisions → media refs → search |
| Add/change system DB tables | `db/schema/system.ts`, `db/schema/media.ts`   | npUsers, npMedia, npRevisions, npSettings, npNavigation            |
| Modify collection codegen   | `db/generator.ts` (496 lines)                 | Produces Drizzle table definitions from NpCollectionConfig         |
| Modify TS type codegen      | `db/type-generator.ts`                        | Produces TypeScript interfaces from configs                        |
| Change JWT/password logic   | `auth/token.ts`, `auth/password.ts`           | jose for JWT, @node-rs/argon2 for passwords                        |
| Add session features        | `auth/session.ts`                             | `verifyTokenFull`, `invalidateAllSessions`, tokenVersion checks    |
| Change media processing     | `media/processor.ts`                          | sharp-based, `DEFAULT_IMAGE_SIZES` for variants                    |
| Add job handler             | `jobs/handlers.ts`, `jobs-contract/`          | `{ parsePayload, resolveSiteId }`; site ids live in exact payloads |
| Add plugin capabilities     | `plugins/host.ts` + `plugin-sdk/src/types.ts` | Hook capability = `hooks:<namespace>` prefix matching              |
| Add error type              | `errors.ts`                                   | Extend `NpError` with code + statusCode                            |

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

- Public build entries are declared in `tsup.config.ts`; client-safe contracts such as `jobs-contract` must not import server dependencies. Apps reference the `db-schema` entry in `drizzle.config.ts`.
- `pipeline.ts` is the single largest file (1043 lines). Changes here affect every document write. Read the full flow before modifying.
- Content helpers in `content/helpers.ts` are thin wrappers over `getDb()` + direct SQL queries — they bypass the pipeline (no hooks/validation). Use `saveDocument`/`findDocuments` from collections for pipeline-protected writes.

## ANTI-PATTERNS

- **Never import index.ts from internal modules** — barrel is for external consumers only. Internal imports use relative paths (`../jobs/queue.js`).
- **Never add static imports between jobs and collections/plugins** — use the existing indirection patterns (dynamic import, builtinJobContext).
- **Never rely on ambient request state in a durable job** — persist `siteId`, validate it in the payload parser, and register `resolveSiteId`; async-local state cannot cross a queue/process boundary.
- **Never call getDb()/getMediaDb()/getStorageAdapter() before the app has called the corresponding setter** — will throw at runtime.
