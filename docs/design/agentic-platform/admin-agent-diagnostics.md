# Admin Health and Doctor Agent diagnostics

This bundle follows PR #1462 at `7b095e2a` and exposes the existing safe Agent
health projection in Admin Health and Doctor. It does not change collection,
readiness, authority, lifecycle or maintenance behavior.

## Requirement and evidence map

| Requirement                  | Existing owner / returned evidence                                      | Presentation and boundary                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider and vault readiness | `NpAgentHealthSummaryV1.readiness`                                      | Exact ready, unknown, unavailable or not-required state and required/available adapter counts. A diagnostic host's unknown state is not a provider outage. |
| Runtime and queues           | `states` for agent, trigger, event, run and related entities            | Persisted state counts and record ages. These are not queue-consumer liveness or worker heartbeat.                                                         |
| Stale work and approvals     | Stable issue codes, counts and nullable ages; approval/run state groups | Show exact reported issues separately from state counts. Age is not an inferred stale threshold or time spent in a state.                                  |
| Retention                    | Existing lifecycle states / reference diagnostics                       | Evidence remains visible; job registration/readiness/last maintenance success is not supplied by this summary.                                             |
| Budget measurement           | Usage reservation/daily record counts and related diagnostics           | Counts are not tokens, spend, remaining budget or proof of measurement readiness.                                                                          |
| Snapshot freshness           | Collector-generated `generatedAt`                                       | Show the timestamp verbatim; Refresh collects again. No invented expiry or heartbeat.                                                                      |
| Safe presentation            | Existing admin.manage gate and aggregate contract                       | No new endpoint, row identifiers, secrets, mutation, provider activation or worker startup. Collector scope and route authorization remain unchanged.      |

Admin Studio §20.10 is improved within the returned evidence above. Full runtime,
retention and budget readiness still require their authoritative owners to supply
those facts; the UI explicitly names the missing measurements. No design
requirement is silently waived. Actual AT acceptance remains separately open in
[the consolidated checklist](admin-assistive-technology-acceptance.md).

The subsequent [maintenance evidence bundle](agent-maintenance-evidence.md) adds
a separate projection for actual committed retention work and bounded runtime
observations. The original snapshot and its evidence limits remain unchanged.

## Implementation

- `packages/app/src/lib/agent-health-presentation.ts` validates and formats the
  existing pure contract. Health and Doctor share it; CheckResult and health JSON
  shapes are unchanged. Doctor's detail string now includes complete aggregate
  evidence, while its check ID, severity and failure handling remain unchanged.
- The shared protected Health page renders `AgentHealth` without a new client
  fetch, timer, state store or polling loop. Readiness and issues are visible;
  native keyboard-accessible disclosure contains state groups to bound page height.
- Unknown issue age and an empty state group's absent age are distinct. Empty
  arrays never imply that a worker is running. Invalid extra fields fail closed
  without rendering their contents.
- Reference and scaffold remain thin wrappers. Server diagnostics retain their
  existing host-wide collection semantics; this bundle does not claim a new
  site-scoped query or expose more than the existing admin-only JSON projection.

## Verification

- Focused unit checks: 51/51 across Health rendering, Doctor invocation and existing
  system-health/Doctor suites. New cases cover exact aggregate evidence, null
  versus zero age, empty/unavailable snapshots, all readiness states, severity and
  rejected extra fields.
- `pnpm verify`: 113/113 tasks passed (107 cached), including reference production
  build and typecheck. Explicit strict NodeNext E2E typecheck passed separately.
- PostgreSQL: 13/13 across `agent-contract-diagnostics.integration.test.ts` and
  `agent-runtime-ops-diagnostics.integration.test.ts`, using an isolated database.
- Focused production Health browser: 1/1 without retries; actual generation time
  changes on refresh, native disclosure opens with keyboard, and the section does
  not overflow at 320/768/1280px in light/dark themes. Six returned screenshots
  were inspected. Populated/error projections have server-rendering tests; those
  screenshots show the actual empty snapshot, not every synthetic state.
- `pnpm lint`: 41/41 tasks passed (40 cached). The first run found one
  test mock query's unnecessary async modifier; it now returns a resolved Promise
  and the affected three Doctor tests passed again.
- Full production browser suite: 87/87 passed without retries (2.5 min), including
  the new Health case and existing lifecycle/recovery cases. Log:
  `/tmp/np-agent-diagnostics-browser-final.log`; retained artifacts:
  `/tmp/np-agent-diagnostics-browser-artifacts`. Generated media was moved out of
  the checkout to `/tmp/np-agent-diagnostics-generated-public`.
- Fresh installed packed-app consumer: 7/7 stages passed (repack, fresh scaffold,
  relink, install, typecheck, production build, operational journey). All 203 App
  dist files and the four changed presentation/Doctor sources matched installed
  bytes. The other 39 unchanged packages reuse the preceding packed baseline;
  this is not a new full 40-package build. Summary:
  `/tmp/np-agent-diagnostics-scaffold/summary.json`.
- Coordinator and delegated read-only review, changed-file formatting, documentation
  links/anchors and `git diff --check` passed. No unintended generated files remain.

Logs use `/tmp/np-agent-diagnostics-` with `unit-final.log`,
`verify-corrected.log`, `e2e-types.log`, `postgres.log` and
`browser-focused.log`.

The first new fixtures violated the existing count/age relationship; they were
corrected to keep zero-count absence distinct from a zero-second age. The app's
classic JSX test transform also required the existing React import convention.
Neither failure required changing a product contract. The first full gate still
observed the old JSX import failure; the subsequent build found the new TSX
relative import unsupported by the Next source resolver. The page now follows
existing extensionless Next source imports; the compiled Doctor helper retains
NodeNext `.js` imports. The corrected full gate passed.

Unchanged core/server behavior reuses prior Redis, native preview and broader
PostgreSQL/theme integration evidence linked from
[Admin state acceptance](admin-state-accessibility.md). These separate gates were
not rerun or reported as a new full R5 acceptance.

Versions, changesets, lockfile, schemas and migrations remain unchanged.
