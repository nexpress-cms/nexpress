# R6 Operator diagnostic recipe

The later [source and recovery-monitoring flow](r6-operator-source-monitor-flow.md)
adds the explicit V3 event profile, canonical operational producers, concrete
local pg-boss runbook plan and bounded before/after recovery evidence. This flow
preserves the original diagnostic profile; existing installations are not
automatically changed or activated.

The explicitly installed `operator.worker-not-draining` recipe connects Studio
setup, current operational observations and an owner-backed plan for human review.
It extends the [operational observations](r6-operator-observations-flow.md) and
[approved execution](r6-operator-execution-flow.md) flows. This recipe itself has
no execution capability.

## Installation and setup

Hosts call `npCreateAgentOperatorRecipeDefinitionV1()` from
`@nexpress/core/agent-contract` and include its result in their existing explicit
Runtime recipe registry. The factory supplies immutable instruction bytes and a
verified digest, bounded settings and the existing capability input schemas.
Importing the factory or draft preset does not register services or activate an
Agent, provider or worker.

The base V1 definition requires a separately selected verified provider connection,
permits manual runs only and accepts no structured manual input. Studio offers “Use
Operator diagnostic setup” only when the recipe and its required capabilities
and scopes are available. The shortcut fills a new draft with advise autonomy,
`ops.status`, `audit.run`, `ops.plan`, default thresholds of 300 seconds and one
pending job, and conservative budgets narrowed by current site/deployment
ceilings. Provider selection, saving, delegation and activation remain explicit.
Execution budgets are zero; the preset does not offer `ops.execute`.

Hosts may separately select the
[explicit unattended installation profile](r6-unattended-flow.md), which adds
schedule eligibility to Operator while preserving the original manual factory
bytes. The profile has its own exact registry/definition fingerprints and requires
a new saved and explicitly activated Agent definition to adopt it. Selecting a
profile does not register a trigger, enable a worker or activate a provider.

The selected settings become an `internal-redacted` trusted server fact only for
the shipped instruction template. The existing immutable definition and authority
digests bind them to the run. A provider connection whose data ceiling excludes
this classification cannot consume the fact. Existing custom Operator instruction
templates keep their prior context behavior.

## Observation and plan boundaries

The App host's explicit `workerDiagnostics: "pg-boss"` option adds
`operator.worker` to Jobs status. `authorizeDeployment` must permit the current
caller to inspect the deployment before and after collection and before release.
The existing site Jobs cohort remains a separate `operator.jobs` check. Runtime
admission passes selected recipe thresholds as server-owned metadata; capability
inputs cannot set them. Calls outside Runtime use the documented 300-second /
one-job defaults.

The collector reuses the existing global Agent queue backlog, bounded worker
heartbeat/subscription sample and persisted Jobs pause owner. The pending-count
and age thresholds must be met within the same queue. Scheduled work is excluded
from due backlog. Intentional pause is distinct from aged pending work; missing,
failed or partial observations stay unknown. Worker freshness continues to use
the existing owner's contract, not the recipe's pending-age threshold. A single
snapshot or heartbeat never proves throughput, draining, readiness or failure.
Only aggregate counts and fixed diagnostic text leave this collector; pause
reasons, actor IDs, heartbeat metadata and raw job payloads do not.

The host may additionally select `progressDiagnostics: "pg-boss"` to read actual
latest retained start/completion timestamps over a fixed, source-clock 15-minute
interval. Site transitions require the installed site Jobs owner and current site
authority; deployment Agent transitions independently require `workerDiagnostics`
and current deployment authority. The separate `operator.jobs.progress` and
`operator.worker.progress` checks do not upgrade the heartbeat/snapshot diagnosis
into a worker-health claim. Status and retained site audits preserve the exact
interval and bounded aggregate counts.

Each progress read is bounded to 1,000 rows and 500 ms; audit snapshot and progress
samples share the existing target budget. A complete retained sample with actual
starts or completions establishes sampled progress only. Failed/cancelled counts
remain distinct; retry attempts overwritten on a row or deleted history are not
reconstructed. Zero, partial or unavailable evidence stays unknown and cannot
prove a stuck worker, draining, throughput or complete history. The
[observation owner](r6-operator-observations-flow.md#retained-transition-progress)
documents source selection, authority and receipt/retention details.

An optional `ops.plan` request still needs the existing task-specific plan owner.
No default queue mutation or generic command is invented. Missing owners stay
unavailable. A returned plan is a retained review artifact; this recipe cannot
execute it. The separate approved execution flow continues to own its closed
operations and human approval bindings. Queue-global plans remain manual handoffs.

## Evaluation and acceptance

Versioned synthetic worker fixtures cover due versus scheduled work, pause,
aged pending work, partial and unavailable observations, and authority loss.
The PostgreSQL journey uses the actual Runtime admission/context/executor,
usage accounting and Operator facade, a persisted pause and actual observation
owners. Its provider responses and manual plan owner are deterministic fixtures.
These checks establish contract and orchestration behavior, not model diagnostic
quality or the usefulness of generated plans.

Retained transition progress now has a concrete bounded source and focused
verification. Broader source coverage, complete longitudinal history and
real-provider usefulness evaluation remain outside this slice. These checks do
not close the full AP-606/R6 quality gate. Verification makes no external provider
calls. Installation adds no credentials, automatic activation or migration.

## Local verification (2026-10-01)

- `pnpm verify --concurrency=1`: all 113 tasks passed, including Core 2,199,
  App 670, Admin 176 and Web 174 unit tests and the reference production build.
- `pnpm lint`: all 41 tasks passed. Final lint cleanup removed erased TypeScript
  assertions and corrected test stubs only. Production JavaScript emission was
  unchanged; Core/App typechecks and the affected 38 unit cases passed afterward.
- PostgreSQL: 27 cases across the new recipe Runtime journey and existing
  context, executor and Operator Runtime suites passed against an explicitly
  isolated database; none were skipped. The new cases confirm persisted pause
  observations reach the next provider context, plan-only behavior, authority
  revocation and completed-run replay.
- Production browser: the new Operator setup and existing typed-draft regression
  passed on their first attempt. Real Admin login and production rendering use
  fixture-backed Studio API responses; checks cover explicit provider/model
  selection, bounded submitted payloads, no automatic delegation/activation and
  390px/1280px overflow. Actual Runtime persistence is covered separately above.
- A fresh project outside the workspace installed all 40 packed public packages,
  invoked the published recipe factory, passed configuration-inclusive typechecking,
  generated/applied migrations to its fresh database, verified the Agent foundation
  (52 tables, 365 critical and 17 deferred constraints), and passed production
  build and the scaffold command journey. Installed Core contract, Admin client
  and App host JavaScript/declaration bytes matched the tested producer files.
- Modified-file formatting, document links, repository checks and `git diff --check`
  passed. The pre-existing handoff edit was preserved byte-for-byte.

Redis integration (including three optional cases skipped by the ordinary unit
run), theme PostgreSQL and native preview were not rerun for this recipe slice.
The focused browser cases do not constitute the full R6 browser or model-quality
acceptance gate. Package versions, changesets, lockfile and repository migrations
remain unchanged.

## Focused retained-progress verification (2026-10-15)

The progress extension and inspection-budget correction passed 26 App host,
projection and observation cases, Core/App
test-inclusive typechecks, the focused Web test-inclusive check, production
ESLint, formatting and `git diff --check`. All three new PostgreSQL progress
cases passed without skips against the separate isolated test cluster. The
[observation verification record](r6-operator-observations-flow.md#focused-progress-verification-2026-10-15)
describes their actual-source and authority coverage.

This focused result does not substitute for real-model diagnostics, generated-plan
usefulness or the full R6 gate. The historical recipe verification above is
preserved; the coordinator records the complete bundle gate separately.
