# Admin Agent Studio error recovery

Follow-up to [Admin acceptance](admin-acceptance.md), based on PR #1458
(`b34dc7a6`). This bundle completes supported recovery behavior without changing
server authorization, the exact API error envelope, or Runtime activation.

## Recovery contract

- `AgentStudioApiError` retains safe status/code/message and an optional absolute
  retry deadline. Only 429 responses supply this deadline, from an integer-seconds
  or valid IMF-fixdate `Retry-After` header. Invalid/absent values do not invent a
  wait time. Expired dates allow explicit retry immediately.
- A shared recovery boundary removes sensitive rendered children on 401 and
  focuses a sign-in notice linking to the existing `/admin/login` route. It does
  not automatically navigate away, replay requests, or persist drafts/secrets.
  Owners clear rejected evidence and cancel superseded reads.
- During a valid 429 wait, existing mutation forms remain mounted and disabled;
  expiry enables an explicit retry only. Portal dialog actions have their own
  guards. Unknown-outcome retries keep the same unchanged request identity.
- Permission denial and recent staff-primary reauthentication remain distinct
  safe guidance. Neither creates authority or changes the existing invalidation
  contract. Conflicts still require review of current server facts.

## Owned flows

Connections and Gateway views retain recovery metadata through reads and
mutations. Authentication loss in a child OAuth/principal operation invalidates
its parent evidence and aborts outstanding reads. Runtime and policy views use
the same boundary, including nested editors and simulation.

Budget/operations partial failures identify the failed read and offer a dedicated
retry. Retrying Runtime status does not reread a healthy budget or reset its
unsaved editor. Budget mutation access loss removes rejected evidence. Unknown
measurements remain unknown.

Activity preserves typed failures and stops polling after failed reads. Approval
and ChangeSet reads now preserve recovery metadata, fence late responses after
mutation invalidation, and keep the distinction between explicit review refresh
and background reads. Waiting never authorizes automatic mutation replay.

## Verification and remaining acceptance

Final local code gates passed: 59 repository checks and 113 verification tasks,
41 lint tasks, and 41 production-build tasks. The focused API tests passed all
16 cases, including retry-header parsing and safe error metadata.

The complete production browser suite passed all 77 cases (76 existing journeys
plus one late-read invalidation case). Existing journeys cover server wait
boundaries, explicit retry, unchanged mutation identity, partial-read recovery,
login links and polling shutdown. The added race holds an actual mutation and GET,
then verifies that a late read cannot restore evidence after authentication loss.
No duplicate per-route Cartesian suite was added.

The final 320px session-loss and rate-limit captures and 320px/1280px review
rate-limit captures were visually inspected: notices and actions remain readable
and fit their containers. Automated assertions also check horizontal overflow.
This is not a human screen-reader result.

The first browser run exposed a moving test-clock boundary, an invalid cancel
fixture and duplicate reauthentication announcements. The fixtures and duplicate
UI announcement were corrected before the complete passing run; assertions were
not weakened. Logs and captures are retained under
`/tmp/np-admin-recovery-browser-final*`.

Packed consumer verification passed seven stages: fresh CLI scaffold creation,
final Admin repack, tarball relinking, install, typecheck, production build and
scaffold journey. All ten Admin dist files match byte-for-byte between the final
local build, tarball and installed consumer. The other 39 unchanged package
artifacts reuse the previous verified baseline; this is not a new 40-package
full rebuild. The lockfile is unchanged. Summary:
`/tmp/np-admin-recovery-scaffold/summary.json`.

The first consumer build stopped on local disk exhaustion after compilation.
Logs were retained, completed regenerable artifacts were removed, and the final
consumer checks ran sequentially. The failed attempt is not counted as passing.

Core/server/schema behavior is unchanged. This UI bundle reuses the passing
[PR #1458 CI](https://github.com/nexpress-cms/nexpress/actions/runs/35372125515)
and the scoped PostgreSQL, Redis, theme and separate native-preview evidence
recorded in [Admin acceptance](admin-acceptance.md). Those integration
gates were not rerun as a new full R5 gate. The complete production browser suite
above was rerun against the final local code.

Full R5/Admin acceptance remains open for actual screen-reader workflows and the
remaining per-surface/state/visual gaps in the acceptance record. This bundle does
not invent unavailable server freshness, heartbeat, support-correlation or generic
retryability contracts. No versions, changesets, lockfile or migrations are needed.
