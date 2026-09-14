# Current work handoff

Observed after PR #1445 merged on 2026-09-14 17:42 UTC (2026-09-15 02:42 KST).
Verify Git state and current user authorization before continuing.

## Objective and authorization

- Repository: `/Users/baesw/development/nexpress`.
- Bounded policy simulation, dependency-safe Runtime retention and the local
  acceptance audit were committed, pushed and squash-merged in
  [PR #1445](https://github.com/nexpress-cms/nexpress/pull/1445).
- The user authorized this merge and choosing the next task. No next feature,
  dependency update, Version PR or release was authorized by that instruction.
- Package versions, changesets, lockfile, schema and migrations were unchanged.
  Keep those constraints until the user explicitly changes the next bundle's
  scope. No automatic Runtime/provider/worker activation, new credentials or
  provider calls.

## Observed checkout

- Branch: `main`; merged implementation baseline:
  `9a87712f618e74742558ceae788d030dcf503e9c`.
- Checkout was clean and synchronized with `origin/main` after the merge.
  This handoff is a subsequent documentation-only commit; verify current HEAD
  and synchronization rather than assuming it is still the merge commit.

## Implementation and evidence

- Pure simulation owner: `packages/core/src/agent-contract/runtime-policy-simulation.ts`.
  Existing Runtime service/admission owns the audited non-authorizing operation.
  Shared App HTTP, Admin UI and reference/scaffold wrappers expose it only
  through the explicitly installed host. Fifteen Admin operations are installed.
- Retention owner: `packages/core/src/agent/runtime-retention.ts`, called by the
  existing maintenance jobs with `runtime-retention-budget.ts`. Seven categories
  preserve active work, unresolved usage/outcomes and Agent/audit/job references.
- Detailed scope, review fixes and all local gates:
  [Runtime Studio flow](../design/agentic-platform/r5-runtime-studio-flow.md#r5-completion-audit-and-current-verification),
  [retention matrix](../design/agentic-platform/r5-runtime-retention-flow.md).
- Local acceptance passed: verify 113 tasks, lint 41, Core PostgreSQL 68,
  Web PostgreSQL 1,433 (theme 5 included), explicit native preview 1, live Redis
  16, production Playwright 69, packed scaffold 40 packages / 56 stages.
- [PR CI run 34874219970](https://github.com/nexpress-cms/nexpress/actions/runs/34874219970)
  passed all four checks on exact head `9899d673e625fb27475f573e5f31dd4d71551563`.
  This records PR CI; inspect current main CI/Release separately if needed.
- Handoff/documentation updates need link/format/preservation checks and
  `git diff --check`, not repeated application builds.

## Recommended next task: dependency security fixes

- GitHub's open alerts at this checkpoint include two Critical Next.js alerts
  (#64 and #66), both listing 16.3.3 as the first patched version. Prioritize
  [the existing Next.js 16.3.4 PR #1422](https://github.com/nexpress-cms/nexpress/pull/1422),
  then review remaining sharp, nodemailer and transitive dependency alerts.
- This is a recommendation, not authorization to merge another PR. Starting
  this bundle requires the user to allow dependency manifests and lockfile
  changes; keep `@nexpress/*` package versions and changesets deferred.
- Recheck the selected PR's current diff, head, base and all four CI checks.
  Use the existing `pnpm merge:dependabot -- <pr>` workflow, its exact-head
  approval token and post-merge CI/Release checks; do not merge a Version PR.

## Subsequent R5 boundary

- Full R5 remains open. Normal audit references retain Runtime source details;
  there is no normal audit source-release owner. The Action attribution check
  also requires Run reference and fingerprint to be null together.
- Define verified evidence retention/source release and its reference matrix
  before implementation. Preserve audit, approval, rollback and unresolved
  outcome evidence. Agree on any necessary schema/migration scope first;
  do not silently detach references or erase immutable attribution.
- Structured manual-input recipes remain unavailable until their executor owns
  storage/consumption. Existing schema-null interactive recipe/goal admission
  is supported; template-specific executors belong to the R6 boundary.
- Start the next requested bundle in a fresh task using this handoff and the
  affected design sections. Reuse existing contracts/services and do not reload
  all historical guidance or repeat completed acceptance without a code change.
