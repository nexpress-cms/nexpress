# packages/core — AGENTS.md

AP-406 Gateway execution reuses the existing ChangeSet/approval/execution facade and journals. Three additional descriptor-derived capabilities create real Gateway run/action evidence and optional durable MCP tasks; approval-required terminal tasks never revive on later execution. Activity must recheck canonical linkage and use the explicitly injected ChangeSet read facade for every current item. Migration 0045 extends the existing stdio MCP-mode constraint; the inventory remains 31 Agent tables/167 critical constraints/11 deferred lifecycle foreign keys. Core PostgreSQL 67 and all 1,181 ordinary web PostgreSQL cases passed across the full run and corrected regressions. Shared ChangeSet admission maps SQLSTATE 40001/40P01 to the existing safe 409 conflict without retry. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow. Host installation stays explicit, with no provider, R5 runtime, automatic worker or default activation.

Rollback keeps original apply evidence immutable and derives compensation from verified snapshots and current after hashes. Snapshot restore variants belong only to canonical rollback operations. Reuse current domain writers, per-site serialization, normal revisions/audit, fresh approval consumption and bounded verification. Terminal failed rollback evidence remains immutable; optional inspection only CAS-records confirmed execution-effect outcomes. Unresolved effects fence both new generations and site deletion even after plan failure. The preceding rollback slice passed its recorded validation; see the R4 rollback flow results.

Server-only CMS engine: config, DB, auth, collections pipeline, media, jobs, plugins, storage, cache, theme.

**Refreshed:** 2026-09-09

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
├── agent-contract/ # Pure client-safe Agent canonical/admin/wire registries and analyzers
├── agent/        # Server-only Agent Admin admission, principal/token auth, vault runtime/journal, deletion graph
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

| Task                        | File(s)                                                          | Notes                                                                               |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Change content write path   | `collections/pipeline.ts`                                        | ACL → validate → hooks → persist → revisions → media refs → search                  |
| Add/change system DB tables | `db/schema/system.ts`, `db/schema/media.ts`                      | npUsers, npMedia, npRevisions, npSettings, npNavigation                             |
| Modify collection codegen   | `db/generator.ts` (496 lines)                                    | Produces Drizzle table definitions from NpCollectionConfig                          |
| Modify TS type codegen      | `db/type-generator.ts`                                           | Produces TypeScript interfaces from configs                                         |
| Change JWT/password logic   | `auth/token.ts`, `auth/password.ts`                              | jose for JWT, @node-rs/argon2 for passwords                                         |
| Add session features        | `auth/session.ts`                                                | `verifyTokenFull`, `invalidateAllSessions`, tokenVersion checks                     |
| Change media processing     | `media/processor.ts`                                             | sharp-based, `DEFAULT_IMAGE_SIZES` for variants                                     |
| Change storage contracts    | `storage/contract.ts`, `storage/operations.ts`                   | Keep bootstrap, media, doctor, health, and ops on one boundary                      |
| Change observability        | `observability/contract.ts`, `logger.ts`, `error-reporter.ts`    | Preserve failure isolation and direct-console fallback                              |
| Change cache invalidation   | `cache/contract.ts`, `cache/runtime.ts`                          | Keep Next, plugins, jobs, CDN, health, and ops on one boundary                      |
| Change custom routes        | `routes/contract.ts`, `routes/registry.ts`                       | Keep app declarations, Admin/API, scaffold, and doctor aligned                      |
| Change community contracts  | `community-contract/`, `community/`                              | Keep services, API/Admin, doctor, and health on one exact boundary                  |
| Change Agent persistence    | `db/schema/agent.ts`, `agent/`, `agent-contract/`                | Keep Admin admission, auth, migration, deletion graph, and PostgreSQL tests aligned |
| Change SEO output contracts | `seo/contract.ts`, `seo/{sitemap,feed,page-metadata,json-ld}.ts` | Keep Core, Theme hooks, App routes, and crawler caches aligned                      |
| Add job handler             | `jobs/handlers.ts`, `jobs-contract/`                             | `{ parsePayload, resolveSiteId }`; site ids live in exact payloads                  |
| Add plugin capabilities     | `plugins/host.ts` + `plugin-sdk/src/types.ts`                    | Hook capability = `hooks:<namespace>` prefix matching                               |
| Add error type              | `errors.ts`                                                      | Extend `NpError` with code + statusCode                                             |

## INTERNAL DEPENDENCY FLOW

```
config/types ──→ used by ALL modules (canonical types)
db/schema    ──→ used by collections, media, auth, content
agent        ──→ imports db/schema; sites registry imports only deletion helpers
collections  ──→ imports jobs/queue (enqueueJob), plugins/host (runHook)
media        ──→ imports storage, jobs/queue, db/schema
content      ──→ imports collections (getDb, findDocuments), theme
plugins/host ──→ dynamic import of jobs/queue (avoids static cycle)
jobs/builtin ──→ uses configureBuiltinJobContext indirection (avoids importing collections)
jobs/handlers ──→ sites/context (optional payload-derived async-local dispatch scope)
```

No static import cycles exist. Cycle avoidance is via: dynamic imports in `plugins/host`, `configureBuiltinJobContext` indirection in `jobs/builtin-handlers`, and per-subsystem singletons.

## CONVENTIONS

- AP-307–309 reuse the ChangeSet service, safe review/report wires and installed
  descriptor source. `resolveChangeSetCapabilities` is explicit; preview is not
  advertised without the host preview service. Persist the same structured
  capability input and descriptor fingerprint used by MCP/HTTP discovery.
  Read evidence has its actual invocation id; do not invent actions/runs/tasks.
  Review snapshots remain private; project only changed editable fields using
  current collection definitions after all item ACL and integrity checks.
- Preview check/network implementations stay private modules. The host supplies
  the effect-free renderer and canonical public route manifest; current authority
  is rechecked around render, pinned-DNS HEAD and artifact storage. Reports use
  fixed messages, exact multipart canonical JSON and the existing atomic upload
  journal. The seven-day lifetime starts at preview completion, while artifact
  creation timestamps retain their earlier reservation times.

- AP-301/AP-302 draft services use the existing staff admission and current
  Gateway-authority transaction seam. Resource preparation shares collection
  ACL/schema helpers and existing navigation/theme/SEO/media contracts; never
  use `saveDocument` to reserve draft ids. Exact ChangeSet wires exclude sealed
  plans, snapshots and approval integrity fields. Draft service installation
  does not advertise new MCP/HTTP capabilities or install a worker. Doctor,
  deletion and fresh migrations now share the 31-table/167-constraint inventory after AP-405.

- AP-303/AP-304 validation extends that same service with generation-bound
  durable attempts, inline validation and explicitly invoked queue recovery.
  Stored requester session/family/grant authority must be current before and
  after protected reads. Reuse explicit `NpTransaction` reads and the existing
  resource validation/base reader; never manufacture preview or apply results.
  Sealed plan/snapshot hashes are verified on projection and never exposed as
  raw bodies. `proposedAfterHash` commits normalized intent; actual apply hashes
  now come from the execution adapter's persisted resource reads. Transaction callers wrap the outer transaction
  in `withDeferredPostCommit`; nested queues join the parent and rollback drops
  callbacks. Navigation CAS belongs in the atomic write, not a prior read.

- AP-305/AP-306 preview extends the existing ChangeSet service, not a second
  execution engine. Reuse the read-only document/navigation/theme/SEO/media-ref
  overlay and async-local effect guard. A renderer may not write content, emit
  jobs/email/cache effects, mutate plugin/runtime registries or bypass existing
  item access. Requester authority protects generation work; current viewer
  authority independently protects retained reads. Never hold authority/parent
  locks across artifact storage I/O or acquire principal authority after parent
  locks through a second connection.
- Preview storage uses the private `preview-artifact-contract.ts` facet and
  `preview-artifact-service.ts`, with explicit frozen adapter identity. Complete
  mode-0700 spools (mode-0600 files) precede the full 0..24 reservation. Preserve
  `aur1`/`aus1`/`auo1`/`adr1`, the domain-and-length-framed `ac1` raw digest,
  ordinal order, and immutable contract/manifest evidence. A PUT is dispatched
  once; recovery inspects it, never recreates source bytes. The 5,850-second
  queued-source window derives from 24 serial artifacts, four 60-second calls
  each, and 90-second lease grace; its deadline also fences dispatch claims.
  Unknown operations remain blocked, even after deadline or a missing object.
- Migration 0040 added five preview tables, 0042 the execution journal, and
  0043/0044 rollback persistence/references. The current Doctor inventory has
  31 tables/167 critical constraints and 11 deferred lifecycle foreign keys. Keep live launch/render, expiry/skew fences and confirmed
  storage deletion aligned with the actual same-site lifecycle references.
  Preserve logical references where no corresponding lifecycle table exists.
  All adapters and processors require explicit host injection; no automatic
  runtime/worker is installed and default Agent exposure stays disabled.

- Core declaration generation exceeds the 2 GiB heap available on constrained
  runners. The build script defaults to a 5 GiB Node heap and preserves explicit
  `NODE_OPTIONS`. Derive deletion inventory names from the existing order tuple
  and keep descriptor values typed to the shared `PgTable`/`AnyPgColumn` contract;
  exporting their full inferred Drizzle structures duplicates large declarations.
  Keep the existing ChangeSet service return contract explicit rather than deriving
  its public type through SQL implementation inference. Node 22 requires the
  larger heap even where Node 24 completes at 4 GiB.

- Public build entries are declared in `tsup.config.ts`; client-safe contracts such as `jobs-contract` and `community-contract` must not import server dependencies. Apps reference the `db-schema` entry in `drizzle.config.ts`.
- `agent-contract/` is likewise pure: browser-safe wires may reuse its exact
  canonical primitives, but must not import DB, vault, provider, transport, or
  framework runtime code. Public principal/connection/action projections omit
  credential/grant locators, secret material, canonical action input, and
  recovery evidence by construction.
- `pipeline.ts` is the single largest file (1043 lines). Changes here affect every document write. Read the full flow before modifying.
- Content helpers in `content/helpers.ts` are thin wrappers over `getDb()` + direct SQL queries — they bypass the pipeline (no hooks/validation). Use `saveDocument`/`findDocuments` from collections for pipeline-protected writes.

## ANTI-PATTERNS

- **Never import index.ts from internal modules** — barrel is for external consumers only. Internal imports use relative paths (`../jobs/queue.js`).
- **Never add static imports between jobs and collections/plugins** — use the existing indirection patterns (dynamic import, builtinJobContext).
- **Never rely on ambient request state in a durable job** — persist `siteId`, validate it in the payload parser, and register `resolveSiteId`; async-local state cannot cross a queue/process boundary.
- **Never call getDb()/getMediaDb()/getStorageAdapter() before the app has called the corresponding setter** — will throw at runtime.
