# R6 Operator diagnostic recipe

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

The recipe requires a separately selected verified provider connection, permits
manual runs only and accepts no structured manual input. Studio offers “Use
Operator diagnostic setup” only when the recipe and its required capabilities
and scopes are available. The shortcut fills a new draft with advise autonomy,
`ops.status`, `audit.run`, `ops.plan`, default thresholds of 300 seconds and one
pending job, and conservative budgets narrowed by current site/deployment
ceilings. Provider selection, saving, delegation and activation remain explicit.
Execution budgets are zero; the preset does not offer `ops.execute`.

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

Broader source coverage, longitudinal progress verification and real-provider
usefulness evaluation remain open. This bundle does not close AP-602, AP-606 or
R6. Verification makes no external provider calls. Installation adds no
credentials, automatic activation or migration.

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
