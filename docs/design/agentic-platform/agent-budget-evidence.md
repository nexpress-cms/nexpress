# Agent budget measurement evidence

This bundle follows PR #1464 at `36ecadb1`. It addresses the budget measurement
visibility requirement in [Admin Studio §20](admin-agent-studio.md#20-admin-release-acceptance)
through the existing Runtime accounting owner. It does not change accounting,
settlement, capacity comparison or admission policy.

## Evidence and ownership

The pure `NpAgentBudgetHealthV1` contract reports counts for the first 25 configured
sites in stable ID order, with a 26th row used only to detect truncation. It exposes
no site identity, provider payload, token amount, price or cross-site spend sum.

| Observation           | Required evidence                                                                            | Meaning                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measured site         | Existing usage-known predicate and actual budget measurement both succeed; counters validate | Measurement succeeded for that site, including a valid zero result. Does not prove capacity, activation or availability of future provider calls. |
| Unresolved usage site | Exact owning-service `RUNTIME_USAGE_UNKNOWN` error                                           | Usage is not yet known; not zero and not spare capacity.                                                                                          |
| Unavailable site      | Control/deletion validation, query, lock, timeout, counter or other measurement failure      | Measurement could not complete; raw errors stay private.                                                                                          |
| Unavailable sample    | Configured-site sampling failed                                                              | Counts and truncation are null, never an empty healthy sample.                                                                                    |

Measured, unresolved and unavailable counts partition the sampled sites. An empty
configured-site sample is an observed zero-site sample, not overall readiness.
All facts are informational and preserve existing Health/Doctor check IDs/severity.

`budget-health.ts` reuses `npRequireAgentRuntimeUsageKnownV1` and
`npMeasureAgentRuntimeBudgetV1` inside the existing site control/quota transaction.
The collector requires a root database handle so each site releases its locks
before the next; callers must not pass an existing transaction. Health uses the existing singleton
DB. Doctor wraps its original connected PostgreSQL Client in Drizzle and uses the
same transaction path; it does not use the string-only diagnostics query shim,
create a pool, replace the singleton or initialize Runtime.

Collection stops scheduling sites after five seconds. Each statement, including
lock waits, is capped at 500ms or the host's stricter timeout. A site already in
progress may finish after that scheduling deadline; this is not a hard five-second
whole-operation timeout. Unattempted sampled sites remain unavailable. Transaction
local timeout changes are restored and no settings, usage, runs or audit records
are persisted by inspection. No readonly transaction flag is used because the
existing control read intentionally takes `FOR SHARE` locks.

The shared Health component and Doctor formatter validate the new aggregate
contract before display. Existing Runtime Studio's `usage: null` handling remains
unchanged. Reported usage, adapter estimates, reserved charges and target-specific
unsupported dimensions retain their current accounting semantics; this projection
does not combine or relabel them.

## Verification

- Core contract/collector focused tests: 5/5. Full Core unit suite: 2,109/2,109.
- App Health/Doctor/system-health focused tests: 57/57, including actual original
  Client identity, unchanged severity, malformed projections and safe failure text.
- New PostgreSQL evidence suite: 6/6, covering no writes on empty measurement,
  real ambiguous/reconciled/missing-daily transitions, invalid controls, bounded
  sorted sampling, real quota-lock timeout and preserved host timeout settings,
  and Doctor-owned Client operation without the Runtime singleton.
- Existing usage, controls, Studio and ops-diagnostics PostgreSQL suites: 51/51.
  Combined selected DB checks: 57/57, no skips. Logs:
  `/tmp/np-budget-health-integration-corrected.log` and `/tmp/np-budget-postgres.log`.
- `pnpm verify --concurrency=2`: 113/113 tasks passed (104 cached on corrected
  final run); `pnpm lint`: 41/41 tasks passed (39 cached). Strict NodeNext E2E
  TypeScript passed. Logs: `/tmp/np-budget-verify-corrected.log`,
  `/tmp/np-budget-lint.log`, `/tmp/np-budget-e2e-types.log`.
- Production browser: 87/87 without retries (2.7 min). New budget section shows
  actual measured-site evidence, preserves refresh freshness and has no horizontal
  overflow at 320/768/1280px in light/dark themes. Six budget captures were inspected.
  The browser's real snapshot has one measured configured site; mixed/unavailable
  views have server-render coverage and real PostgreSQL evidence transitions.
  Log: `/tmp/np-budget-browser.log`; captures: `/tmp/np-budget-browser-artifacts`.
  Generated browser media was moved to `/tmp/np-budget-generated-public`.
- Fresh packed Core/App consumer: 8/8 stages passed, including installed typecheck,
  production build and operational journey. All 434 Core and 203 App dist files,
  plus changed App source files, match installed bytes. The other 38 unchanged
  package artifacts reuse the preceding packed baseline; this is not a new full
  40-package gate. Summary: `/tmp/np-budget-scaffold/summary.json`.
- Changed-file formatting, links, self-review and `git diff --check` passed.
  Unchanged broader PostgreSQL, Redis, theme and native-preview behavior reuses
  evidence linked from [Admin state acceptance](admin-state-accessibility.md);
  those separate gates were not rerun or claimed as a new full R5 acceptance.

The first new integration assertion assumed two sites, while the reused usage
fixture creates three. The assertion now uses the fixture's actual site inventory;
no product behavior changed. Self-review confirmed that site locks must use real
transactions, Doctor must pass its original Client (not its query shim), and
root DB handles are required to release each site's locks independently. The first
full gate caught Doctor's Drizzle generic defaulting to Pool despite a Client
argument; the bridge now explicitly types both schema and actual Client, retaining
the same original handle and transaction semantics.

## Remaining boundary

Measurement success does not establish full Runtime readiness or remaining budget.
Agent-specific remote consumer liveness and actual spoken assistive-technology
acceptance remain separate. See [maintenance evidence](agent-maintenance-evidence.md)
and [the operator checklist](admin-assistive-technology-acceptance.md).

Versions, changesets, lockfile, schemas and migrations remain unchanged. No provider
calls, new credentials, worker activation or publication are part of this bundle.
Commit/PR/merge follow the current user authorization in the handoff.
