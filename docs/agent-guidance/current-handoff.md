# Current work handoff

Observed 2026-09-21 KST. Verify Git state before continuing.

## Objective and authorization

- User requested Agent Studio error diagnostics/recovery after worker evidence
  PR #1466. Implementation, self-review and validation are complete as one bundle.
- The user authorized commit, push, PR and squash merge for this bundle on
  2026-09-21, followed by selecting the next task.
- Keep versions, changesets and lockfile unchanged. No provider calls, credentials,
  automatic worker/runtime activation, publication or Version PR #1366 merge.

## Observed checkout

- Primary `/Users/baesw/development/nexpress`: main at
  `e90871636b68b4c59e26b3738e93ff6fb7deeb53`; only this handoff modified.
- Implementation: `/Users/baesw/.codex/worktrees/agent-error-diagnostics/nexpress`,
  branch `codex/agent-error-diagnostics`, same base, uncommitted completed bundle.
- Previous PR #1466 merge CI 35584075905 and Release 35584075807 both passed.
- Do not assume primary main or a fresh worktree contains the pending code.

## Implementation and evidence

- Flow in the implementation worktree:
  `docs/design/agentic-platform/agent-error-diagnostics.md`.
- Core pure `api-contract/error-diagnostics.ts`: optional exact versioned header,
  status/code binding, bounded UUID/reference/recovery parser. API body unchanged.
- App `studio-error-response.ts`: server-generated reference and safe logger event;
  operation-aware guidance across existing Studio routes/factories. Logger
  submission does not guarantee durable storage. No request/provider data copied.
- Admin shared recovery rendering distinguishes declared read retry, reauthentication,
  reconciliation, uncertain mutation outcome and unavailable metadata. Existing
  auth, CAS, signed approval and unchanged-request idempotency semantics survive.
- Review fixed approval copy that could discard retry identity, old diagnostic
  state on new actions, and queued background reads restoring cleared review facts.
  The last case now stops reads until explicit refresh and clears busy presentation.
- Final verify 113/113; lint 41/41; reviewed build 41/41. Core units 2,122,
  Admin 166, App 585. PostgreSQL 50/50 includes enabled native preview browser.
- Final production browser 87/87, retries disabled, includes bundled themes.
  Three narrow diagnostic captures inspected. Initial failures and fixes are in flow.
- Fresh packed consumer: final Core/Admin/App bytes match 436/10/203 dist files;
  final relink/install/typecheck/build/journey passed. 37 unchanged artifacts reused.
  An intermediate ENOSPC was resolved using only obsolete task-owned output/cache.
- Logs: `/tmp/np-diagnostics-verify-final.log`,
  `/tmp/np-diagnostics-lint-reviewed.log`, `/tmp/np-diagnostics-pg.log`,
  `/tmp/np-diagnostics-browser-final.log`, and
  `/tmp/np-diagnostics-scaffold-final/summary-reviewed.json`.
- Redis was unaffected and not rerun; default unit gate skips three opt-in cases.
  No new full R5/Core PostgreSQL/40-package gate or spoken AT acceptance claimed.

## Next boundary

- Review the final diff, commit/push this authorized complete bundle,
  create a coherent PR, verify exact-head CI, and squash merge.
- Preserve this worktree until merged. Refresh this handoff after merge and choose
  the next coherent bundle from current Admin/R5 requirements.
- Do not reopen completed retention/manual-input work or repeat the unsuccessful
  VoiceOver investigation. Spoken AT remains the existing operator checklist.
