# Current work handoff

Observed on 2026-09-17 KST. The structured manual-input bundle is implemented
and verified locally; it is ready for review, not committed or merged.

## Objective and authorization

- Implement Runtime Studio structured manual input through validation, durable
  admission, actual executor consumption and result navigation.
- Implementation and the generated migration were authorized; the user has now
  explicitly authorized committing, pushing and merging this coherent bundle.
- Preserve package versions, changesets and lockfile. No credentials, live
  provider calls, automatic Runtime/worker activation or R6 recipe installation.

## Observed checkout

- Worktree: `/Users/baesw/.codex/worktrees/b7e5/nexpress`.
- Branch: `codex/runtime-manual-input`; baseline
  `61f166f6ba44359de21610ecbec3dcc13f7e01d3` (PR #1450).
- Checkout began clean. All pending code, migration and documentation changes
  belong to this bundle; no pending changes were assumed to cross worktrees.
- This checkpoint is included in the merge PR. Verify GitHub for its final
  head, squash merge SHA and CI results before continuing.

## Implementation and evidence

- Coordinator owns admission, Run schema/migration, canonical digest binding,
  Admin journal redaction and retention integrity. Independent owners implemented
  the pure schema/Studio UI and context consumption; separate review inspected
  authority, replay, copies and retention references.
- Closed flat scalar schemas: at most 16 fields, bounded strings/integers/booleans,
  optional enums and 8 KiB canonical input. Unsupported/authority schemas fail
  closed. Only compatible explicitly installed interactive recipes are offered.
- Run owns source input/digest in the existing admission transaction/outbox.
  New structured Admin journals keep a digest instead of duplicate input JSON.
- Structured input/goal become redacted sensitive-approved untrusted provider
  evidence. Admission checks the ceiling. Schema-null behavior stays unchanged.
- Generated `0051_futuristic_absorbing_man.sql` adds two nullable columns and one
  consistency constraint. Reviewed SQL is additive; Doctor inventory is 285.
- [Feature flow and design](../design/agentic-platform/r5-runtime-studio-flow.md#structured-manual-input-storage-and-execution)
  describes storage, eligibility, errors and preserved boundaries.
- Passed: final verify 113 tasks (CLI concurrency 2), including Core 1,968,
  Admin 151, App 555 and Web 174 unit tests.
- PostgreSQL: Core 64; Web 1,426 ordinary cases across the full run and corrected
  64-case rerun (5 files). Explicit native preview 1 and live Redis 16 passed.
- Production browser 72 passed. Fresh packed scaffold passed with 40 packages,
  generated migrations, foundation/Doctor, production build, extensions and
  module-resolution/first-run journeys. Workspace lint passed with Web heap 8 GiB.
- The full PostgreSQL run found a replay recipe-mismatch error-order regression,
  nine test-origin mismatches and a reference-fence cleanup timeout. Restoring the
  early replay guard, using the expected test origin and rerunning the five
  affected/related files passed all 64 cases without relaxing assertions.
- An initial inventory expectation was updated for the added constraint; an
  existing Runtime job unit timeout passed on retry. Web lint exceeded its 6 GiB
  heap and passed at 8 GiB without changing repository configuration.

## Next boundary

- Complete the authorized squash merge after all four exact-head PR checks pass.
  No package publication, Version PR merge or deployment is authorized.
- Studio staff-audit targets and Admin invocation result references have no
  current source-release owner: they indefinitely retain Run/input after policy
  and replay expiry. Direct host admissions without protected owners can expire.
  Derived provider/Action text retains its existing evidence lifetime.
- Full R5 retention and template-specific R6 Publisher/Moderator/Operator remain
  open. Do not claim their completion or bypass protected audit/invocation owners.
- Recommended next bundle: add explicit release ownership for expired Studio
  staff-audit and invocation-result references, preserving immutable audit/replay
  evidence while allowing terminal Run/input deletion. Define the reference
  matrix first; keep active work, unresolved outcomes and approval/rollback
  evidence protected. Next implementation requires a fresh user request.
