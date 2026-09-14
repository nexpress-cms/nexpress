# Core agent history

Source: `packages/core/AGENTS.md`, extracted 2026-09-14. Historical implementation checkpoints; consult only for the affected feature. Later checkpoints and current code may supersede earlier status statements.

# packages/core — AGENTS.md

**Current Runtime Studio slice:** AP-507 management and related AP-508 visibility
reuse the existing Runtime services and fourteen Admin mutations through an
explicitly installed `runtimeStudio` facade. Closed staff-only read contracts,
authority-bound cursors, typed definition/policy/budget editors, current effective
review and optional atomic activation trigger plans preserve existing admission,
CSRF, reauthentication, idempotency and CAS. Manual admission accepts only the
owned recipe/goal contract and an enabled same-version trigger. Unknown Runtime
usage and unavailable operations remain explicitly unknown; Gateway counters
stay exact. Reference and scaffold routes/pages are thin shared wrappers.
Advanced policy simulation, broader retention and full R5 acceptance remain
open. No migration, provider call, automatic service/worker, seed, default
activation, package version or changeset is added. See the
[Runtime Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md) for scope and verification.

**Earlier events and operations slice:** AP-503 and related AP-508 reuse the
canonical event envelope, existing trigger/Run tables, Runtime admission,
executor and generic worker registry. Exact immutable triggers, bounded filters,
per-recipe durable event/schedule progress and current authority checks preserve
healthy admissions across sibling failures. Run rows are the schedule outbox;
no synthetic schedule event is introduced. Explicit host registration owns six
closed jobs and private fair cursors under `agents.runtime.jobs`; absent Runtime
stays disabled. Initial Run job quota reservations use existing audit receipts,
and recovery does not charge them again. Only expired, dispatched, unreferenced
events are pruned. Agent job errors and diagnostics remain safe aggregates.
Local verification passed workspace 113/lint 41, Core unit 1,894, Core
PostgreSQL 68, web PostgreSQL 1,401 ordinary cases across full/corrected runs
(including theme 5), native preview 1, Redis 16, production browser 62 and
packed 40-package/56-stage checks. Doctor remains 40 tables/266 critical
constraints. No migration, provider call,
automatic factory, seed, default activation, package version or changeset is
added. AP-507, remaining AP-508 and full R5 acceptance stay open. Current
verification is recorded in [the events and operations flow](../../design/agentic-platform/r5-runtime-events-operations-flow.md).

**Earlier delegated execution slice:** Explicit self-delegation on the existing
Agent create command binds a real staff user; omitted authority remains
deployment-only. Runtime admission freezes principal/staff/deployment authority
and rechecks live scope, membership and item access. Existing ChangeSet,
approval, invocation and execution services own Runtime mutations and explicit
approval resumption; the request action stays immutable and only its exact
approved-execution receipt fulfills it. Membership changes invalidate old
Run authority, including removal/regrant. No users, sessions or delegation are
synthesized from an Agent creator. Local acceptance passed verify 113/lint 41,
Core unit 1,854, Core PostgreSQL 67, web PostgreSQL 1,373 (theme 5), native
preview 1, Redis 16, production browser 62 and packed 40-package/56-stage
checks. The full R5 gate remains open for AP-503/AP-507/AP-508. Doctor remains
40 tables/266 critical constraints, with no migration, automatic worker, seed,
default activation,
package versions or changesets. See [the delegated execution flow](../../design/agentic-platform/r5-runtime-delegated-execution-flow.md).

AP-500/AP-502/AP-504 now add explicit Agent/policy lifecycle, queued runtime
admission, retained canonical policy/budget-source verification, usage ledgers
and emergency controls. Reuse the same site quota lock for settings, admission,
reservation and deletion. `agents.runtime` defaults disabled; private
`agents.runtime.control` holds only a positive revision/current local resume
plan/latest consumed receipt, and both settings stay outside portable content.
Local deployment authority is never a staff actor. Pause remains available
without provider/worker readiness; local resume requires a matching persisted
five-minute plan and current readiness fingerprint, while staff resume uses
existing admission and its fixed envelope. Cooldown composes by max, warning by
min; effective quiet-hour deny union never truncates saved policy layers.
Migrations 0046/0047 give 40 Agent tables/265 critical constraints/15 deferred
lifecycle foreign keys and a 39-table ordinary deletion inventory. No provider
inference, automatic worker/factory, new runtime HTTP surface, seed or default
activation is installed. See the R5 runtime foundation flow for the remaining
R5 scope and current verification evidence.

Earlier R4 slice:

AP-406 Gateway execution reuses the existing ChangeSet/approval/execution facade and journals. Three additional descriptor-derived capabilities create real Gateway run/action evidence and optional durable MCP tasks; approval-required terminal tasks never revive on later execution. Activity must recheck canonical linkage and use the explicitly injected ChangeSet read facade for every current item. Migration 0045 extends the existing stdio MCP-mode constraint; the inventory remains 31 Agent tables/167 critical constraints/11 deferred lifecycle foreign keys. Core PostgreSQL 67 and all 1,181 ordinary web PostgreSQL cases passed across the full run and corrected regressions. Shared ChangeSet admission maps SQLSTATE 40001/40P01 to the existing safe 409 conflict without retry. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow. Host installation stays explicit, with no provider, R5 runtime, automatic worker or default activation.

Rollback keeps original apply evidence immutable and derives compensation from verified snapshots and current after hashes. Snapshot restore variants belong only to canonical rollback operations. Reuse current domain writers, per-site serialization, normal revisions/audit, fresh approval consumption and bounded verification. Terminal failed rollback evidence remains immutable; optional inspection only CAS-records confirmed execution-effect outcomes. Unresolved effects fence both new generations and site deletion even after plan failure. The preceding rollback slice passed its recorded validation; see the R4 rollback flow results.

Server-only CMS engine: config, DB, auth, collections pipeline, media, jobs, plugins, storage, cache, theme.

**Refreshed:** 2026-09-11
