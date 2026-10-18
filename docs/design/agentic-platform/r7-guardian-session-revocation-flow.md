# R7 approved exact browser-session revocation

This slice connects a trusted successful login after repeated failures to an
explicitly approved, non-reversible session response. Guardian complements
application authentication, rate limits and upstream WAF/IDS/SIEM. A matching
rule is a reason to investigate, not proof of an attack or execution authority.
The [temporary request-limit workflow](r7-guardian-request-limits-flow.md) keeps
its independent TTL and recovery contracts. Broader collectors, external signal
adapters and the full R7 adversarial/false-positive gate remain separate work.

## Trusted login evidence

The optional auth success observer receives only the persisted principal and
new browser session identity. The existing staff/member password and OAuth
owners create the session before invoking it; tokens and submitted target
identifiers are not observation authority. Observer failure does not change the
authentication outcome. The host explicitly installs
`guardianSessionObservations`, its current-site authorization and the same
copied HMAC projection key as the failure collector. Nothing activates by default.

The bounded detector requires five verified login failures followed by one
successful login within ten minutes, matching audience, network projection and
the exact login-identifier projection resolved from the persisted principal.
A shared network address alone cannot identify the affected account. Raw IP,
email, passwords, access/refresh tokens and user-agent strings are absent from
retained security evidence. The canonical success retains the server-created
session family, principal and exact creation time; a source binding commits the
opaque login projection. Immutable evidence can be revalidated after revocation.
Capture must occur within sixty seconds of the new session; retries reuse the
same frozen family event and six-event evidence cohort. This collector does not
infer ownership for old sessions or every kind of suspicious login.

## Exact target and impact

`createAgentGuardianSessionServiceV1` is an optional Studio `guardianSessions`
owner. It reuses current staff admission, Incident item visibility, host policy,
canonical Actions, the signed Approval service and the explicit action-target
router for `security.revokeSessions`. Gateway/model discovery gains no new
executable mutation.

Planning accepts the Incident version, server target digest and stable request
key. It accepts no caller-selected principal, session family, impact, predicate
or raw network address. The trusted source resolves one exact browser family
and its owner. Existing access and refresh rotation share that immutable family;
other sessions belonging to the same person are outside this action.

Neither existing staff nor member session tables prove site ownership. Both are
therefore conservatively classified as deployment impact. The current affected
site set/count and impact digest are server-derived and bound through the
canonical proposal and signed Approval. A different current super administrator
must approve with recent same-session staff-primary reauthentication.
`admin.manage` without the signed `is-super-admin` predicate is insufficient.
Current target, impact, policy, requester, approver and item visibility are
rechecked before execution. A future site-only member path requires an actual
auth-owned site fence; a site picker or membership does not establish one.
The bounded catalog includes every existing site row, maximum 10,000. Mutating
transactions briefly fence site creation/deletion before taking their snapshot;
catalog contention beyond the 100 ms lock budget fails closed.

## Atomic effect and recovery

Planning and approval have no authentication effect. Explicit execution deletes
only the exact owner/family/creation identity through the auth owner's seam on
the existing database transaction. It neither increments the principal's global
token version nor calls an all-session invalidator. The successful effect,
Approval consumption, Action, execution receipt and audit commit together;
failure rolls them back together. Preview blocks mutation before database I/O.

Deletion invalidates both access and refresh verification for the selected
family, including rotated tokens. Other browser families remain valid. A new
login creates a new family. This is not a ban, credential rotation or an undoable
containment; no rollback or restoration button is offered.

The UI separates plan, human approval and execution, displays the exact session
and deployment impact, and retains unchanged request identity after an unknown
HTTP outcome. Replaying a completed command verifies retained evidence instead
of deleting again. Historical projection uses current viewer authority and
immutable execution proof, so a legitimate session deletion cannot erase its
own result. A stale target or lost authority discards the obsolete review.
Known target or policy drift converges through the existing signed Approval
reconciliation to revoked authorization and a failed Action. Current authorized
viewers can reject or protectively revoke a frozen plan even after its original
requester session disappears or its policy becomes unavailable. Missing or
altered integrity evidence remains a conflict requiring investigation.

Retained verification reconstructs the actual canonical revocation event and
checks its hash, exact target, execution invocation, consumed Approval and audit.
The existing dependency-safe retention scan sees the event references in both
the Action and immutable audit, preserving the event beyond its nominal expiry.
No separate broad security-retention policy or automatic cleanup job is added.

## Verification

Local acceptance uses Node 24.11.1, pnpm 10.33.0, PostgreSQL 18.3 with fsync,
full-page writes and synchronous commit enabled, and Redis 7.2.7. All credentials
are synthetic. Provider credentials are cleared, jobs and external delivery are
disabled, and no paid provider call or automatic Runtime activation is involved.
The results below are local acceptance evidence. GitHub CI checks are tracked
on the pull request separately.

- The final `pnpm verify --concurrency=3` passed all 113 tasks, including Core
  2,482, App 791, Admin 205, Auth Pages 25 and Web 164 unit cases. `pnpm lint`
  passed all 41 tasks, with one existing unrelated evaluation-history hook
  warning. The integration TypeScript check passed. An interrupted earlier run
  before the private capability input-schema correction is excluded.
- Core PostgreSQL passed 71 cases. All 31 new Web PostgreSQL cases passed:
  auth family revocation/rotation/isolation/rollback (6), trusted observation
  binding and rejection (7), signed approval/effect/retained-proof boundaries
  (17), and dependency-safe event retention (1). The five persisted theme-render
  cases also passed.
- The full Web PostgreSQL run reported 1,863 passes, one existing Approval
  preview failure and the separate native-preview opt-in skip. After disk
  recovery, the unchanged entire Approval file passed all 24 cases. Matching
  file, test name and parameter occurrence across reports confirms coverage of
  all 1,864 ordinary cases. This is full-plus-focused coverage, not an
  uninterrupted green full run. The preview failure is consistent with the
  contemporaneous disk exhaustion, but the swallowed underlying spool error
  prevents proving that cause. No deadline or validation bound was relaxed.
- Explicit native Chromium preview passed its one case; explicit live Redis
  passed all 16 cases without skips. The ordinary Turbo run's Redis opt-in skips
  are not used as evidence for those checks.
- Production Chromium passed all 131 cases with one worker, zero retries, zero
  skips and zero flaky results against the final production build and a fresh
  database with all 74 existing migrations. The new exact-session journey
  verifies explicit human review, unchanged unknown-outcome retries, retained
  success and access-loss redaction. Its 390 px capture was visually reviewed;
  target, deployment impact and result remain readable without horizontal
  overflow. The owned browser server and database were removed afterward.
- Forty package archives passed fresh scaffold installation, installed type and
  disabled-host contract checks, fresh migrations/foundation, production build,
  new route-manifest checks, extension lifecycle and operational-readiness
  journeys. Archive, installed and producer bytes matched; all 34 installed
  public packages had one physical copy. Script probes establish module loading
  against an unreachable local database only, not successful worker or provider
  operations. The consumer database was removed afterward.

The first packed production build exhausted local disk while writing a Next
manifest. Only disposable older Turbo archives and this run's incomplete
consumer build were removed. The affected build and downstream checks then
passed using the same frozen archives and installation; the earlier diagnostic
failure remains recorded. Package versions, changesets, lockfile and migrations
are unchanged. The pre-existing handoff edit is preserved.

Self-review corrected the private Action input-schema binding, current-viewer
Incident ACLs, exact replay identity, signed stale-target reconciliation,
deployment catalog concurrency, immutable event proof, and semantics-preserving
closed-schema compaction under the existing provider schema bound. No broader
collector, unattended response, external integration or full R7 acceptance is
implied by this slice.
