# Admin state and accessibility follow-up

Implementation based on PR #1459 squash `e7d3e664`, preserving the
[error-recovery](admin-error-recovery.md) and
[Admin acceptance](admin-acceptance.md) contracts. No public API, permission,
Runtime/provider activation, schema, version, changeset or lockfile changes.

## Supported presentation

Activity lists and Run/Action details use a static, motion-free read skeleton,
a persistent page title, polite refresh status and an exact browser receipt time.
Validated read-only facts remain visible during the same-resource refresh. A
failed read removes its evidence and receipt; another path never borrows them.
Run actions identify their own failed read and retry independently, keeping the
separately loaded Run facts visible.

Approval and ChangeSet lists/details share the read presentation. Explicit
refresh still invalidates mounted review facts and authorizing controls; the
status explains this deliberately different behavior. Background ChangeSet
polling retains mounted controls and retry identity, announces the read, and
marks it busy without resetting exponential backoff. Mutation invalidation
aborts the active read and prevents late data from restoring rejected evidence.
401/403 clearing, 429 waits and unchanged unknown-outcome retry identity remain
owned by the existing recovery implementation.

Connection OAuth-client reads distinguish initial loading, no installed host,
authorized empty results and independent failure. A failed OAuth-client read
does not erase the validated provider/principal projection. Gateway principal
dialogs focus their title, return focus on close, and focus failed submissions.
Long connection/policy names and narrow action groups wrap without page overflow.
Connection/principal status badges retain their width beside long names. Native
date controls in Activity and token forms use the actual light/dark color scheme.

Gateway service-token issuance and revocation keep unchanged retry identity.
Copy success/failure is announced, hiding the one-time value restores focus to
Create token, and successful revocation clears any displayed one-time value.
The browser fixture uses only synthetic token material and mocked endpoints.

## Applicable state boundary

| Requested state                   | Supported interpretation                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Initial loading / refreshing      | Static skeleton, retained read-only values, explicit invalidating review refresh, background polling status.                    |
| Empty / missing                   | Authorized empty lists remain distinct from missing or forbidden details and absent installed services.                         |
| Stale / freshness                 | Only exact local receipt time is available. No server cache-age, freshness verdict or heartbeat is inferred.                    |
| Partial failure                   | Independently owned Run actions, OAuth clients and existing budget/Runtime reads identify their own failure and recovery.       |
| Contract / safe API errors        | Validated error code/message plus optional [server diagnostics](agent-error-diagnostics.md); absent metadata stays unavailable. |
| Authentication / forbidden / 429  | Existing fail-closed clearing, login link, polling stop and exact supported Retry-After wait.                                   |
| Conflict / mutation error         | Existing CAS/review invalidation and unchanged-request retry semantics; no fictional mutation on a read-only list.              |
| Provider / worker / budget health | Only returned contract facts. A missing host or unknown measurement is not a synthetic health verdict.                          |
| Incident response                 | No shipped incident route. Its future product gate is not represented by a fixture.                                             |

## Browser and assistive-technology evidence

New fixtures extend existing journeys instead of multiplying every route/state
combination. They cover delayed Activity list/Run/Action reads, independent Run
actions recovery, delayed approval/ChangeSet queues, explicit review invalidation,
and retained background review refresh. Evidence lives in
[`Activity states`](../../../apps/web/tests/e2e/agent-activity-states.spec.ts),
[`approvals`](../../../apps/web/tests/e2e/agent-approvals.spec.ts),
[`ChangeSets`](../../../apps/web/tests/e2e/agent-changesets.spec.ts),
[`connections/tokens`](../../../apps/web/tests/e2e/agent-connections.spec.ts),
[`policy states`](../../../apps/web/tests/e2e/agent-states.spec.ts) and
[`Gateway principals`](../../../apps/web/tests/e2e/agents.spec.ts).
Bounded lists use 50 Activity,
connection and policy records and 25 approval/ChangeSet records. Captures cover
320/768/1280 CSS pixels, light/dark and reduced motion. Korean copy is used in
free-text fields; sealed identifiers and enum-only approval facts remain valid
contract values rather than invented localized server fields.

Connection/policy/Gateway keyboard and recovery assertions supplement existing
activation, approval, rollback and error-recovery journeys. Automated focus,
names, descriptions and screenshots are browser evidence only. The added token
journey checks issue failure/recovery, exact retry payload, one-time disclosure,
clipboard acknowledgement, explicit hiding, no redisclosure after refresh,
revocation recovery and authentication-loss clearing.

VoiceOver is installed on this macOS host and was not running during inspection.
Available tools provide DOM/accessibility snapshots and keyboard/UI control but
no captured screen-reader speech stream. No actual VoiceOver announcement or
complete human screen-reader journey was verified. A human check must record
browser/AT versions and complete connection, activation, approval, rollback and
applicable Gateway/token flows, including failure/recovery. Full Admin/R5 remains
open for that evidence and unsupported server-state requirements above. Completed
retention/manual-input work is not reopened.

The later [assistive-technology record](admin-assistive-technology-acceptance.md)
records environment inspection, the unresolved speech-observation gate and one
consolidated workflow checklist. It does not replace this bundle's browser evidence.

## Verification

Final code gates: `pnpm verify --concurrency=1` passed 59 repository checks and
113 workspace tasks (101 cached); `pnpm lint` passed all 41 tasks (40 cached).
The final verification includes the reference production build and workspace typechecks.
Logs: `/tmp/np-admin-state-verify-complete.log` and
`/tmp/np-admin-state-lint-complete.log`.

The initial production browser run passed 80/83. Two synthetic fixture names
ended with whitespace and correctly failed canonical contract validation; one
alert selector also matched the Next route announcer. The fixtures were fixed,
with no product-validator relaxation. The focused rerun passed all four cases.
Visual review found a narrow connection badge compressed into multiple lines and
low-contrast native date-picker icons in dark mode; both were corrected. Theme
capture checks now wait for applied theme/dialog colors instead of photographing
an in-progress transition. A subsequent browser run exposed two test-only
issues: waiting for an animation frame with a deliberately paused polling clock,
and comparing a CSS color token serialized as `lab()` with a hard-coded `rgb()`
string. The unnecessary clock wait was removed and the color expectation resolves
the declared neutral token before comparing the settled dialog background.
The expanded principal workflow also received a real shared-bucket 429 during
a full-suite run. It now uses the existing TEST-NET rate-limit isolation helper,
including retry/repeat identity; production limits are unchanged.
The first lint run also caught a Promise-returning
click handler; the final handler and lint rerun passed.

The initial verification completed its tasks but emitted an ENOSPC cache-write
warning. Only regenerable Next cache artifacts were removed, including one old
Turbo archive whose manifest contained Next output and its build log. Source and
logs were preserved. Subsequent builds and consumer checks run sequentially.
A new isolated local PostgreSQL database supplies browser fixtures because the
previous test container port is unavailable. Applying existing migrations there
is test setup, not a newly claimed integration gate.

Final production browser: **83/83 passed**, no retries or skips, in 2.5 minutes.
Log: `/tmp/np-admin-state-browser-verified.log`; full captures:
`/tmp/np-admin-state-browser-verified-artifacts`.

Visual inspection covered Activity, approval and ChangeSet queue top/end sections
at all three widths in both themes; connection/policy initial list sections,
Gateway dialogs and token forms at the same six combinations; and the narrow
OAuth partial-failure state. This does not claim a manual examination of all
50 rows. Final captures were rechecked for the corrected 320px connection badges,
768/1280px dark dialog contrast, and 320px dark Activity/token date icons. No
remaining overlap, clipping or page overflow was found in those inspected states.

Packed consumer: all seven stages passed (Admin repack, fresh scaffold, tarball
relink, install, typecheck, production build and scaffold journey). All ten Admin
dist files match between the final local build, tarball and installed package.
The other 39 unchanged package artifacts reuse the preceding verified baseline;
this is not a new 40-package integration rebuild. Summary:
`/tmp/np-admin-state-scaffold/summary.json`; log:
`/tmp/np-admin-state-scaffold.log`.

Self-review, changed-file formatting, relative documentation links and
`git diff --check` passed. Browser-created media was moved out of the worktree
into `/tmp/np-admin-state-generated-public`; screenshots and failed-attempt logs
were preserved. The primary checkout's locally modified current handoff was read
and left untouched. No unintentional generated files remain in the patch.

Core/server/schema behavior is unchanged. Reuse the PostgreSQL, Redis, theme and
separate native-preview evidence recorded in [error recovery](admin-error-recovery.md)
and [Admin acceptance](admin-acceptance.md); those gates were not rerun as a new
full R5 claim. Versions, changesets, lockfile, schemas and migrations are unchanged.
No provider calls, new operational credentials, automatic activation, publication, commit or push.
