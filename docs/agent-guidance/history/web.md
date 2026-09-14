# Web agent history

Source: `apps/web/AGENTS.md`, extracted 2026-09-14. Historical implementation checkpoints; consult only for the affected feature. Later checkpoints and current code may supersede earlier status statements.

# apps/web — AGENTS.md

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

AP-500/AP-502/AP-504 add only a thin `scripts/agent-runtime.ts` wrapper and
`agent:runtime` script for the shared local status/pause/reviewed-resume facade.
The explicit deployment actor fingerprint is environment-only; wrappers do not
construct workers, provider adapters, schedulers or automatic runtime services.
Absent readiness blocks resume while local status/pause remain available.
Generated migrations 0046/0047 extend the run table and nine runtime tables;
Doctor is 40 Agent tables/265 critical constraints/15 deferred lifecycle foreign
keys, ordinary deletion 39 tables. Reuse the existing runtime service fixture
for controls and negative PostgreSQL cases. Runtime configuration HTTP routes
and Studio views remain AP-507; no versions/changesets or default activation
are added. See the R5 runtime foundation flow for current scope and validation.

Earlier R4 slice:

AP-406 uses the existing four Agent HTTP wrappers and shared MCP entrypoints; do not add parallel execution routes or automatic Gateway/runtime installation. Current Activity uses the explicitly injected ChangeSet read facade and safe execution projections. Migration 0045 updates the existing stdio MCP-mode constraint; Doctor remains 31 Agent tables/167 critical constraints/11 deferred lifecycle foreign keys. All 1,181 ordinary PostgreSQL cases passed across the full run and corrected regressions; native preview passed separately. Live Redis 16, restored theme-render 5, production browser 62 and packed 40-package/56-stage checks passed. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow.

Rollback preparation/request-approval/execute routes remain thin shared-app exports; cancellation reuses the existing ChangeSet route. Runtime, keys/definitions, intent and verification are explicitly injected; wrappers do not enable workers or Gateway execution. The preceding rollback slice passed its recorded validation; see the R4 rollback flow results.

Next.js 16 reference app. This app is intentionally thin: most route
handlers, pages, scripts, proxy behavior, and setup flows are re-exported
from `@nexpress/app`, while `apps/web` supplies the local config,
collections, generated schema, and package wiring used for monorepo
development.
