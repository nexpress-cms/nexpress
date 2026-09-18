# Current work handoff

Observed after local acceptance of PostgreSQL CI partitioning on 2026-09-18 KST.
Verify Git state and live workflow status before continuing.

## Objective and authorization

- User authorized PostgreSQL CI partitioning and asked to continue after local
  acceptance. Continue through commit, push, PR and hosted CI verification.
  Wait for a separate merge instruction.
- Preserve versions, changesets and lockfile. No product/schema changes, provider
  calls, credentials, automatic activation or publishing. Do not merge Version PR #1366.

## Observed checkout

- Worktree: `/Users/baesw/development/nexpress-postgres-ci-partitions`.
- Branch: `codex/postgres-ci-partitions`; baseline/HEAD `78b31c8b` (PR #1455).
- This bundle is being committed for PR and hosted CI verification.
- Primary `/Users/baesw/development/nexpress` remains on main; its documentation-only
  handoff points here. Do not assume primary contains pending code.
- Prior PR #1455 CI `35331913087` passed all four checks; PostgreSQL took 28m14s.
  Merge-head CI `35334340046` passed. Release `35334340127` failed because its
  Version PR CI `35334403873` PostgreSQL job exceeded its 30-minute limit
  (30m18s elapsed); other
  Version PR jobs passed. No Version PR merge or publication was performed here.

## Implementation and evidence

- [Testing guidance](../testing.md#ci-integration-partitions) owns the partition
  design, baseline timings, local commands and remaining hosted-CI measurement.
- `.github/workflows/ci.yml` now runs two independent PostgreSQL matrix jobs.
  Core runs once in partition 1; Redis runs once in partition 2. E2E/native preview
  and scaffold checks are unchanged. Local `pnpm test:integration` is unchanged.
- `scripts/integration-partitions.mjs` uses actual Vitest file discovery, measured
  weights with a new-file fallback, exact selection checks and coverage receipts.
  Unknown integration owners and missing DB settings fail rather than silently skip.
- Existing `integration tests (Postgres)` aggregate requires successful matrix
  jobs and both matching-commit receipts with exact, nonduplicated coverage.
  Stable artifact names with overwrite permit partial reruns. Version PR and
  Dependabot required-check names remain unchanged.
- Four focused script tests and actual discovery passed: 163 Web files, groups
  83/80, historical weights 1,932,441/1,932,474ms. Weights are not elapsed time.
- `pnpm verify --concurrency=2` passed: repository tests 59 and 113 cached workspace
  tasks. Lint passed with 41 cached tasks. No application code changed.
- Both actual DB partitions passed: Core 64; Web 665 + 784 = 1,449, with only the
  expected native-preview skip; Redis 16. Aggregate verified all 163 Web files
  exactly once, Core once and Redis once. Existing native/E2E/scaffold jobs unchanged.
- Local Web durations were 360.40s / 325.29s, measured sequentially on separate
  disposable DBs sharing one server. No hosted speedup is claimed.
- Self-review corrected artifact overwrite for reruns; YAML, format and diff
  checks passed. Versions, changesets, lockfile and migrations are unchanged.
- Logs/results: `/tmp/np-ci-partition-*`, `/tmp/np-ci-partitions-*`.

## Next boundary

- Implementation, self-review and local acceptance are complete. Finish the PR
  and hosted CI verification, then await a separate merge instruction.
- Hosted timing improvements and artifact transfer require the PR
  CI run; do not claim measured hosted speedup from the historical weight balance.
- After a separately authorized merge, refresh this handoff and resume remaining
  R5 acceptance/retention work. Full R5 remains open.
