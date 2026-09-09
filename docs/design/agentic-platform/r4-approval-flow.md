# R4 approval flow

This document records the AP-401 approval slice. Its execution exclusions below
are historical; the subsequent [R4 execution slice](r4-execution-flow.md) adds
explicit apply/schedule/cancel and verification. Rollback and Gateway execution
exposure remain later work. Verification totals below belong to the approval
release and do not certify the newer execution changes.

The approval slice connects AP-401 to the approval portions of AP-407 and
AP-408. It records a human decision over one sealed ChangeSet; it does not
apply content, schedule execution, consume approval, or run compensation.
The remaining R4 execution gate stays open.

## Installed surface

The existing ChangeSet service accepts an explicit `approvals` option with a
separate approval-integrity keyring, the existing opaque challenge verifier
keyring, and a host resolver for the intended execution capability's canonical
**definition**. The definition must contain exactly the requested framework
`changeset.apply` or `changeset.schedule` capability, require human approval,
and use mutation effect profiles at `approved-execute`. Its existing canonical
registry fingerprint signs the approval. Supplying this definition installs
no executor and advertises no Gateway capability. The subsequent Admin execution slice must match the signed definition before
consumption; AP-406 separately owns Gateway capability registration.

The default runtime remains absent. No key is derived from `NP_SECRET`, the
Gateway signing key, Vault, or database configuration. Integrity keys are
32-byte deployment-held values; normal rotation retains previous keys for
verification. The runtime's approval service is derived only from the
explicitly configured ChangeSet service or an explicitly injected service.

The shared routes are:

- `GET /api/admin/agents/approvals`
- `GET /api/admin/agents/approvals/{id}`
- `POST /api/admin/agents/approvals/{id}/decision-challenge`
- `POST /api/admin/agents/approvals/{id}/approve`
- `POST /api/admin/agents/approvals/{id}/reject`
- `POST /api/admin/agents/approvals/{id}/revoke`
- `POST /api/admin/agents/changesets/{id}/request-approval`

Generic decision routes derive the target from the stored statement. The
installed target adapter handles ChangeSets; action and rollback target
adapters remain unavailable until their actual lifecycle is implemented.
Reference and scaffold routes are thin exports from `@nexpress/app`.

## Authority and integrity

Request admission reuses the sealed validation generation and current durable
requester authority. It rereads resources through the existing validation
service and compares base fingerprint, operations, risk, scopes and policies.
The current requesting staff session and current approver are separate from
the original requester; all retain current item visibility. Approval does not
turn a `propose` exposure ceiling into execution authority. A later consumer
must enforce `approved-execute` in addition to the signed approval.

A required preview must have the same plan/generation/digest, verified private
artifacts and at least five minutes remaining at request. Existing canonical
reports block approval when they contain failed checks or error issues.
Artifact reads occur before the row-locking decision transaction; that
transaction rechecks the exact preview identity, digest, state and expiry.
An existing bound preview remains readable and renderable while its parent is
pending approval or approved. Those states do not admit a new preview. Once
approval expiry is reconciled, terminal approval history does not block the
existing parent eligibility-expiry maintenance; canonical history remains intact.

The canonical statement binds intended operation through capability identity
and binds `scheduledFor` in the ChangeSet target. Request idempotency, pending
statement reuse and monotonically increasing approval generations use the
existing invocation and approval tables. Changing time, plan, policy,
capability definition or required preview requires a new statement.

The exact challenge is issued once for five minutes or less. Its keyed
verifier additionally binds site, approval, statement, approval version,
purpose, generation, staff user, session fingerprint and expiry. Plaintext
exists only in the response and browser memory. Decision idempotency hashes
use the existing separately keyed Admin secret-request projection, so the
challenge is absent from canonical invocation input and audit payloads.

Sensitive/destructive approval requires an actual same-session staff-primary
fact at both challenge issuance and decision, at the signed age limit of
1–300 seconds. The existing verifier accepts a server-derived timestamp and
session/authentication fingerprint. Legacy boolean verification remains
compatible for older Admin operations, but is insufficient approval evidence.
Reject and protective revoke do not inherit the approve-only floor.

Statement, decision and revocation bodies retain separate canonical hashes
and MACs. Verification reparses bodies, validates all signed bindings and
checks nullable user references without rewriting evidence after user
deletion. Invalid retained evidence fails closed and emits a bounded
high-severity audit incident. Human revoke preserves the original decision.
Terminal transitions clear transient challenge verifier/session/user references
while retaining generation and consumption evidence, so a consumed challenge
cannot indefinitely block staff deletion.

## State and operations

Pending approval moves the parent to `approval_pending`; approve moves it to
`approved`, and reject to `rejected`. Expiry or revoke of an unconsumed,
unscheduled approval returns the still-sealed parent to `ready`. A new request
uses a new positive generation. No transition claims content execution.

Explicit host maintenance methods are bounded:

- `reconcileExpired({ siteId, limit })` expires pending/approved records and
  returns parents to ready atomically.
- `reconcile({ siteId, limit, cursor })` checks current requester authority and
  target evidence, revokes known authority loss or invalidation, and records
  integrity incidents. The cursor is site/filter bound and short-lived.
- `reconcile({ siteId, limit, cursor, retireIntegrityKeyId })` is explicit
  emergency key retirement. It revokes affected unconsumed approvals with a
  new separately MAC-bound system revocation and an audit record. A missing
  old key is never treated as successful verification. After removal, the
  original detail remains unavailable. A fully verified retained retirement
  revocation permits the parent review to omit that unavailable summary and
  request a fresh generation; tampered retirement evidence still fails closed.

The host must invoke maintenance; no timer, worker, queue producer or listener
is installed automatically. Keep normal verification keys for the complete
execution/audit retention period. Investigate integrity incidents before
retiring keys; restore known valid retained key material when appropriate,
or explicitly invalidate affected approvals. Never edit retained canonical
bodies or rewrite their hashes to make verification pass.

Admin queue defaults to pending and sorts expiry ascending, risk descending,
then stable ID. State/risk/target/requester/capability/time filters and opaque
cursors remain bounded. Every scanned item is authorized; invisible items do
not expand the scan. List projections reuse current resource visibility and
recorded preview metadata without rereading artifact bytes for every row.
Detail reuses the existing escaped ChangeSet diff and verified preview.
Recorded check counts are not a claim that checks passed, and absent rollback
plans are explicitly unavailable.

Unknown decision responses retain the exact challenge/idempotency payload for
retry. A conflict clears the challenge and reloads current evidence; access
loss clears the previous diff. There is no optimistic approval or bulk approve.

## Persistence and diagnostics

Migration `0041_agent-approval-decision-reauth.sql` corrects only the existing
approval decision check: reject has `none` reauthentication and null facts;
approve follows the signed requirement. Drizzle generated the SQL and
snapshot. The inventory remains 28 tables and 133 critical constraints.
Doctor reuses the existing expiry-backlog and invalid-row codes and checks
persisted statement/decision bindings. Metadata diagnostics do not claim to
verify MACs without deployment keys; the installed approval service owns
cryptographic checks and safe integrity incident audit events.

Package versions and changesets are unchanged.

## Self-review

The final review corrected the Admin response schema to compose the actual
approval detail from the existing ChangeSet wire/review definitions, without
raising the shared schema bounds. Regression checks also cover preview
maintenance in pending/approved states, parent expiry after terminal approval,
clearing consumed challenge references before staff deletion, and exact key-id
matching during retirement. Emergency removal now preserves strict live
verification while permitting a new generation after verified terminal
retirement. Canonical historical bodies, hashes and MACs remain unchanged.

The installed runtime still requires explicit host keys, target services and
current capability definitions. Approval consumption, content apply, scheduled
execution, rollback and automatic maintenance remain later R4 work.

## Verification

- Workspace `pnpm verify --concurrency=1`: 113/113 tasks, 56 repository checks
  and 3,823 unit tests passed. Workspace lint: 41/41 tasks passed.
- PostgreSQL: Core 67/67 and reference app 1,075 passed, including 24 approval
  regressions. The isolated real-Chromium preview test also passed separately.
- Contract suites: 289 tests passed; AJV 2020 validates complete and null review
  outputs and rejects hostile extra fields. Registry fingerprint golden updated.
- Production Playwright: 53/53 passed without retry on the final run, including
  all three approval flows. An ambiguous alert selector was corrected after the
  first run; the application behavior did not require a change.
- Packed fresh scaffold: 40 tarballs and 53 stages passed outside the workspace,
  including install/typecheck, generated migrations, the empty disabled Agent
  foundation, production build, extension matrix and first-run journey.
- `git diff --check`, unchanged package versions/changesets/lockfile, and
  changed-source/validation-log secret checks passed. Test-generated media and
  isolated databases were removed.

Merge follow-up reran the Redis package against an isolated Redis 7 instance:
16/16 passed, including all three formerly skipped live cases. CI now provides
the Redis service and runs these cases explicitly. The five legacy theme-render
cases were restored using the existing async render boundary and real persisted
navigation; all five passed without product changes. They now run in the normal
PostgreSQL suite. The preview browser test remains opt-in and passed separately.
No deployment/provider test applies: this slice installs no provider call,
automatic worker or execution consumer.
