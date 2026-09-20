# Current work handoff

Observed 2026-09-20 KST after the assistive-technology investigation. Verify Git first.

## Objective and authorization

- User authorized actual AT investigation, remaining acceptance reconciliation,
  and fixes for reproduced defects after PR #1460. Investigation and the consolidated
  runbook are complete; actual product screen-reader workflow acceptance is not verified.
- No product defect was reproduced, so this bundle changes documentation only.
  User now authorizes commit, push, PR and squash merge after CI, then selection
  of the next bundle. Further implementation awaits instruction.
- Delegation is acceptable; the coordinator must collect and verify results before
  reporting. Avoid repeated approvals for already authorized work.
- Preserve versions, changesets and lockfile. No provider calls, new operational
  credentials, automatic activation, publication or Version PR #1366 merge.

## Observed checkout

- Pending documentation: `/Users/baesw/.codex/worktrees/2e7d/nexpress`, branch
  `codex/admin-at-acceptance`, baseline `bf348d9c5b27affd79b84fee0a6c84d4853334e2`.
- Worktree reused only after verifying the previous PR head was clean. No old
  squash-merged commit was replayed. Current changes are uncommitted.
- Primary `/Users/baesw/development/nexpress` remains main at that baseline with
  only this local handoff pointer modified. A new checkout lacks the pending docs.
- PR #1460 CI `35503109565`, merge CI `35503812632` and Release `35503812568`
  all passed. No package publication or Version PR merge was performed by this work.

## Implementation and evidence

- [AT acceptance](../design/agentic-platform/admin-assistive-technology-acceptance.md)
  owns the requirement matrix, exact observation limits and six scenario checklist.
  Existing presentation/recovery records link to it without rewriting prior evidence.
- macOS 26.3 / VoiceOver bundle 10 / installed Chrome 153.0.8010.50 inspected.
  VoiceOver app queries timed out twice; Settings confirmed running and Utility
  showed caption display enabled, but actual speech/caption text was not captured.
  VoiceOver was switched off and off state/process absence checked; temporary
  windows/tab were closed. AppleScript control remained disabled; no OS permissions added.
- No product workflow ran with verified AT output. DOM/AX and automated keyboard
  evidence are not actual utterances. No new application build/browser/DB gate claimed.
- Existing activation and rollback browser cases exercise conflict/access loss,
  not full successful lifecycles. Successful connection revoke also needs its own
  AT scenario preparation. These are evidence gaps, not reproduced product bugs.
- Documentation formatting, references and diff whitespace are the relevant checks.

## Next boundary

- Actual AT is one consolidated open gate, not another round of generic UI audits.
  Prepare contract-valid synthetic success responses for the named missing branches,
  then have an operator with observable VoiceOver output execute the six scenarios.
- Record versions/settings, keys, actual utterances/captions, timing, focus return,
  returned outcome, artifact and pass/fail/not verified for each. Never substitute
  expected text or a Playwright assertion for an actual announcement.
- Fix reproduced issues as one bundle and rerun affected gates. Full Admin/R5 stays
  open until required evidence exists. Unsupported freshness/heartbeat/correlation/
  retryability and full Health/Doctor presentation remain separately named requirements.
- Do not reopen completed retention/manual-input work or fabricate incident support.
