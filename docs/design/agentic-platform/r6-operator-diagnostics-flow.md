# R6 Operator diagnostics and plan artifacts

An explicitly installed Operator can inspect authorized operational status,
request a bounded audit and prepare a plan using a real existing owner.
This AP-602 slice does not execute maintenance, grant approval or activate an
Agent, provider or worker.

## Owners and installation

The browser-safe `agent-contract/operator-capability-contract.ts` owns exact
inputs, outputs and descriptor schemas. `ops.status` joins the optional read
registry. The separate Operator service and facade own durable `audit.run`
and `ops.plan` invocation, action, audit and artifact records. Existing HTTP,
MCP and Runtime admission dispatch to those owners.

The App `npCreateAgentOperatorAppHostV1` factory requires an explicit current
caller/site/target authorizer. Deployment observations additionally require an
explicit mapping from that caller and site to deployment visibility. Merely
constructing the factory does not install capabilities or jobs. Hosts install
the status callback in the existing read executor options and the Operator
facade in capability admission; an absent owner remains unavailable.

Global CLI database collectors are not invoked under a guessed site context.
The adapter reuses readiness, cache, storage, plugin and backup owners with
fixed safe projections. Missing jobs/Agent scoped readers yield unavailable
observations. Configuration checks do not claim external connectivity. The
status report retains the shared `np.ops.v1` type, with command suggestions
removed from the Agent projection and a digest of that exact report.

## Bounded audit and current authority

Audit input selects 1–9 unique families, at most 64 collections and 1–1,000
targets. Family order is accepted as supplied; duplicates and unknown fields
are rejected. The concrete contracts adapter reuses the existing `schema.get`
executor's current collection ACL and digest, and resolves the current
collection validation schema. It returns actual `schema:<digest>` references.
Jobs, storage and plugin audits require explicit scoped readers. Content,
links, SEO, accessibility and security collectors are not implemented here;
unsupported families fail closed before enqueueing.

An external audit commits an admitted invocation and queued output before its
explicit producer is called after commit. Jobs persist and validate `siteId`
and `invocationId`, and the registered handler resolves the site from that
payload. A worker rechecks the stored caller authority and current target ACL,
serializes duplicate processing, checks the owner again before persisting the
completed checks, and records their digest. Exact-key retries expose the real
queued/completed state; a queued report never claims a completed audit.
A collector failure leaves the invocation queued for an existing queue retry
or explicit recovery. A producer outage can be recovered through an exact-key
retry; no completion evidence is synthesized.

Optional MCP tasks refer to this same invocation. Retained task evidence must
pass the Operator owner's current access checks when read. Cancellation uses
that owner's current read authority and changes the task, invocation and action
atomically; worker and cancellation acquire their evidence locks in the same
order. Runtime uses the
same durable records but finishes the bounded read within its current-run
transaction; it does not introduce asynchronous Runtime suspension. Only
validated completed Operator output enters subsequent provider context.
The invocation preserves the executor's original request key so resuming after
an action commit reuses the existing result instead of creating another plan.
Provider requests use the remaining run token budget measured by the same
ledger aggregation as usage admission. Reconstructing a request excludes only
that call's own reservation; unresolved or expired other reservations retain
their maximum amounts. Cost, call-count, site and Agent limits remain enforced
by the existing admission and dispatch checks.

## Plans and evidence retention

`ops.plan` requires proposal exposure/autonomy and current target access.
The five plan-only actions are `migration.plan`, `restore.plan`,
`storage.migration.plan`, `plugin.change.plan` and `queue.global.plan`.
Only installed task-specific owners can provide their artifacts. The concrete
App restore adapter calls the existing backup restore planner using fixed host
configuration and an exact manifest ID, rejecting the moving `latest` alias.
It returns the owner's artifact and a bounded local planning command; it never
runs a CLI command or restores data.

The new `np_agent_operator_plans` table stores the exact private artifact,
operation, contract ID, digest, expiry and references to the admitting
invocation/audit. The model receives plan/check identifiers, digest, expiry
and a local CLI handoff. It receives no artifact body, storage path, secret or
raw owner diagnostic. Plans expire after one hour. Replay verifies stored
artifact and invocation integrity and current access; expiry does not delete
required evidence or make a plan executable.

The additive generated migration and appended reference-fence migration leave
all applied migration SQL unchanged. Doctor and site-deletion inventories
include the new table. Restrictive references and the existing source-release
inventory conservatively preserve artifacts and their required history. No
independent artifact purge job is introduced in this slice.

The public discriminated contract reserves `cache.revalidate`,
`agent.run.retry` and `agent.run.cancel` for an actual approved executor. This
service rejects those branches until that owner is implemented. It never
fabricates an approval ID. Arbitrary shell/SQL, repair execution, automatic
activation, credentials and provider calls remain outside this work.

## Acceptance boundary

AP-602 remains open for the approved three-action executor, additional real
scoped collectors and operational recipe acceptance. AP-603–606 and the full
R5/R6 acceptance gates are not closed by diagnostics and plan artifacts.
No version, changeset or lockfile change is part of this bundle.

Local acceptance on 2026-09-29 used the final source and built dependencies:

- `pnpm verify --concurrency=1`: 113 workspace tasks passed, including 62
  repository checks, Core 2,190, App 648 and Web 174 unit cases, package
  typechecks and the reference production build.
- `pnpm lint`: all 41 tasks passed. The subsequent OpenAPI expectation-only
  update also passed its scoped ESLint and Prettier checks.
- PostgreSQL: all 78 cases in seven Operator, MCP task, Runtime persistence,
  contract diagnostics, executor, usage and context suites passed with an
  explicit test database. This includes actual worker/cancellation races,
  revoked access, artifact tampering, action-commit/restart replay and remaining
  token capacity with unresolved reservations.
- A fresh project outside the workspace installed all 40 packed public
  packages, passed typechecking including its configuration, generated and
  applied migrations to a fresh database, and passed the Agent foundation
  checks (51 tables, 350 critical constraints and 17 deferred constraints),
  production build and scaffold command journey. Installed Core agents, App
  Operator host and Admin client bytes matched the verified producers.
- Self-review, modified-document links, formatting and `git diff --check`
  passed. Generated migration review found only the new Operator table and
  appended reference fences; existing table snapshots and applied SQL remain
  unchanged.

Review corrected the Runtime replay key, provider-compatible UUID schema and
remaining-token request calculation. The existing Runtime jobs test now loads
its fresh module fixture in setup instead of charging cold imports to its
operation timeout; its assertions and isolation are preserved. Descriptor and
OpenAPI expectations were updated for the three reviewed capabilities.

Redis, theme PostgreSQL, native preview and production browser suites were not
rerun for this server-contract slice. The workspace theme unit/build checks
and packed production build are not substitutes for those full acceptance
gates. No real provider calls or automatic service activation were used.
