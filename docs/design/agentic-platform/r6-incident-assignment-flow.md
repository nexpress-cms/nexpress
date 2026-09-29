# R6 Incident Agent assignment

Staff can designate a configured Agent for an Incident, remove that designation,
and review its history. Assignment records responsibility; it does not grant
capabilities, resume an Agent, enqueue work or execute a recipe.

## Ownership and installation

The optional assignment owner composes the existing staff Incident reader with
current Runtime configuration validation. Hosts install it explicitly through
Studio. Missing installation remains unavailable. Reference and scaffold routes
are wrappers around the shared App handler; no bootstrap enables this owner.

Candidates must belong to the current site and have an eligible retained active
configuration and principal state. Active and paused Agents can be designated;
draft, errored and archived Agents are not new candidates. Eligibility follows
the configured recipe and Incident category. Unsupported categories have no
candidates; they do not inherit a generic fallback. The bounded scan rejects more
than 100 active/paused Agent rows instead of returning an incomplete candidate set.

| Incident category | Required configured recipe     |
| ----------------- | ------------------------------ |
| `spam`            | `moderator.repeated-link-spam` |
| `authentication`  | `guardian.credential-stuffing` |
| `agent-abuse`     | `guardian.agent-abuse`         |
| `availability`    | `operator.worker-not-draining` |

The canonical active configuration and matching principal lifecycle/scopes must
still be valid at mutation time. Designation does not promise that the recipe is
installed, runnable, enabled or currently healthy.

Every read and mutation retains the Incident reader's complete evidence ACLs.
The current assignment ID is distinct from its available Agent projection: an
unavailable Agent is not represented as an unassigned Incident.

## Writes and history

The existing staff admin admission owns authorization, idempotency, invocation
and audit evidence. Assignment checks the current Incident version and Agent
configuration under the existing site transaction/lock owner, and writes the
assignment, next version and timeline entry atomically. An unchanged retry keeps
its command identity; conflicting input or stale review cannot silently replace
a newer decision.

The existing `assignedAgentId` column and same-site reference are reused. Typed
assignment history uses the existing human-note timeline kind and exposes only
bounded previous/next Agent identifiers, not private configuration or execution
input. No schema migration is required.

## HTTP and Admin

`GET /api/admin/agents/incidents/{id}/assignment` returns the bounded current
assignment and eligible candidates. `POST` on the same path accepts the Incident
version, an Agent ID or null for unassignment, and an idempotency key. Query
injection and unknown body fields are rejected. Shared handlers validate the
response and exact Incident binding.

Admin uses explicit designation/removal controls. Its pending command interlocks
with feedback, transitions and response planning/execution. Unknown outcomes
retain the exact command for retry; stale generations and access loss discard
old review. An unavailable optional assignment owner does not erase otherwise
accessible Incident detail.

## Boundaries and verification

Notifications, automatic execution, additional collectors and the full recipe
acceptance gate remain separate. Package versions, changesets and lockfile remain
unchanged.

Independent review covered same-site configuration integrity, lifecycle/category
eligibility, authority preservation, transaction/CAS behavior, safe HTTP output
and browser write interlocks. Assignment history explicitly identifies a human
decision. The reviewed source passed:

- `pnpm verify --concurrency=1`: 113 workspace tasks, including Core 2,175 and
  App 635 unit cases (41 Incident HTTP cases).
- `pnpm lint`: all 41 tasks.
- Focused contract/registry/workflow: 16 cases. The new mutation intentionally
  updates the registered operation inventory and its aggregate fingerprint.
- PostgreSQL: all 46 cases across seven assignment, Incident Studio/workflow/
  evidence/Gateway, moderation execution and Runtime service suites. Four new
  cases use real Runtime configuration create/activate/pause owners and validate
  assignment/removal, exact replay, strict visibility, expired session, actual
  other-site Agent rejection, canonical tampering, concurrent CAS and terminal
  state rejection. No runs or actions are created by assignment.
- Production browser: all 11 Incident journeys, with no retries or skips.
  New journeys cover designation/removal, same-command unknown-outcome retry,
  write interlocks, unavailable configuration, stale review and lost access.

The initial focused DB fixture run exposed test-only invocation-column,
synchronous-exception and timestamp-order errors, corrected before the passing
runs above. A preliminary full check was stopped to apply a formatting-only fix;
the recorded 113-task final gate ran against the final source.

Fresh packed-consumer verification passed: all 40 public packages were packed
into a new isolated project, installed, typechecked with application configuration,
and verified through schema/migrations, Agent foundation, production build and
operations journey. Installed Core agents, App Incident handler and Admin client
bytes matched the verified producer artifacts. Browser captures at 390/1280px
were visually reviewed without overflow, overlap or clipped controls. Changed
file formatting, documentation links and `git diff --check` passed.

This is affected-slice validation, not full R5/R6 acceptance. Dedicated Redis, theme, native preview and
spoken assistive-technology acceptance were not rerun; opt-in unit skips do not
count as integration coverage.
