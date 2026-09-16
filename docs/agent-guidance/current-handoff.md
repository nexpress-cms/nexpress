# Current work handoff

Observed while preparing the R5 evidence source lifecycle merge on 2026-09-16 KST.
Verify current Git state and the PR's final merge/check results before continuing.

## Objective and authorization

- User authorized committing, pushing and merging this coherent lifecycle bundle,
  then selecting the next task. Implementation of the next bundle is not started.
- Necessary schema/migration changes are authorized. Own package versions,
  changesets and lockfile remain unchanged.
- No new credentials, external provider calls or automatic Runtime/provider/worker
  activation. No package publication or Version PR merge is authorized.

## Observed checkout

- Repository: `/Users/baesw/development/nexpress`; implementation worktree:
  `/Users/baesw/.codex/worktrees/9755/nexpress`.
- Baseline: `71a0f5effd4f6ea2726fd5f438c4424621557890`.
- Branch: `codex/r5-evidence-source-lifecycle`. All pending changes belong to this
  bundle. Main was clean and synchronized when preparation began.
- This checkpoint is included in the same PR. Its final head, squash merge SHA
  and CI/Release results must be read from GitHub; do not treat them as verified
  merely because this handoff describes the intended merge.
- Main rules require a PR and checks. Wait for all four PR jobs; do not bypass.

## Implementation and evidence

- Typed source-release receipts preserve audit/canonical evidence while allowing
  verified expired Run/call/reservation/closed-breaker source details to be pruned.
- Read Actions keep immutable attribution; Activity resolves released history with
  current access checks. Admission keys remain consumed after Run deletion.
- Generated migrations 0049/0050 add receipt/edge/fence tables, guarded source
  references and the nullable Action receipt pointer. Pg-boss partition guards,
  diagnostics, site deletion and scaffold generation share the same protocol.
- See [implementation and full evidence](../design/agentic-platform/r5-evidence-source-lifecycle-design.md)
  and [retention boundaries](../design/agentic-platform/r5-runtime-retention-flow.md).
- Local verification: verify 113 tasks, lint 41 tasks, Core unit 1,962, Core
  PostgreSQL 68, Web PostgreSQL 1,478 including explicit native preview and theme,
  Redis 16, production browser 71, packed scaffold 40 packages / 60 stages.
- Web evidence combines the complete run with the corrected 29-test rerun and
  explicit native preview; it is not a second fully green whole-suite run.
  The implementation document records test-only lint exclusions and the extra
  lint attempt's memory failure. Original product-source lint passed.
- Upgrade failure rolls back both migrations; successful upgrade preserves legacy
  audit bytes. Versions/changesets/lockfile and existing migrations are unchanged.

## Next boundary

- Recommended next bundle: executor-owned structured manual-input support.
  Define bounded canonical storage and schema/version/digest bindings, validate
  during admission, consume from the existing executor, then enable compatible
  Studio recipes. Preserve replay identity, redaction and current authority checks.
- Start with the [Runtime Studio manual-input boundary](../design/agentic-platform/r5-runtime-studio-flow.md#activation-and-manual-admission)
  and [R5 roadmap](../design/agentic-platform/implementation-roadmap.md#r5--durable-provider-backed-agent-runtime).
  Inspect installed recipes and executor ownership before extending contracts.
- Keep unknown/global references, mutation Actions, approvals and rollback evidence
  protected. No generic audit cleanup or full R5 completion claim.
- The existing schema-null recipe/goal path remains supported. R6 template-specific
  Publisher/Moderator/Operator execution is separate from this proposed bundle.
- Begin the next implementation in a fresh task when the user requests it.
