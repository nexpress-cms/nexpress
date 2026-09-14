# Current work handoff

Observed after PR #1444 merged on 2026-09-14 UTC (2026-09-14 23:43 KST).
Verify Git state and user authorization before continuing.

## Objective and authorization

- Repository: `/Users/baesw/development/nexpress`.
- AP-507 management and related AP-508 visibility implementation is complete
  within the boundary in the [Runtime Studio flow](../design/agentic-platform/r5-runtime-studio-flow.md).
- The user authorized committing, pushing and merging the Runtime Studio bundle
  together with the AGENTS.md/context restructuring, then choosing the next task.
- Both bundles were committed, pushed and squash-merged in
  [PR #1444](https://github.com/nexpress-cms/nexpress/pull/1444).
- Next implementation is proposed below; wait for the user's instruction to start.
- Keep package versions, changesets, lockfile and migrations unchanged. No
  automatic Runtime/provider/worker activation, new credentials or provider calls.

## Observed checkout

- Branch: `main`; feature integration baseline:
  `1abb5de2d9bd409801798c1c92861eccf8b572c0` (PR #1444).
- The implementation checkout was clean after fast-forwarding to the merge.
  This handoff is a subsequent documentation-only commit; it does not change
  the tested implementation. Verify current HEAD and remote synchronization.

## Implementation and evidence

- Pure Studio contracts: `packages/core/src/agent-contract/runtime-studio-contract.ts`.
- Read facade: `packages/core/src/agent/runtime-studio-service.ts`; existing
  Runtime service/admission/events/controls own the fourteen mutations.
- Shared HTTP: `packages/app/src/lib/agents/runtime-admin.ts`; Admin UI is under
  `packages/admin/src/agents/`. Reference/scaffold pages and routes are wrappers.
- Activity/OpenAPI preserve `usage: null` only for unknown Runtime usage.
  Archived draft history and errored-Agent recovery actions were corrected.
- Local code acceptance: workspace 113 tasks; lint 41; Core unit 1,911; Core
  PostgreSQL 68; Web PostgreSQL 1,418 ordinary cases across full/corrected runs
  (theme 5 included); native preview 1; Redis 16; production browser 67;
  packed scaffold 40 packages / 56 stages. Full results and limitations are in
  the flow linked above. Browser fixtures now isolate login/preview rate limits.
- Context restructuring changes documentation only. Check preservation, links,
  formatting and `git diff --check`; do not rerun application builds for it.
- PR CI run `34854794200` passed all four checks on exact head `a4376cee`:
  typecheck/build/test, PostgreSQL integration, Playwright E2E and fresh scaffold.

## Remaining boundary

- Advanced policy simulation, broader retention and full R5 acceptance remain
  open. Do not mark AP-507 or R5 wholly complete based on this management slice.

## Proposed next bundle: remaining R5 completion

- AP-507: implement bounded, non-authorizing policy simulation using the existing
  `agents.policies.simulate` operation and actual policy evaluator. Use versioned
  synthetic fixtures or explicitly selected redacted facts; never execute a
  capability or grant authority during simulation.
- AP-508: extend dependency-safe retention through existing host-registered
  maintenance jobs. Define the retention/reference matrix first; preserve active
  work, unresolved usage/outcomes and required audit/approval/rollback evidence.
- Audit full R5 acceptance against the roadmap and testing design, fix discovered
  gaps and run the complete gate, including PostgreSQL, Redis, theme, native
  preview, production browser and packed scaffold. Do not claim the full gate
  merely because this management slice passed.
- Structured manual-input recipes remain unavailable until their existing
  executor owns storage/consumption. Explicitly assess this boundary when checking
  R5 completeness; do not silently fabricate support or omit a required gate.
- Start with the roadmap, Admin Studio simulation requirements, Runtime Studio
  flow and relevant testing/retention sections. Reuse existing contracts/services;
  do not reload all historical guidance or repeat completed acceptance needlessly.
- Suggested fresh-thread request: "현재 인계서를 읽고 Git 상태를 확인한 뒤,
  남은 R5 정책 시뮬레이션·retention·종합 인수 검증을 진행해줘.
  기능과 기존 계약을 유지하고, 버전/changeset은 변경하지 말고,
  셀프리뷰와 검증까지 완료해줘. 커밋·PR·머지는 별도 요청을 기다려줘."
