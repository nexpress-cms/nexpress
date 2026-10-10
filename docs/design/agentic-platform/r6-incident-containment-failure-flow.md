# R6 Incident containment verification failure

An approved quarantine attempt can return a stored failed outcome when its
content change does not pass the domain's post-write verification and the
attempt has been rolled back. The Incident timeline records that exact outcome;
high/critical Incidents also produce a local Admin notification.

## Execution boundary

Current authority, policy, target version, budget and signed approval checks
remain mandatory. Approval rejection, revocation, expiry, stale targets and
pre-execution denials are not failed containment. Unknown database or transport
errors remain unknown rather than becoming invented rollback evidence.

Only the domain's explicit post-write verification failure qualifies. The
quarantine effect and its verification run inside a nested transaction and
nested deferred-post-commit scope. A confirmed rollback drops both content
changes and queued follow-up effects. If rollback itself cannot be confirmed,
the outer transaction fails instead of storing a definitive outcome.

The outer transaction retains the consumed approval and records the Action's
failed verification, the failed Run when present, and the completed invocation
with the existing canonical failed result. Exact replay returns the same result;
a new execution requires a new proposal and approval. No successful containment
or restoration record is fabricated. Incident-linked failure persistence requires
the explicitly installed failed-outcome writer; an older installation without
that owner retains its previous rollback behavior.

## Incident history and notifications

The Incident writer validates the same-site action, canonical proposal,
execution invocation, audit and rollback evidence. It increments the Incident
version and stores fixed summary text with the actual status and severity.
Notification identity remains site/channel/Incident version/transition, with
`containment_failed` bound to the exact persisted action entry.

Admin notifications contain only the existing safe fields and local Incident
link. Current Incident access is necessary but insufficient: the installed action
review owner must also permit reading the exact failed action target. Missing
or denying action review hides that notification without hiding other authorized
notifications. The notification write is isolated from the source result; an unavailable
notification cannot undo the stored failure outcome. Exact replay does not retry
a missed notification. The optional
[recording recovery owner](r6-incident-notification-recovery-flow.md) now retains
bounded work for explicitly marked new outcomes and host maintenance. There is
no external transport, automatic execution, worker activation or new credential.

An Action labelled failed can also represent an approval failure. Admin must not
infer a rolled-back quarantine solely from that label; the specific Incident
notification and history establish the verified outcome.

## Remaining boundaries and initial failure-slice verification

Automatic severity escalation is not supplied by the current Moderator detector,
which continues to produce medium-severity advisory observations. The
[manual severity flow](r6-incident-severity-flow.md) adds explicit staff decisions
and records the later combined verification. Other unknown
execution failures, failed restoration and external delivery remain separate.

Independent review corrected action-target visibility and unified the proof
checks used by writing, notifications and Studio history. A modified source
fingerprint, execution reference, rollback outcome or timestamp cannot preserve
a visible failure notification when its history is no longer valid.

The focused execution suite passed 19 PostgreSQL cases, including five new
cases using real document hooks and both Gateway and staff execution. These
cover content/deferred-hook rollback, consumed approval, exact replay, rejection
of a new execution identity, isolated notification failure, current target ACL,
unknown errors, approval revocation, typed timeline projection and forged
source evidence. Initial fixture failures came from a document collection
without its required moderation hidden-field configuration and were corrected.

The first complete gate found an existing error-message expectation affected
by the private marker; its public message/details now remain unchanged. It also
exposed a pre-existing preview signature test whose fixed replacement could
occasionally equal the original random signature. That fixture now changes an
actual signature byte deterministically; production cryptography is unchanged.
The two affected suites passed all 34 cases.

Verification:

- Workspace `pnpm verify --concurrency=1`: all 113 tasks passed, including
  Core 2,178 and App 638 unit cases.
- Final `pnpm lint`: all 41 tasks passed.
- Affected PostgreSQL: all 44 cases across execution, community containment,
  notifications, Studio, workflow and evidence suites.
- Production browser: all 14 Incident journeys passed in the corrected complete
  run, with zero retries or skips. The initial new fixture shared an object
  reference that strict parsing rejected; a JSON roundtrip now models the real
  HTTP boundary. Failed outcome and typed timeline captures at 390/1280px were
  reviewed without clipping, overlap or horizontal overflow.

After the full workspace gate, lint refinements changed type-only imports,
unnecessary assertions and explicit stored-value string guards. Changed Core
files passed ESLint/typecheck, the execution PostgreSQL suite passed all 19 cases
again, and the preview signature suite passed all 24 cases. The changed Core
artifact was rebuilt for final packed-consumer verification. Browser changes
following the workspace gate were fixture/capture-only.

Fresh packed-consumer verification passed for all 40 public packages: isolated
installation, configuration-inclusive typecheck, generated schema/migrations,
Agent foundation, production build and operations journey. Installed Core, App
and Admin artifact bytes matched the final producer. Final Web typecheck,
changed-file formatting, documentation links and `git diff --check` also passed.
The existing handoff remained unchanged.

Package versions, changesets, lockfile and schema remain unchanged. Dedicated Redis, theme, native preview and
spoken assistive-technology gates were not rerun; opt-in skips do not establish
coverage. This slice does not close full R5/R6 acceptance.
