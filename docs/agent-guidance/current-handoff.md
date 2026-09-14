# Current work handoff

Observed 2026-09-14. Verify Git state and user authorization before continuing.

## Objective and authorization

- Repository: `/Users/baesw/development/nexpress`.
- AP-507 management and related AP-508 visibility implementation is complete
  within the boundary in the [Runtime Studio flow](../design/agentic-platform/r5-runtime-studio-flow.md).
- The user authorized committing, pushing and merging the Runtime Studio bundle
  together with the AGENTS.md/context restructuring, then choosing the next task.
- Commit/PR/merge preparation is in progress; no merge is claimed yet.
- Keep package versions, changesets, lockfile and migrations unchanged. No
  automatic Runtime/provider/worker activation, new credentials or provider calls.

## Observed checkout

- Branch: `codex/runtime-studio-management`; base: `f012db55` (PR #1442).
- Working tree is dirty with the Runtime Studio bundle and context documentation.
  These are intentional changes, not leftovers to reset or discard.
- No PR was created for this bundle. Check remote state when a merge is requested;
  this handoff is not evidence that a remote branch is still unchanged.
- A new worktree will not automatically contain this uncommitted implementation.

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

## Remaining boundary

- Advanced policy simulation, broader retention and full R5 acceptance remain
  open. Do not mark AP-507 or R5 wholly complete based on this management slice.
- No next implementation bundle has been selected or authorized yet.
- If the user requests merge: review the complete dirty bundle, create the
  appropriate branch/commit/PR, verify current CI and follow repository merge
  rules. Do not reimplement the finished slice.
- After a confirmed merge, replace this handoff with the actual merge commit,
  clean/dirty state and agreed next objective; start the next requested bundle
  in a fresh thread using the [workflow](README.md#starting-the-next-task).
