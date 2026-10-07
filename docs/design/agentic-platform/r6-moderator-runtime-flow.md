# R6 Moderator: human-approved Runtime continuation

This bundle connects explicitly installed Moderator capabilities to the existing
Runtime approval lifecycle. A recipe can propose quarantine or restoration, wait
for a human decision, and continue from a verified receipt. It does not enable
automatic moderation or establish model quality or full R6 acceptance.

## Installation and authority

The host supplies `runtimeAdmission` to `createAgentModerationServiceV1` and
installs its facade through the existing capability admission resolver. Without
that optional owner, Gateway and staff behavior remain available but the Runtime
catalog does not advertise moderation. There is no new bootstrap activation,
provider adapter, worker, credential or database migration.

The catalog requires the admitted recipe's capability, current user-backed
authority, moderation scope and an effective policy that permits requesting
approval. The service rechecks those boundaries inside the current Run
transaction. Its target-specific policy and budget intersect the Runtime policy
and site/Agent limits; pending proposals reserve the bounded target slots.

## Proposal, approval and continuation

Runtime proposals reuse the admitted Run and its action sequence. They do not
create a second Gateway Run. One Action binds the exact proposal, target version,
request fingerprint and signed approval. Proposing has no content effect.
Provider-directed execution is rejected even when the provider supplies valid
approval identifiers. Only the existing approval-resume owner reconstructs the
approved execution request.

Human decisions use the existing approval service, recent staff authentication,
target review and current authority. Before execution, the Moderator service
rechecks the signed statement, current requester and approver authority, target
version, policies, budgets and single-use approval. Rejection, revocation and
expiry use the Runtime failure/audit owner. Changed targets or authority cannot
consume approval or modify content.

The existing community owner performs quarantine/restoration with its ACLs,
compare-and-swap and private original-state evidence. Content writes, approval
consumption, invocation receipts, Action verification and Incident timeline
commit atomically. A persistence failure rolls them back together; deferred
effects remain post-commit. Repeated continuation reuses the same Action and
receipt. The Runtime executor owns subsequent provider work and final Run state.

## Provider result boundary

Only completed, validated moderation receipts enter the next provider context.
Quarantine retains `succeeded`; restoration retains `compensated` within its
receipt, while the outer completed-action projection is `succeeded`. The exact
receipt contains action/containment identifiers, result digest and verification
references. Original restoration state, comment bodies, approval-pending output
and failed or tampered receipts are excluded. Projection rechecks retained
approval/invocation/containment linkage and current target visibility without
requiring the obsolete pre-effect version after successful execution.

## Acceptance boundary

Verification uses an explicitly injected local fake provider with real Runtime,
PostgreSQL, signed approval and community owners. This demonstrates control-flow
and transactional behavior, not live-model usefulness. Existing Gateway/staff
paths and approval UI remain the same owners. Automatic quarantine, broader
Moderator recipes and production shadow/quality evidence remain open under the
[Moderator flow](r6-moderator-flow.md) and R6 evaluation requirements.

Local PostgreSQL acceptance on 2026-10-07 passed 79 cases with explicit isolated
test databases and no skips: ten new Runtime cases and 69 existing Moderator
execution/content, Runtime approval, Operator continuation, approval and closed
approval retention regressions. The new cases include disabled installation,
the narrower host target limit, signed approval decisions, current authority/
target/policy/budget changes, completed receipt tampering, transaction rollback,
and recovery after effect commit and execution-lease loss. Inspection and
projection establish their own site context, as required for request-independent
workers.

`pnpm verify --concurrency=2` passed all 113 workspace tasks, including Core
2,289 unit cases, dependency builds and Web production build/typecheck.
`pnpm lint` passed all 41 tasks. Changed-file formatting, local documentation
links, self-review and `git diff --check` passed. The ordinary unit gate kept
the three opt-in live Redis cases skipped; Redis integration, theme PostgreSQL,
native preview, production browser and packed-scaffold acceptance were not
rerun for this scoped continuation bundle. This is not a claim of the full R6
gate.
