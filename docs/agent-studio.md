# Agent Studio operator guide

Agent Studio at `/admin/agents` is the staff interface for installed Agent
services. It manages connections, Runtime configurations, policies and budgets,
and displays authorized Activity, approval and ChangeSet evidence. This guide
covers shipped behavior; [R5 acceptance](design/agentic-platform/r5-acceptance.md)
records the remaining release evidence. A working screen or green CI alone does
not establish full R5 acceptance.

## Before using Studio

Use a current staff session with `admin.manage`. State-changing operations also
apply their existing reauthentication, CSRF, version, idempotency and audit checks.
The current site and service's authority checks remain authoritative.

The host must explicitly install the required services through
`createAgentStudioServerRuntimeV1(...)` and pass the runtime to
`createBootstrap({ agentStudioRuntime })`. Runtime management uses the
`runtimeStudio` service; Gateway, Activity, approval and ChangeSet dependencies
have their own installation requirements. An absent service is unavailable, not
an empty configured system. Reference apps and fresh scaffolds do not construct
an automatic Agent service factory or enable providers/workers merely because
these pages exist. A setting, catalog entry or successful persistence check is
not proof that the required service is installed and ready.

Provider connections authorize outbound provider access. Gateway principals and
credentials authorize inbound clients; they are separate credentials. Follow
[Agent Gateway](agent-gateway.md) for host wiring and local/remote client setup.
[Agent integration](agent-integration.md) instead describes existing CMS REST
API automation through staff sessions.

## Review and perform an operation

| Surface                                                                          | Operator workflow and boundary                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connections (`/admin/agents/connections`)                                        | Configure the installed provider interface. A successful revocation returns a revoked connection with absent credentials; confirm the returned state. Gateway service-token values are disclosed once: save securely, then hide them. Refresh does not redisclose them. |
| Agents (`/admin/agents/configurations`)                                          | Saving a draft does not activate it. Review the exact version, effective policy and readiness before activation; select self-delegation and triggers explicitly. An acknowledgement is not an active state: Studio reloads and validates the returned configuration.    |
| Policies (`/admin/agents/policies`)                                              | Simulation uses bounded synthetic fixtures and the actual evaluator. Its report neither executes a capability nor grants permission. Changed or inaccessible facts require a new review.                                                                                |
| Budgets (`/admin/agents/budgets`)                                                | Review site ceilings, usage and Runtime operations independently. Unknown measurement is not zero or spare capacity. Site emergency pause and per-Agent pause are different controls; resume requires the existing readiness checks.                                    |
| Activity (`/admin/agents/activity`)                                              | Review returned Run/Action evidence, including uncertain outcomes. Current target visibility and redaction still apply. Expired evidence is labelled; the UI does not reconstruct missing usage or results.                                                             |
| Approvals and ChangeSets (`/admin/agents/approvals`, `/admin/agents/changesets`) | Review sealed server facts and the exact challenge. Approval does not mean execution. Apply/rollback use the current plan, version, hash and required signed approval; confirm returned verification rather than assuming success from a submitted request.             |

Run now requires an enabled registered manual trigger on the active version and
a compatible installed interactive recipe. Structured recipe input is available
only for the supported closed flat scalar schema. Unsupported nested, array or
reference shapes remain unavailable. Input is untrusted data, not permission to
execute a capability. See the [Runtime management flow](design/agentic-platform/r5-runtime-studio-flow.md)
for the host and executor boundaries.

## Understand what the displayed times mean

“Last received” is when the browser accepted a validated response. Runtime status
also displays its existing server projection generation time. Budget and Runtime
responses have separate receipt times; refreshing one does not update the other.
A response without a generation timestamp says that the server projection time is
unavailable. These clocks do not measure cache age or prove underlying facts are
current; clock differences are not a health verdict.

During a same-resource read refresh, some views retain previous validated data
and label the refresh. A failed read removes that resource's evidence. Independent
successful resources can remain visible. Explicit approval/ChangeSet review
refresh invalidates authorizing facts while new data is validated; background
review polling follows its existing bounded behavior. Use the refreshed server
facts before making a new decision. Details: [read observation](design/agentic-platform/studio-read-observation.md).

## Recover from a failed request

Use the displayed stable error code and recovery guidance. When present, a support
reference identifies a submitted server log event. Host logging and retention
determine whether that event can be found; a reference does not guarantee durable
storage. Record the reference and safe code when seeking support, not credentials,
one-time tokens or private provider payloads.

| Displayed condition                                | Next action                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in or recent reauthentication required        | Restore staff authentication, then reload current information. Authentication loss clears sensitive client state.                                                                                |
| Conflict / changed review facts                    | Reload, compare with any retained unsent text and explicitly reconcile. Do not reuse stale approval or version evidence.                                                                         |
| Change outcome may be unknown                      | Inspect current Activity before trying again. Preserve the original request identity for an unchanged retry. For an uncertain approval decision, keep the dialog open to preserve that identity. |
| Declared read retry                                | Explicitly retry loading information when the server wait has ended. A read retry does not replay a change.                                                                                      |
| Rate limit                                         | Respect the displayed wait or `Retry-After`. Its expiry does not send a request, grant authority or make an arbitrary mutation safe to repeat.                                                   |
| Support reference or recovery guidance unavailable | The response did not provide usable diagnostics. Do not infer success or retry eligibility. A separate “Reload” control fetches current facts; it does not resubmit a mutation.                  |

The error body remains the exact `{ error, status }` envelope. Optional
`x-np-error-diagnostics` metadata is specific to participating Studio responses;
proxy/transport/contract failures may lack it, and machine Gateway operations do
not acquire it. See [API errors](api-error-codes.md) and the
[diagnostic contract](design/agentic-platform/agent-error-diagnostics.md).

## Read Health and Doctor evidence

Admin Health at `/admin/health` and the project's existing Doctor command expose
validated aggregate evidence. Inspection does not start a worker, run maintenance,
activate a provider or create a usage measurement record. These observations
supplement existing check IDs and severity; they do not grant execution authority.
Use [operations](operations.md) and [jobs](jobs.md) for process management.

| Observation                         | What it establishes and what it cannot establish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence and Runtime diagnostics | Reported readiness, issues, state counts and record ages. An age is not necessarily time spent in the current state, and a table check does not prove an active consumer.                                                                                                                                                                                                                                                                                                                                                          |
| Maintenance                         | Committed retention batch/sweep receipts are distinct from local handler registration, generic heartbeats and retained queue failures. The sample covers at most 100 receipt-bearing sites and reports truncation. A completed sweep can retain protected records and is not proof that every currently eligible record was removed. Doctor does not invent in-process registration or queue observations.                                                                                                                         |
| Budget                              | Up to 25 configured sites are sampled with truncation reported. Measured, unresolved-usage and unavailable counts are distinct. A measured zero is valid; unavailable or unresolved usage is not zero. These counts are not a cross-site spend total or proof of spare capacity.                                                                                                                                                                                                                                                   |
| Worker subscriptions                | Up to 100 retained heartbeats are sampled. Owner-recorded subscriptions distinguish subscribed, paused, inactive, stale, marked-stopped and unknown evidence. Queue-level counts distinguish fresh subscriptions from paused, stale and stopped registrations within the same sample. Missing/unknown evidence is not proof of queue absence. Registration or a generic heartbeat alone cannot prove an Agent consumer. Even a fresh subscription does not prove progress, provider readiness or coverage of every required queue. |

Missing, unsupported, invalid and unavailable evidence retain their declared
meaning; do not substitute healthy zeroes. Samples are bounded and may lag changes.
The owning evidence records explain collection scope and limits:
[maintenance](design/agentic-platform/agent-maintenance-evidence.md),
[budget](design/agentic-platform/agent-budget-evidence.md) and
[worker subscriptions](design/agentic-platform/agent-worker-evidence.md) and
[queue observations](design/agentic-platform/agent-worker-queue-evidence.md).

Queue backlog evidence in Health and Doctor shows retained live pg-boss counts
and ages for the known Agent queues. It separates due work from future
scheduling and retry backoff, without asserting progress or current adapter
readiness. See [the queue backlog evidence flow](design/agentic-platform/agent-queue-backlog-evidence.md).

## Acceptance and accessibility

Synthetic browser journeys already cover successful activation, connection
revocation and approval-backed rollback, as well as failure/recovery paths.
They verify returned UI state without real provider work; backend authorization
and persistence have separate integration evidence. Narrow/theme/keyboard checks
are bounded to their recorded fixtures, not proof of every possible state.

Actual spoken screen-reader completion remains unverified. The
[consolidated checklist](design/agentic-platform/admin-assistive-technology-acceptance.md)
provides the six operator workflows and the result record; the
[success journeys](design/agentic-platform/admin-success-lifecycle.md) supply
optional local observation checkpoints. Do not replace that human evidence with
DOM snapshots or screenshots. There is no shipped incident-response Studio route;
its acceptance belongs to the phase that implements it.
