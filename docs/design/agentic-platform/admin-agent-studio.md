# Agent Studio — Admin product and interaction design

> Status: implementation design. The routes, views, and APIs in this document
> are proposed and are not shipped behavior.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
> Parent decisions: [Agentic Platform implementation design](README.md).
> Product requirements: [product-requirements.md](product-requirements.md).

Agent Studio is the site-scoped Admin area for configuring connections and
Runtime Agents, reviewing policy and budgets, observing activity, deciding
approvals, and responding to incidents. It is an operational control surface,
not a conversational shell and not a place where a model receives implicit
administrator authority.

## 1. Experience goals

An authorized operator should be able to answer these questions without
reading logs or model transcripts:

1. Which provider, external client, and integration connections can act on
   this site?
2. Which Runtime Agents are active, what triggers them, and what is the
   maximum action each can take?
3. Which rules are deterministic enforcement and which text is only model
   guidance?
4. What is running, waiting, blocked, failed, or consuming budget?
5. What exact server-produced facts am I approving?
6. What changed, did verification pass, and can the action be reversed?
7. Which signals make up an incident, what containment is active, and when
   does it expire?
8. Who or what acted, under which site, scope, policy version, credential,
   idempotency key, and approval?

The default screen should make safe inactivity understandable. “No pending
approvals” and “No open incidents” are positive empty states; “no worker
heartbeat,” “budget measurement unavailable,” and “vault unavailable” are
degraded states and must never share the same treatment.

## 2. Information architecture

### 2.1 Admin navigation

Add one **Agent Studio** item to the existing AdminShell `System` group.
Do not add seven peer items to the global sidebar. The Agent Studio entry has:

- a `Bot` or equivalent bundled Lucide icon;
- an accessible pending-attention label derived from server-authorized counts;
- no count or state fetched for a user who cannot enter any Agent Studio
  surface; and
- active-route behavior for every `/admin/agents/*` descendant.

Inside Agent Studio, a local navigation row or compact navigation menu exposes
the eight locked product surfaces:

1. Overview
2. Connections
3. Agents
4. Policies
5. Activity
6. Approvals
7. Incidents
8. Budgets

Overview is an orientation page, not an eighth persisted product resource.
Agent ChangeSets are reached from Activity and Approvals and have a dedicated
detail route, but do not need another top-level tab in the first release.

### 2.2 Proposed route map

Static routes take precedence over dynamic identifiers. Identifiers are opaque
and must be copied exactly from validated server responses.

| Route                                      | View                                                       | Primary authorization                                         | Phase |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- | ----- |
| `/admin/agents`                            | Site-scoped overview                                       | Any authorized Agent Studio subset; cards are server-filtered | 1     |
| `/admin/agents/connections`                | Outbound connections and Agent Gateway access              | `admin.manage`                                                | 1–2   |
| `/admin/agents/connections/new`            | Provider/integration connection wizard                     | `admin.manage`                                                | 1     |
| `/admin/agents/connections/[connectionId]` | Connection health, rotation, dependencies, revocation      | `admin.manage`                                                | 1     |
| `/admin/agents/gateway/[principalId]`      | External-client principal, grants, tokens, use, revocation | `admin.manage`                                                | 1–2   |
| `/admin/agents/configurations`             | Runtime Agent list                                         | `admin.manage`                                                | 3     |
| `/admin/agents/configurations/new`         | Runtime Agent wizard                                       | `admin.manage`                                                | 3     |
| `/admin/agents/configurations/[agentId]`   | Agent configuration, versions, triggers, effective access  | `admin.manage`                                                | 3     |
| `/admin/agents/policies`                   | Site and agent policy versions                             | `admin.manage`                                                | 3     |
| `/admin/agents/policies/[policyId]`        | Policy diff, simulation, activation, retirement            | `admin.manage`                                                | 3     |
| `/admin/agents/activity`                   | Authorized run and action list                             | Item-level existing `NpCapability` filtering                  | 2–3   |
| `/admin/agents/activity/[runId]`           | Run timeline and bounded evidence                          | Item-level existing `NpCapability` filtering                  | 2–3   |
| `/admin/agents/approvals`                  | Pending and historical approval queue                      | All capabilities required by each target                      | 2     |
| `/admin/agents/approvals/[approvalId]`     | Hash-bound approval decision                               | All capabilities required by the target                       | 2     |
| `/admin/agents/changesets/[changeSetId]`   | Proposal, diff, preview, execution, verification, rollback | All capabilities required by its operations                   | 2     |
| `/admin/agents/incidents`                  | Authorized incident queue                                  | `community.moderate` for moderation; `admin.manage` otherwise | 3–4   |
| `/admin/agents/incidents/[incidentId]`     | Incident evidence, timeline, response, resolution          | Category/action-specific existing capability                  | 3–4   |
| `/admin/agents/budgets`                    | Site and per-agent admission budgets and usage             | `admin.manage`                                                | 3     |

The shared implementation belongs under `packages/app/src/admin/**` and
`packages/admin/src/**`. `apps/web/src/app/**` stays a thin wrapper/re-export
surface.

Routes and tabs whose phase has not shipped are absent, not empty
forward-looking shells. Product Phase 1 therefore exposes only the
server-filtered overview and connection/principal foundation; Runtime Agent,
policy, and budget navigation appears with Roadmap R5 in Product Phase 3.

### 2.3 Local navigation behavior

- Desktop: a horizontal tab row below the page title; the current item uses
  both `aria-current="page"` and a non-color visual treatment.
- Narrow viewport: a labelled native/select-like menu or horizontally
  scrollable tab list with visible overflow affordance; no hover-only menu.
- Approvals and Incidents may show authorized counts. Counts are bounded
  strings (`99+`) and are not loaded from unfiltered data.
- A site switch invalidates all page data, closes open mutation dialogs, and
  routes to the same relative Agent Studio page only if authorized on the new
  site. No prior-site object identifier is retained.

## 3. Shared page anatomy

Every Agent Studio page uses the existing Admin shell width and includes:

1. **Title and scope:** page title, current site name, and concise purpose.
2. **System state strip:** runtime enabled/disabled, emergency pause, worker
   state, vault readiness, and provider degradation only when relevant.
3. **Primary action:** at most one emphasized action, such as “Add connection”
   or “Create agent.”
4. **Filters and saved URL state:** filter values serialize into bounded query
   parameters so refresh/back navigation is stable.
5. **Content:** cards at overview level; table/card hybrid for collections;
   definition lists, diffs, and timelines for detail.
6. **Freshness:** canonical UTC server time rendered in the user's locale,
   “updated” timestamp, and a refresh action. Relative time never replaces the
   exact timestamp in details.
7. **Audit link:** material records link to the relevant Activity, approval,
   ChangeSet, incident, or existing audit detail.

All status labels come from a client-safe validated contract. Unknown enum
values fail the view closed into a contract-error panel and are reported; the
client must not guess a friendly state.

## 4. Human authorization model

Agent Studio uses existing human `NpCapability` checks. `NpAgentScope` values
shown on an agent or gateway principal describe what the agent may request;
they never authorize the staff user viewing or deciding the request.

### 4.1 Surface and item permissions

| Operation                                                                                                             | Required existing human capability                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Configure provider/integration connections, gateway clients, agents, triggers, policies, runtime settings, or budgets | `admin.manage`                                                                         |
| View connection metadata, full agent configuration, unfiltered activity, security/ops evidence, or provider usage     | `admin.manage`                                                                         |
| Review a draft-only content ChangeSet                                                                                 | Every server-returned capability required by its operations, normally `content.author` |
| Approve publication or scheduling                                                                                     | `content.publish` plus any additional server-returned requirement                      |
| Review/decide a moderation action or moderation incident                                                              | `community.moderate`                                                                   |
| Review or execute operations and Guardian response plans                                                              | `admin.manage`                                                                         |
| View a mixed-domain ChangeSet                                                                                         | All capabilities in its server-produced `requiredStaffCapabilities` set                |
| Roll back or compensate an action                                                                                     | The capability required for that exact compensation, recalculated at request time      |

An operator may enter `/admin/agents` when the server says at least one
subsurface is available. The overview response contains only authorized cards
and counts. Lists are filtered in the database/service layer; the browser must
not receive forbidden rows and hide them afterward.

Initial implementation may gate all Agent Studio routes with `admin.manage` to
ship a narrower safe phase. Delegated content and moderation review is complete
only when the item-level filtering and tests described above ship together.

### 4.2 Route behavior

- Missing session: use the existing staff login flow.
- Authenticated but no surface permission: render the standard Admin
  forbidden page; do not mount the client view.
- Unauthorized or cross-site object identifier: return the same not-found
  result used for a missing object, preventing an existence oracle.
- Lost permission while a page is open: the next fetch or mutation returns the
  exact `FORBIDDEN` envelope; clear sensitive page data and do not retry.
- A disabled primary button is not authorization. Every mutation repeats all
  server checks inside the write path.

Server parents call `can(user, ...)`, pass serializable booleans and already
filtered data, and never duplicate role lists in `@nexpress/admin/client`.

## 5. Overview

### 5.1 Layout

The overview is a triage surface in this order:

1. **Attention bar:** emergency pause, blocking Doctor findings, provider/vault
   outage, budget exhaustion, critical incidents, and pending approvals.
2. **Operating state:** runtime enabled, active/paused/error agent counts,
   worker heartbeat, queued/running/waiting runs.
3. **Connections:** ready/error/expiring/revoked counts with the default model
   connection alias; never a secret or full credential identifier.
4. **Usage:** current period provider calls, input/output tokens, finalized or
   estimated cost, reserved allowance, and hard-limit posture.
5. **Recent activity:** latest authorized runs and actions.
6. **Open incidents and approvals:** highest severity/risk first, with exact
   age and owner state.

### 5.2 Overview states

| State                                | Presentation                                                                                                     | Available action                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Feature not configured               | Setup checklist explaining connection, policy, budget, agent, then activation                                    | “Add connection” for `admin.manage`                                     |
| Configured but runtime disabled      | Neutral banner; existing data remains visible                                                                    | “Review runtime settings”                                               |
| Emergency pause                      | Persistent critical banner naming server actor/time/reason; no “all healthy” copy                                | Authorized “Review pause” action; resumption is a separate confirmation |
| Healthy and idle                     | “No work waiting” with last heartbeat and last successful run                                                    | Manual bounded run when configured                                      |
| Active                               | Counts plus link to running Activity                                                                             | No global optimistic progress animation                                 |
| Degraded                             | Explicit failing subsystem and safe consequence, such as “provider calls paused; deterministic signals continue” | Retry/test only when the backend declares it safe                       |
| No permission for a card             | Card is omitted and counts are recalculated server-side                                                          | None                                                                    |
| Partial overview response prohibited | Do not combine stale successful cards with an unlabelled failure                                                 | Show stale timestamp and per-card unavailable state                     |

## 6. Connections

“Connections” has two visually separate tabs because outbound model access and
inbound NexPress authority are different trust relationships.

### 6.1 Provider and integration connections

Rows display:

- operator label;
- v1 kind (`model` or `notification`);
- provider adapter and authentication kind;
- status: `pending`, `ready`, `error`, `disabled`, or `revoked`;
- safe model/region/project configuration when declared non-secret;
- last successful verification and safe last error code;
- dependent Agent count;
- created/rotated metadata; and
- an explicit “Secret is stored; it cannot be viewed” statement.

The row and detail page never display `secret_ref`,
`active_secret_version_id`, ciphertext, wrapped key, OAuth
refresh/access token, API key suffix unless the credential contract explicitly
permits a non-secret fingerprint, or raw provider error body.
Security/analytics/storage/adapter-defined kinds remain future UI only after
their executable adapter facets are versioned; an unknown kind is not rendered
as a configurable or ready v1 row.

### 6.2 Agent Gateway access

This tab displays external Agent Gateway principals, not
`np_agent_connections` rows:

- deployment and site ceilings for `stdio`, `mcp-http`, and `agent-http`, with
  an explicit statement that NexPress opens no dedicated MCP port;
- whether the optional `/api/mcp` path is absent or enabled on the existing
  canonical HTTPS origin; a site operator may only narrow the deployment
  ceiling;

- principal name and kind;
- external OAuth client/grant or service-token kind; the Agent Gateway
  issuer is always NexPress in v1;
- exact site and sorted `NpAgentScope` list;
- immutable credential/grant exposure mode and current effective mode;
- active, suspended, or revoked status;
- token/grant expiry, last-used time, and safe client metadata;
- bounded recent use and policy denials; and
- edit-name/description, exact scope-change, suspend/resume, and revoke
  actions.

An external service token is shown exactly once after creation. Closing or
navigating away from the one-time dialog makes it unrecoverable; the operator
must rotate instead.

Editing scopes shows the current principal set separately from every immutable
OAuth grant/service-token snapshot. Any scope change increments
`tokenVersion`; narrowing is immediately effective, while widening never
widens an existing credential and offers a fresh-consent/new-token next step.
The same rule applies to exposure: lowering a deployment/site ceiling is
immediate, while raising it never widens an existing grant or token. A broader
credential requires fresh consent or a new service-token family. The UI shows
the exact effective tool subset and confirms that `approved-execute` retains
all shipped master-inventory tools but grants neither scopes nor approval.
Resume is available only for `suspended`, revalidates same-site authority,
a current scope set containing `site:read`, and at least one live
credential/grant, and never restores revoked material. `revoked` is terminal.

### 6.3 Add provider/integration connection

1. **Choose purpose and provider.** The server returns the installed adapter
   inventory, supported auth kinds, models/integrations, non-secret config
   schema, and connection test behavior.
2. **Name and configure.** The client renders only the exact adapter schema.
   Unknown fields are rejected; a user-visible provider label is not an
   adapter ID.
3. **Authenticate.**
   - API-key secret uses a write-only control and cannot be copied
     back from client state after submission.
   - OAuth starts a server-generated state/PKCE flow, returns only through the
     exact callback, and resumes the wizard with safe status.
   - v1 accepts only adapter-declared `api_key` or `oauth`; unauthenticated
     connection kinds are rejected rather than inferred from an empty secret.
4. **Test.** A bounded server-side active probe verifies identity/audience and
   the minimum requested operation. Test has a timeout and safe stable error;
   it never returns provider bodies.
5. **Review separation.** The page states whether NexPress calls the provider,
   the external client calls NexPress, or both independent connections are
   being configured. No token is reused between them.
6. **Save.** Mutation uses CSRF, current site authorization, and a
   caller-stable idempotency key. A connection becomes `ready` only from a
   successful adapter result.

Leaving before Save discards browser-held secret input. Draft credentials are
not persisted as a recoverable form.

### 6.4 Grant Agent Gateway access

Agent Gateway authority is not created by pasting a model-provider or external
identity-provider token into Agent Studio.

For an interactive remote MCP client:

1. The client starts the built-in NexPress OAuth 2.1 authorization-code flow
   with PKCE, its exact registered redirect URI, and the canonical Agent
   Gateway resource.
2. NexPress authenticates the staff browser (which may itself use an installed
   upstream OIDC login), resolves the selected site, and shows client identity,
   redirect host, requested scopes, requested exposure mode, the resulting
   tool inventory, expiry, and excluded high-risk authority.
3. The server checks that the staff actor may grant every requested scope. The
   operator may narrow the scope set and exposure mode but cannot widen either
   beyond the request, deployment/site ceilings, or their current staff
   capability.
4. Consent creates a site-scoped principal and grant, then returns a one-time
   authorization code. NexPress remains the access/refresh-token issuer.
5. The new grant appears in this tab with revoke, suspend, usage, and expiry
   controls. It never displays token values.

Pre-registered trusted clients are managed as non-secret metadata with an exact
redirect URI set. The form rejects wildcards/prefix matching and visually
warns when an explicitly allowed loopback HTTP callback is the only redirect;
other redirects require HTTPS. Dynamic client registration is disabled by
default. Local stdio, CI, or other non-interactive use creates a separate,
expiring site-scoped service credential, defaults its exposure to `read`, and
shows it once. `propose` or `approved-execute` must be selected explicitly and
the review step lists every newly exposed tool. The UI never offers a
“connect my ChatGPT/Claude account” shortcut unless a provider adapter ships an
official server-side API authorization flow under the separate provider tab.

### 6.5 Rotation, disable, and revoke

- **Rotate** creates/replaces secret material through a write-only field,
  verifies the replacement, atomically activates the new reference, and
  records safe rotation metadata. Failure leaves the old active credential
  unchanged.
- **Disable** prevents new use while retaining the encrypted credential and
  dependent configuration.
- **Enable** is allowed only from `disabled`; it reruns current adapter/vault,
  authorization, model/integration inventory, and optional bounded probe
  checks before compare-and-swapping to `ready`. It never revives `revoked`.
- **Revoke** is destructive to future access and may erase credential material
  after dependent agents are paused. The confirmation lists dependent agents,
  queued/running effects, and recovery limitations from server facts.
- Revoked rows remain in bounded audit/history but cannot be tested or
  re-enabled. A replacement is a new version/connection.

### 6.6 Connection view states

| Wire status or condition | UI state                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `pending`                | Setup incomplete or OAuth callback pending; activation actions unavailable                            |
| `ready`                  | Last verification, supported inventory, dependencies, rotate/disable actions                          |
| `error`                  | Safe error code, last known good time, impact, retry eligibility                                      |
| `disabled`               | Credential retained but all new use blocked; enable requires fresh authorization and optional re-test |
| `revoked`                | Terminal badge, revocation actor/time, no reveal/test/enable action                                   |
| Adapter unavailable      | Degraded panel; metadata remains readable, secret cannot be resubmitted to an unknown adapter         |
| Vault unavailable        | Critical read-only state; no create/rotate/test/model call                                            |
| No connections           | Educational empty state differentiating provider from Gateway connection                              |

## 7. Runtime Agents

### 7.1 Agent list

The list shows:

- name and template (`publisher`, `moderator`, `operator`, `guardian`, or
  `custom`);
- status: `draft`, `active`, `paused`, `error`, or `archived`;
- provider connection alias and model, or “deterministic only”;
- trigger summary and next UTC schedule;
- effective policy version/hash short label;
- exact scope count plus per-mode counts and explicit “unattended reversible”
  / “human-approved execution” posture flags;
- current budget posture;
- last run state/time and current running count; and
- contextual Activate, Pause, Duplicate, or Archive actions.

Filters: status, template, connection, trigger kind, budget posture, and a
bounded name query. Unknown/duplicate query parameters fail with the standard
safe request error rather than being silently ignored.

### 7.2 Create/edit workflow

The wizard persists a `draft` only at explicit Save steps:

1. **Template and name.** Explain the template's supported trigger and
   capability inventory. Guardian includes the WAF/IDS/SIEM non-replacement
   statement.
2. **Connection and model.** Choose only from server-returned ready model
   connections and adapter-supported model IDs. “Deterministic only” is
   available when every selected recipe supports it.
3. **Triggers.** Select manual, exact registered event types, or valid
   five-field UTC cron. Show timezone conversion for convenience while storing
   and reviewing UTC. Filters are declarative schema fields, never code.
4. **Capabilities and scopes.** Select from server-computed compatible
   capabilities. For each, display required `NpAgentScope`, risk,
   reversibility, approval rule, and resource bounds. The client cannot add
   free-form scopes.
5. **Execution policy.** Assign a mode per capability:
   - **Observe only:** may read/record, never propose or execute;
   - **Advise:** may create a plan or ChangeSet, never execute;
   - **Guarded automatic:** may execute only an explicitly policy-allowed,
     reversible direct action;
   - **Human approval:** may request a hash-bound approval and execute only
     after it is validly consumed; or
   - **Never:** capability is unavailable to this agent.
     The list is not an escalation ladder; server capability metadata caps which
     modes are possible.
     The stored Agent-version autonomy is the exact closed value `observe`,
     `advise`, `guarded`, or `approved`; “Human approval” maps to `approved`, and
     “Never” means the capability is absent rather than a fifth autonomy value.
     The runtime principal row projects scopes/status identity only.
6. **Policy.** Choose `site` or `site_and_agent` resolution. Show the currently
   active resolved ids/hashes for review and display deterministic rules
   separately from bounded model guidance; future policy activation affects
   only newly admitted runs.
7. **Budget and limits.** Set limits no wider than the site ceiling: runs,
   provider calls, tokens, cost, concurrency, attempts, and action frequency.
8. **Review.** Fetch a server-produced effective configuration showing
   connection status, scopes, capability modes, triggers, policy hashes,
   budget ceilings, blockers, and Doctor findings.
9. **Activate.** A separate mutation activates the exact version. Activation
   carries the reviewed resolved policy hashes as compare-only preconditions
   and fails if they changed or if the connection, policy, budget measurement,
   scopes, adapter, or worker safety is invalid.

Editing an active Agent creates a draft replacement version or pauses before a
material in-place change; it must not silently expand the behavior of runs
already admitted under a frozen version.

### 7.3 Agent state and emergency controls

| Status     | Meaning and controls                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft`    | Never triggered. Editable and activatable after server review.                                                                                 |
| `active`   | Triggers may admit runs. Pause is available and records reason.                                                                                |
| `paused`   | No new triggers/model calls. Existing deterministic action may finish to a recorded safe boundary. Resume revalidates effective configuration. |
| `error`    | Server detected unusable configuration or required dependency. No new admission; repair/duplicate/archive actions only.                        |
| `archived` | Terminal configuration state; triggers disabled, history retained, no resume.                                                                  |

The site-wide **Emergency pause** is visually and operationally distinct from
pausing one Agent. Its confirmation states what stops immediately, what reaches
a safe boundary, which deterministic security controls continue, and who can
resume it.

**Resume** exists only for `paused` and performs the same effective-version,
connection, policy, scope, budget, worker, and safety validation as activation
before returning that immutable version to `active`. **Run now** is available
only for an active Agent with one enabled registered manual trigger. Its exact
request contains that `triggerId`, a bounded server-visible goal, caller-stable
idempotency key, and optional approved structured recipe inputs; it cannot add
a prompt, capability, scope, event, model, or target outside the active
version. Admission returns the generalized Runtime run contract.

Every displayed Agent state is the server-checked Agent/runtime-principal
projection: draft is suspended with empty scopes; active is active with exact
version scopes; paused/error are suspended while retaining those scopes; and
archived is terminally revoked. Agent transitions update both rows
atomically. Gateway principal edit/resume controls are never rendered for a
runtime projection.

## 8. Policies

### 8.1 Policy editor

The editor has two non-interchangeable panels:

- **Enforced rules** — structured server-validated controls for capability
  mode, risk, approval, resource allowlists, thresholds, quiet hours, action
  frequency, retention, and escalation. These rules authorize or block.
- **Agent guidance** — bounded Markdown for brand voice, classification
  guidance, editorial conventions, or operator context. Guidance can influence
  model output but cannot grant a scope, capability, or approval.

Every page repeats that distinction in text and accessible labelling. Do not
style guidance like executable policy.

### 8.2 Version workflow

1. Create a draft from the active site policy, active agent override, or an
   empty safe template.
2. Edit exact rules and guidance. Autosave, if implemented, writes only the
   draft version and shows saved/unsaved/error state.
3. Validate server-side. Results identify errors, warnings, effective
   capability changes, newly automatic actions, budget interactions, and
   agents affected.
4. Simulate against versioned synthetic fixtures or explicitly selected
   redacted historical facts. Simulation never executes a capability and is
   labeled non-authorizing.
5. Compare canonical server-produced diff against the current active policy.
6. Activate the exact content hash with an idempotency key. A high-risk
   expansion requires server-determined recent reauthentication and typed
   confirmation; it does not overload the action/ChangeSet approval table.
7. The previous active policy becomes retained/retired; admitted runs keep the
   policy IDs and hashes they started with.

Active and retired versions are immutable. “Duplicate as draft” is the only
edit path.

### 8.3 Policy states

| Status                  | UI behavior                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `draft`                 | Editable; validate/simulate/compare actions; never authorizes a run                                         |
| `active`                | Read-only; effective agent count and hash visible; duplicate/retire as permitted                            |
| `retired`               | Read-only historical version; run/audit links retained                                                      |
| Validation error        | Exact field/check list; activation unavailable                                                              |
| Simulation unavailable  | Validation remains available; UI must not imply the policy is unsafe or safe solely from missing simulation |
| Changed by another user | `409` stale state; retain a local copy for manual comparison, never overwrite                               |

## 9. Activity

### 9.1 Run list

Filters include canonical time range, run origin (`gateway` or `runtime`),
agent, template, run state, trigger kind, capability, incident, ChangeSet,
approval, and safe query. Agent/template/trigger filters apply only to Runtime
runs. Default order is newest server sequence/time first.

Run state labels use the exact inventory:

- `queued`
- `running`
- `waiting_approval`
- `waiting_retry`
- `verifying`
- `succeeded`
- `failed`
- `cancelled`
- `policy_blocked`
- `budget_blocked`

Each row shows goal summary, origin, principal, state, action counts,
started/elapsed or terminal time, and linked incident/ChangeSet. Runtime rows
also show Agent/version, trigger, and provider-call/token/cost posture;
Gateway rows show the initiating capability/invocation and never invent an
Agent configuration. “Succeeded” means the run reached its declared
successful terminal result; it must not conceal a failed or partial material
action.

### 9.2 Run detail

The header contains immutable identity: run ID, site, origin, principal,
policy/hard-rule references and hashes, idempotency-key fingerprint, and
admission/terminal timestamps. Runtime detail additionally shows
Agent/version and trigger/event; Gateway detail shows the capability and
invocation that admitted the run.

The timeline uses server-sequenced entries:

- queued, started, retried, cancelled, and terminal transitions;
- bounded context sources and their trust labels;
- provider calls with adapter alias, model, safe provider request ID, latency,
  and provider-reported or estimated usage;
- capability proposals and deterministic policy decisions;
- approvals requested/decided/consumed;
- ChangeSet creation, validation, preview, apply, verification, and rollback;
- incident creation/linking and notification outcomes; and
- client-safe errors and post-checks.

Capability action states use the exact inventory `proposed`,
`policy_blocked`, `approval_pending`, `approved`, `executing`, `succeeded`,
`failed`, and `compensated`.

The page never exposes hidden chain-of-thought, raw prompts containing
unbounded content, raw provider response bodies, credentials, cookies,
authorization headers, full request bodies, or unredacted PII. An optional
“Agent assessment” section is bounded plain text with an untrusted/model badge.

### 9.3 Activity actions

- **Cancel run** is available only when the server declares the state
  cancellable. It records a reason and does not imply rollback of an already
  committed action.
- **Retry** creates a linked attempt/run with a new explicit idempotency
  lineage while committed actions retain their keys. It is not a blind replay.
- **Open approval/ChangeSet/incident** carries only the opaque returned ID.
- **Copy support bundle** exports a bounded redacted contract, never the
  browser DOM or raw internal log.

## 10. Approvals and Agent ChangeSets

### 10.1 Approval queue

The queue defaults to `pending`, soonest expiry then highest risk. Filters:
state, risk, target kind, agent, requester, required staff capability, expiry,
and creation time.

Approval states are exact:

- `pending`
- `approved`
- `rejected`
- `expired`
- `consumed`
- `revoked`

Rows show server title, target kind, risk, requester principal/agent, exact
required staff capabilities, operation/target counts, request and expiry time,
preview/check posture, and whether a valid rollback plan exists. There is no
bulk Approve in the initial release.

### 10.2 Server facts versus model content

The approval page has a visually dominant **Server facts** section. Every
authorizing value comes from the sealed target and registered capability, not
from model prose:

- canonical current site and target identity;
- target kind/id and immutable plan/proposal hash;
- requesting principal, Agent and configuration version, run, and trigger;
- registered capability IDs and required `NpAgentScope` values;
- capability contract version/fingerprint and exact required-scope set;
- required human `NpCapability` set;
- server-calculated risk and approval mode;
- normalized operation and resource target inventory;
- base version/ETag and current conflict posture;
- server-generated structural/field diffs;
- deterministic validation and Doctor/check results by stable ID;
- validation generation/base fingerprint plus preview artifact
  identity/digest, freshness,
  rendering failures, and expiry;
- deterministic policy IDs, versions, hashes, and allow/block result;
- reversibility declaration, compensation/rollback plan identity, and
  non-atomic external steps;
- approval request/expiry state; and
- expected effects and verification checks from deterministic executors.

A separate **Agent assessment (untrusted)** region may show bounded rationale,
confidence, or summary. It:

- is introduced with explicit untrusted/model language;
- is rendered as escaped plain text or a tightly bounded safe Markdown subset;
- cannot contribute hidden form fields, links with active credentials,
  confirmation phrases, risk badges, target counts, or action labels; and
- can be collapsed without removing any information needed to decide.

The client never constructs an approval from a model response, public content,
or query parameters.

### 10.3 Approval decision workflow

1. Open detail and fetch the current exact approval plus sealed target facts.
2. The server returns whether the current staff actor may approve/reject/
   revoke. After the user starts a decision, the client calls the dedicated
   decision-challenge route with current approval version, intended decision,
   and statement hash; the server returns one short-lived challenge.
3. The user reviews diffs, preview, checks, risk, policy, expiry, and rollback.
   Preview is never the only representation of the changes.
4. The one-time typed challenge is always intent confirmation, never a
   substitute for authentication. Approving a sensitive/destructive action
   also requires server-verified `staff-primary` reauthentication in the same
   session within the deployment-capped 300-second window. The model cannot
   author either.
5. Approve, Reject, or Revoke sends the returned approval version, statement
   hash, challenge generation/value, caller-stable idempotency key, and
   optional bounded human reason through the matching generic approval
   decision route. The server derives the target kind from the approval row;
   the browser cannot switch it.
6. The browser does not optimistically change state. It renders the validated
   returned approval row.
7. Approval does not itself imply apply success. Apply claims a single-use
   approved record, rechecks live state, and moves the operator to Activity or
   ChangeSet execution progress.
8. A `409` stale/hash/target-version conflict clears the challenge and reloads
   server facts. The UI never automatically retries a decision against a new
   plan.

Reject does not mutate the target. Revoke applies to a pending or approved but
unconsumed statement, requires the same or stronger human authorization, and
always issues a fresh `revoke` challenge; it cannot reuse a consumed approval
challenge. Expired, rejected, consumed, and revoked decisions are read-only
history.

### 10.4 Agent ChangeSet detail

Use a stage navigator driven by the exact ChangeSet contract:

1. Proposal
2. Validation
3. Preview
4. Approval
5. Apply
6. Verification
7. Rollback, when present

The navigator is not a linear success stepper: stale, failed, partial,
superseded, rejected, expired, and rolled-back outcomes remain visible at the
stage where they occurred. These are operator-facing reason/outcome labels
over the exact ChangeSet and approval states below, not additional wire states.

The v1 wire states are exact and map to UI as follows:

| State                 | Stage and presentation                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| `draft`               | Proposal is editable; no approval or apply control                                   |
| `validating`          | Validation task is running; proposal editing is disabled until the result is current |
| `invalid`             | Validation issues shown by operation/path; edit returns to `draft`                   |
| `ready`               | Sealed current plan; preview and request-approval actions                            |
| `approval_pending`    | Pending approval facts and expiry; proposal is immutable                             |
| `approved`            | Single-use decision available; apply/schedule still rechecks live facts              |
| `scheduled`           | Canonical UTC schedule, local equivalent, and cancellation eligibility               |
| `applying`            | Execution progress from durable task; no optimistic cancel                           |
| `applied`             | Writes committed; verification is pending/starting                                   |
| `verifying`           | Expected/actual post-check progress                                                  |
| `verified`            | Successful terminal result with revisions and rollback posture                       |
| `rejected`            | Read-only decision and bounded human reason                                          |
| `cancelled`           | Read-only cancellation actor/time/reason                                             |
| `apply_failed`        | Per-operation result and safe retry/compensation plan when available                 |
| `verification_failed` | Applied state is explicit; rollback/repair plan is not implied success               |
| `rolling_back`        | Forward compensation progress; original result remains visible                       |
| `rolled_back`         | Verified compensation result and resulting revisions                                 |
| `rollback_failed`     | Critical partial compensation state with incident and operator escalation            |

Detail content:

- immutable plan identity and base fingerprint;
- ordered operations grouped by resource kind;
- before/after values with sensitive fields redacted;
- validation issues linked to operation ordinal and field path;
- desktop/mobile preview with accessible open-in-new-window action and
  artifact expiry;
- approval history;
- application result per operation, identifying non-atomic boundaries;
- verification expected/actual result;
- rollback plan and compensation result; and
- links to revisions, audit, Activity, and incidents.

Diff defaults to a semantic field view. A raw bounded JSON view is optional for
experts and must be validated, syntax-readable without color, and never include
secret or access-restricted snapshots.

### 10.5 ChangeSet controls

- Validate and Preview do not mutate target resources.
- Request approval is enabled only for a sealed current plan.
- Apply is not a general button on a draft; it appears only after valid policy
  and approval posture and still relies on server execution admission.
- Schedule displays the canonical UTC value and user-local equivalent.
- Rollback is a new audited plan/action with a fresh authorization decision;
  it does not delete the original ChangeSet or revision.
- A partial result has no generic “Retry all.” Each remaining/compensating
  operation is derived by the server to avoid repeating committed work.

## 11. Incidents

### 11.1 Incident list

Default sort: unresolved first, severity `critical` to `info`, then
`lastSeenAt` descending. Filters: category, exact status, severity, source,
assigned Agent, containment active, time range, and safe query.

Incident statuses are exact:

- `open`
- `investigating`
- `contained`
- `monitoring`
- `resolved`
- `dismissed`

Incident categories use the exact signal inventory: `spam`, `abuse`,
`authentication`, `authorization`, `traffic`, `integrity`, `availability`,
`cost`, and `agent-abuse`. Storage and job failures are evidence under
the availability or integrity category; v1 does not accept free-form
extension categories.

Rows display server title, category, severity, status, signal count, first/last
seen, assigned Agent, active containment count/nearest expiry, and model
assessment availability. A model confidence value never replaces severity,
which is a server fact.

### 11.2 Incident detail

Header:

- site, incident ID/fingerprint-safe label, category, status, severity;
- server summary and separately labeled model assessment;
- opened/last seen/resolved timestamps;
- signal and affected-resource counts;
- active containment with expiry/restore status; and
- assignee and notification posture.

Evidence is grouped, bounded, and paginated by signal source. Signal rows show
their deterministic `exact-rule`, `statistical`, or validated `external`
confidence basis. Model assessments are separate, provenance-labelled timeline
entries and never masquerade as signals. Raw IP/email/account values remain
hashed/opaque according to the signal contract; “view raw logs” is not an
Agent Studio capability.

Timeline entries explicitly label:

- **Observed fact**
- **Deterministic correlation/policy**
- **Agent assessment**
- **Human note/decision**
- **Action/containment**
- **Verification**

This distinction must remain available to screen readers and exported support
bundles, not only through color or icon.

### 11.3 Incident workflow

1. Open incidents can be acknowledged and moved to `investigating` by an
   authorized human.
2. V1 assignment accepts only a same-site configured Agent according to
   category; assignment does not grant new capability. Human ownership is
   represented by acknowledged/investigating transitions and human notes, not
   an undeclared staff-assignee field.
3. A response plan lists exact capability, target, expiry, reversibility,
   policy, evidence, and approval requirement.
4. Guarded automatic containment already performed is shown as an action with
   active expiry and immediate authorized Restore when safe.
5. Approval-required response follows the same hash-bound approval flow; there
   is no incident-specific bypass.
6. `contained` means the selected containment completed and remains visible;
   `monitoring` means post-containment verification remains open.
7. Resolve requires a bounded resolution category and note plus server summary
   of active actions. Unexpired containment must be explicitly retained,
   restored, or acknowledged.
8. Dismiss requires a reason and records false-positive/disposition evidence.
   It does not delete signals.
9. A new qualifying signal may reopen by creating a server-sequenced event or
   a linked incident according to correlation policy; the client never changes
   a terminal state itself.

Guardian pages always include:

> Guardian correlates NexPress application signals. It does not replace your
> WAF, IDS/IPS, malware scanner, SIEM, backups, or incident-response process.

## 12. Budgets and runtime settings

### 12.1 Budget hierarchy

Display the site ceiling first, then per-Agent narrower limits. Missing Agent
limits inherit; they never widen the site ceiling.

The form is generated from the one exact `NpAgentBudgetV1` contract. It shows
run/provider-call concurrency; runs/provider calls per rolling hour;
provider calls, input/output tokens, attempts, and capability calls per run;
input/output tokens and cost micros per UTC day/month; incident analyses per
fingerprint plus cooldown; direct actions per site/subject rolling hour; and
the warning basis-points threshold. “Total tokens” is a derived display only,
not a parallel persisted ceiling. Every Agent value shows its inherited
deployment/site value and cannot be raised above it.

Usage distinguishes:

- provider-reported finalized usage;
- locally estimated usage;
- reserved allowance for admitted in-flight calls;
- unknown/unmeasurable usage; and
- remaining hard allowance.

Unknown is never displayed as `0`.

### 12.2 Budget posture

| Posture                 | Meaning                                              | UI behavior                                                                  |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Normal                  | Usage below warning and hard thresholds              | Neutral progress and exact values                                            |
| Warning                 | Configured warning threshold crossed                 | Warning banner and affected Agent list                                       |
| Exhausted               | Hard admission ceiling reached                       | New provider calls blocked; reset time and deterministic behavior shown      |
| Measurement unavailable | Server cannot safely measure a configured dimension  | Fail-closed critical state; do not estimate “available”                      |
| Provider cost unknown   | Late/ambiguous historical usage cannot reconcile yet | Show Unknown, retain maximum reservation, and block new provider-backed runs |
| Emergency paused        | Site admission intentionally stopped                 | Persistent actor/time/reason banner                                          |

Budget edits show an effective-before/effective-after server diff and affected
running/queued Agents. Lowering a limit does not retroactively pretend an
already admitted provider call did not exist; it prevents subsequent admission
and records over-ceiling in-flight reservation explicitly.

## 13. Loading, empty, error, and stale states

### 13.1 Shared state contract

Every view implements these states deliberately:

| State                     | Required rendering                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Initial loading           | Layout-stable skeleton with page title available; no fake status values or generic full-screen spinner      |
| Refreshing                | Existing validated data remains with “Refreshing” status; mutation controls requiring freshness may disable |
| Loaded with data          | Exact freshness timestamp and pagination/cursor state                                                       |
| Loaded empty              | Surface-specific explanation and only an authorized next action                                             |
| Stale cached data         | Persistent stale timestamp/banner; never label as current or healthy                                        |
| Partial/degraded          | Failed subsystem/card identified; safe consequences and retry eligibility stated                            |
| Validation/contract error | Fail-closed panel with safe issue ID and support correlation; do not render unknown payload fields          |
| Authentication lost       | Clear sensitive client state and use the existing login flow                                                |
| Forbidden                 | Standard no-access page; no repeated background fetch                                                       |
| Not found/site mismatch   | Same generic not-found result                                                                               |
| Conflict/stale mutation   | Preserve unsent human text locally, reload server facts, require explicit reconciliation                    |
| Rate limited              | Exact safe message and `Retry-After`; no busy retry loop                                                    |
| Budget blocked            | Identify hard limit, reset/period, and deterministic behavior that continues                                |
| Provider unavailable      | Identify affected Agents/actions; keep deterministic site behavior and retained evidence visible            |
| Worker unavailable        | No “running normally” status; queued work and last heartbeat shown                                          |
| Generic safe API error    | Use stable error code/correlation, bounded message, retry only for declared retryable errors                |

The API error body remains the shipped exact `{ error, status }` envelope.
Client copy branches on stable safe codes, not provider message strings.

### 13.2 Surface-specific empty states

| Surface     | Empty copy intent                                                                    | Primary action                              |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Connections | Explain provider-outbound versus Gateway-inbound credentials                         | Add provider connection or authorize client |
| Agents      | Explain that no always-running model is required; Agents are event-driven            | Create paused Agent                         |
| Policies    | Explain deterministic rules versus guidance                                          | Create safe draft policy                    |
| Activity    | “No Agent runs match these filters”                                                  | Clear filters; no forced run                |
| Approvals   | “Nothing is waiting for your decision”                                               | View history                                |
| Incidents   | “No open incidents match these filters” without claiming the site cannot be attacked | View resolved/dismissed history             |
| Budgets     | This is not a valid empty state once runtime is enabled                              | Configure required hard ceilings            |

## 14. Audit visibility

Agent Studio Activity is an operator-readable projection over append-only
agent/action/audit records; it is not a replacement for the existing community
or operations audit contracts.

For every material action, authorized users can inspect:

- canonical site and server sequence/time;
- origin: staff Admin, internal Runtime Agent, local MCP, remote MCP, scheduled
  trigger, framework event, or approved integration;
- human actor where present;
- principal, Agent and configuration version, gateway client, and connection
  alias where applicable;
- effective sorted agent scopes and registered capability ID/version;
- policy IDs/versions/hashes and deterministic decision;
- risk, approval mode, approval ID/decision actor, and proposal/plan hash;
- caller-stable idempotency key fingerprint and retry lineage;
- bounded redacted input/output and canonical full-value hashes;
- target resource identities and before/after revision or state references;
- provider adapter/model, safe request correlation, duration, and usage
  classification;
- execution, verification, compensation/rollback, and incident outcome; and
- safe error/check IDs.

Never display or export:

- provider/API/OAuth/service-token secrets or vault locators;
- cookies, authorization/CSRF headers, raw request bodies, or raw provider
  response bodies;
- hidden chain-of-thought;
- unbounded prompts, logs, public content, user-agent strings, IP addresses, or
  PII;
- access-restricted before snapshots to a user lacking current authorization;
  or
- model-produced risk, capability, scope, or approval facts as if they were
  server facts.

Retention or redaction after retention does not rewrite attribution. The view
states that a payload expired or was redacted and retains its hash and safe
metadata according to policy.

## 15. API dependencies

These are proposed Admin HTTP resources. The exact request/response definitions
must be generated from the client-safe agent contract, appear in OpenAPI when
appropriate, use canonical UTC ISO timestamps, and return the shipped exact
error envelope. List endpoints are site-scoped, paginated, bounded, and
server-authorized.

AP-101 now fixes the shared read primitives for the rows used here:
`np.agent-principal.v1`, `np.agent-connection.v1`, `np.agent-budget.v1`,
`np.agent-run.v1`, and nested `np.agent-action-projection.v1`, plus the exact
bounded cursor-page analyzer. The principal wire contains no credential/grant
locator, the connection wire contains only stored/absent credential state,
and the action projection contains redacted input/output rather than canonical
execution input or undo/evidence material. These are response contracts only;
they do not make any proposed route in the following tables live.

### 15.1 Read dependencies

| Method and proposed path                                                            | Schema family                    | Used by                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `GET /api/admin/agents/overview`                                                    | `np.agent-overview.v1`           | Overview cards and authorized attention counts                   |
| `GET /api/admin/agents/connections`                                                 | `np.agent-connection.v1` list    | Connection list                                                  |
| `GET /api/admin/agents/connections/{id}`                                            | `np.agent-connection.v1`         | Connection detail/dependencies                                   |
| `GET /api/admin/agents/adapters`                                                    | `np.agent-adapter.v1`            | Connection wizard provider/auth/model/config inventory           |
| `GET /api/admin/agents/gateway/settings`                                            | `np.agent-gateway-settings.v1`   | Deployment ceiling, site ceiling, effective modes, route posture |
| `GET /api/admin/agents/gateway/oauth-clients`                                       | `np.agent-oauth-client.v1` list  | Pre-registered client metadata and redirect inventory            |
| `GET /api/admin/agents/gateway/principals`                                          | `np.agent-principal.v1` list     | Gateway access tab                                               |
| `GET /api/admin/agents/gateway/principals/{id}`                                     | `np.agent-principal.v1`          | Principal/grant/token detail                                     |
| `GET /api/admin/agents/configurations`                                              | `np.agent-configuration.v1` list | Agent list                                                       |
| `GET /api/admin/agents/configurations/{id}`                                         | `np.agent-configuration.v1`      | Agent editor/detail                                              |
| `GET /api/admin/agents/configurations/{id}/effective`                               | `np.agent-effective-config.v1`   | Server review/blockers before activation                         |
| `GET /api/admin/agents/capabilities`                                                | `np.agent-capability-catalog.v1` | Exact scope/risk/approval/reversibility inventory                |
| `GET /api/admin/agents/policies`                                                    | `np.agent-policy.v1` list        | Policy list                                                      |
| `GET /api/admin/agents/policies/{id}`                                               | `np.agent-policy.v1`             | Policy detail/version diff                                       |
| `GET /api/admin/agents/activity`                                                    | `np.agent-run.v1` list           | Run list                                                         |
| `GET /api/admin/agents/activity/{id}`                                               | `np.agent-run-detail.v1`         | Run header/timeline/action pages                                 |
| `GET /api/admin/agents/approvals`                                                   | `np.agent-approval.v1` list      | Approval queue/history                                           |
| `GET /api/admin/agents/approvals/{id}`                                              | `np.agent-approval-detail.v1`    | Decision facts and current actor permissions                     |
| `GET /api/admin/agents/changesets`                                                  | `np.agent-changeset.v1` list     | Authorized ChangeSet history/filtering                           |
| `GET /api/admin/agents/changesets/{id}`                                             | `np.agent-changeset.v1`          | ChangeSet stages/diff/results                                    |
| `GET /api/admin/agents/changesets/{id}/preview`                                     | `np.agent-preview.v1`            | Authorized artifact metadata; not unrestricted draft content     |
| `GET /api/admin/agents/changesets/{id}/previews/{previewId}/artifacts/{artifactId}` | private artifact bytes           | Reauthorize site/target/digest/expiry then no-store stream       |
| `GET /api/admin/agents/incidents`                                                   | `np.agent-incident.v1` list      | Incident queue                                                   |
| `GET /api/admin/agents/incidents/{id}`                                              | `np.agent-incident-detail.v1`    | Incident evidence/timeline/actions                               |
| `GET /api/admin/agents/budgets`                                                     | `np.agent-budget.v1`             | Site and Agent ceilings/usage                                    |
| `GET /api/admin/agents/runtime-status`                                              | `np.agent-runtime-status.v1`     | Worker, emergency pause, quota, vault, adapter posture           |

The artifact GET is a safe read, not AP-001 mutation admission: it requires a
current staff session/site/capability, every ChangeSet target still visible,
ready/unexpired preview, and byte-equal artifact digest/MIME/size. It streams
through the shared artifact-resource facade with the preview no-store,
nosniff, referrer, CSP/content-disposition policy and never exposes a storage
locator or signed URL.

### 15.2 Mutation dependencies

All mutations require the existing Admin session/CSRF behavior, current site
scope, required staff capability, exact input validator, and a caller-stable
idempotency key. The paths are proposed resource shapes, not permission
shortcuts.

The table below is a product route inventory, not a sufficient implementation
contract. Before any listed mutation route lands, R0 `AP-001` must export one
exhaustive `NpAgentAdminOperationContractV1` record per row with: stable
operation id/version; method and path template; named exact input/output/error
schemas; required `NpCapability`; idempotency-key location; expected
row-version/plan/config hash preconditions; one-time/secret-body classification;
domain effect and verifier/compensation metadata; approval/reauthentication
floor; and audit/redaction policy. Route registration, OpenAPI, Admin client,
invocation admission, Doctor, and tests consume that map. An unmapped row is a
startup/build error and must not be implemented ad hoc.

`@nexpress/core/agent-contract` now implements that AP-001 boundary for all 55
rows. The registry composes existing JSON Schema, human capability, effect
profile, API error, route-path, canonical JSON/digest, and invocation-request
primitives instead of defining parallel versions. Its exhaustive analyzer,
per-operation lookup, method/path and OpenAPI uniqueness checks, named schema
bindings, and aggregate golden fingerprint are the source future route,
OpenAPI, Admin client, admission, and Doctor work must consume.

Each route registers a closed server-owned operation id, contract version, and
input/output/effect fingerprint. Admission persists the staff actor and
idempotency tuple in `np_agent_invocations` with `operation_kind=admin`; it
does not create a machine principal or infer `NpAgentScope` from a staff role.
Changing a route contract requires a fingerprint/version update and
idempotency fixture.

The operation record's reauthentication floor is the closed value `none` or
`recent-staff-primary`. The server composes it with the capability risk/policy
rule; sensitive/destructive approval always resolves to the recent mode with
one statement-bound safe integer maximum age in `1..300`, and no route can
lower it. Typed challenges and ordinary session age never satisfy this field.

The operation registry marks service-token create/rotate, approval
decision-challenge issuance, and isolated preview launch as the four explicit
`oneTimeOutput:true` operations. Their plaintext authority is returned only by
the first successful response and is never stored in the invocation result.
Retrying the same idempotency key returns
`ONE_TIME_VALUE_ALREADY_ISSUED` plus the safe created resource id and recovery
action; it cannot replay the token, challenge, or launch exchange. Token
recovery is rotate/revoke with a new key. Challenge and preview recovery issue
a new generation with a new key and invalidate or supersede the old verifier.

| Method and proposed path                                                                  | Purpose                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /api/admin/agents/connections`                                                      | Create write-only connection metadata/secret                                                          |
| `PATCH /api/admin/agents/connections/{id}`                                                | Validate and stage/activate exact non-secret config with version/hash precondition                    |
| `POST /api/admin/agents/connections/{id}/oauth/start`                                     | Create state/PKCE-bound provider authorization and return its trusted URL                             |
| `POST /api/admin/agents/connections/{id}/test`                                            | Run bounded adapter probe                                                                             |
| `POST /api/admin/agents/connections/{id}/rotate`                                          | Verify and activate replacement secret                                                                |
| `POST /api/admin/agents/connections/{id}/disable`                                         | Prevent new use                                                                                       |
| `POST /api/admin/agents/connections/{id}/enable`                                          | Revalidate dependencies/probe and return disabled connection to ready                                 |
| `POST /api/admin/agents/connections/{id}/revoke`                                          | Pause dependencies and revoke/erase future credential use                                             |
| `PATCH /api/admin/agents/gateway/settings`                                                | Narrow or explicitly enable site transport ceilings within deployment limits; never configures a port |
| `POST /api/admin/agents/gateway/oauth-clients`                                            | Register exact public-client metadata and redirect set                                                |
| `POST /api/admin/agents/gateway/oauth-clients/{id}/revoke`                                | Revoke client plus its unconsumed codes and active grants                                             |
| `POST /api/admin/agents/gateway/principals`                                               | Create service/deployment principal metadata and maximum scopes; no OAuth grant/token                 |
| `PATCH /api/admin/agents/gateway/principals/{id}`                                         | Edit bounded metadata and exact external-principal scopes                                             |
| `POST /api/admin/agents/gateway/principals/{id}/tokens`                                   | Issue one-time transport/audience/exposure-bound service credential                                   |
| `POST /api/admin/agents/gateway/principals/{id}/tokens/{tokenId}/rotate`                  | Issue one replacement and start exact bounded overlap                                                 |
| `POST /api/admin/agents/gateway/principals/{id}/tokens/{tokenId}/revoke`                  | Immediately revoke only the selected credential                                                       |
| `POST /api/admin/agents/gateway/principals/{id}/suspend`                                  | Suspend inbound use                                                                                   |
| `POST /api/admin/agents/gateway/principals/{id}/resume`                                   | Revalidate authority/scopes/live credentials and resume                                               |
| `POST /api/admin/agents/gateway/principals/{id}/revoke`                                   | Revoke inbound principal/grants/tokens                                                                |
| `POST /api/admin/agents/configurations`                                                   | Create draft Agent                                                                                    |
| `PATCH /api/admin/agents/configurations/{id}`                                             | Edit draft-safe fields with version precondition                                                      |
| `POST /api/admin/agents/configurations/{id}/activate`                                     | Activate exact effective version                                                                      |
| `POST /api/admin/agents/configurations/{id}/pause`                                        | Stop new admission/model calls                                                                        |
| `POST /api/admin/agents/configurations/{id}/resume`                                       | Revalidate paused version/dependencies before new admission                                           |
| `POST /api/admin/agents/configurations/{id}/runs`                                         | Admit one bounded registered manual-trigger run                                                       |
| `POST /api/admin/agents/configurations/{id}/archive`                                      | Disable triggers and preserve history                                                                 |
| `POST /api/admin/agents/policies`                                                         | Create draft policy/version                                                                           |
| `PATCH /api/admin/agents/policies/{id}`                                                   | Edit draft with version/hash precondition                                                             |
| `POST /api/admin/agents/policies/{id}/validate`                                           | Deterministic validation; no activation                                                               |
| `POST /api/admin/agents/policies/{id}/simulate`                                           | Bounded non-authorizing simulation                                                                    |
| `POST /api/admin/agents/policies/{id}/activate`                                           | Activate exact content hash                                                                           |
| `POST /api/admin/agents/activity/{id}/cancel`                                             | Request bounded cancellation                                                                          |
| `POST /api/admin/agents/activity/{id}/retry-plan`                                         | Produce safe linked retry plan, not blind replay                                                      |
| `POST /api/admin/agents/approvals/{id}/decision-challenge`                                | Issue one purpose/session/version-bound five-minute challenge                                         |
| `POST /api/admin/agents/approvals/{id}/approve`                                           | Canonically approve any exact ChangeSet/rollback/action statement                                     |
| `POST /api/admin/agents/approvals/{id}/reject`                                            | Canonically reject any exact pending statement                                                        |
| `POST /api/admin/agents/approvals/{id}/revoke`                                            | Canonically revoke any approved unconsumed statement                                                  |
| `POST /api/admin/agents/changesets`                                                       | Create a draft ChangeSet                                                                              |
| `PATCH /api/admin/agents/changesets/{id}`                                                 | Edit only a `draft` or `invalid` ChangeSet                                                            |
| `POST /api/admin/agents/changesets/{id}/validate`                                         | Validate and seal/currently diagnose                                                                  |
| `POST /api/admin/agents/changesets/{id}/preview`                                          | Generate bounded preview artifacts                                                                    |
| `POST /api/admin/agents/changesets/{id}/previews/{previewId}/launch`                      | Issue one 30-second no-store bridge exchange to the isolated preview origin after live authorization  |
| `POST /api/admin/agents/changesets/{id}/request-approval`                                 | Create/reuse one exact pending approval for schedule/apply                                            |
| `POST /api/admin/agents/changesets/{id}/cancel`                                           | Cancel an eligible non-executing plan and revoke approval                                             |
| `POST /api/admin/agents/changesets/{id}/schedule`                                         | Bind canonical UTC schedule to an authorized plan                                                     |
| `POST /api/admin/agents/changesets/{id}/apply`                                            | Admit execution only with a valid approved plan                                                       |
| `POST /api/admin/agents/changesets/{id}/rollback-plans`                                   | Prepare one exact forward-compensation generation                                                     |
| `POST /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/request-approval` | Request approval for exact rollback id/hash                                                           |
| `POST /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/execute`          | Execute only the exact approved rollback plan                                                         |
| `POST /api/admin/agents/incidents/{id}/transitions`                                       | Authorized exact state transition and human note                                                      |
| `POST /api/admin/agents/incidents/{id}/response-plan`                                     | Create deterministic response plan/approval                                                           |
| `POST /api/admin/agents/incidents/{id}/restore`                                           | Restore exact reversible containment                                                                  |
| `PATCH /api/admin/agents/budgets`                                                         | Update site/per-Agent ceilings with expected version                                                  |
| `POST /api/admin/agents/runtime/pause`                                                    | Emergency stop for new runtime admission                                                              |
| `POST /api/admin/agents/runtime/resume`                                                   | Revalidate and resume runtime admission                                                               |

Secret inputs should use request bodies only, with no persistence in URLs,
client caches, analytics, or error details. `npFetch` remains the browser
client so shared auth and CSRF headers are used.

### 15.3 Provider OAuth callback

Provider connection OAuth has one non-Admin callback route:

```text
GET /api/agents/provider-oauth/callback/{adapterId}
```

The exact query is either success `{code,state}` or denial
`{error,state,error_description?,error_uri?}`; duplicate, mixed, unknown, or
oversized parameters fail closed. `POST
/api/admin/agents/connections/{id}/oauth/start` is an ordinary AP-001 Admin
operation. It snapshots config/adapter/client/permissions and the initiating
staff session, stores only the keyed state verifier and PKCE vault reference,
and returns an authorization URL whose origin and redirect URI come from the
installed adapter contract.

The callback is deliberately outside the Admin mutation registry: its sole
authority/idempotency boundary is the one-time `npps1` state verifier and
compare-and-swap of that auth-request row. It requires the initiating staff
session, exact adapter/path/config/client/permission match, consumes the state
once. A success transaction creates the linked pending code secret, vault seal
journal, and `awaiting_secret` exchange operation before dispatching seal; the
vault reconciler alone queues it after a proven seal receipt. Denial instead
atomically moves the request to `denied` with
`AUTHORIZATION_DENIED`, journals PKCE destruction, and creates no code or
exchange operation. Either terminal outcome is replay-stable. It
returns only `303` to the fixed same-origin local connection detail URL with
one server-chosen `oauth=pending|denied|failed` value; it never accepts a
return URL or reflects provider text. The response is `Cache-Control:
no-store`, uses a restrictive referrer policy, and route/proxy logging redacts
the complete query before parsing. Callback routes are documented as
server-to-provider integration endpoints but are not offered as Agent
capabilities.

### 15.4 Freshness and progress

The first release may use bounded polling with ETag/sequence cursors:

- queued/running detail: poll at a server-declared interval with backoff;
- approval/incident list: refetch on focus and a bounded interval;
- terminal detail: stop polling;
- `429`/`Retry-After`: honor the server value;
- background/hidden tab: pause or substantially reduce polling.

A later site-scoped PII-free invalidation stream may notify the browser that a
resource sequence advanced. It carries only resource kind, opaque ID where
authorized, site-scoped sequence, and invalidation reason—not prompts,
evidence, diffs, or secrets. The browser refetches the authoritative HTTP
resource. SSE must not become a second data contract.

## 16. Client/server and package boundaries

- Protected server pages in `@nexpress/app` initialize the appropriate
  `ensureFor("read" | "plugins" | "write")` intent, resolve current site and
  user, apply `can(...)`, and pass only serializable safe props.
- Mutation route handlers use `ensureFor("write")`; read pages do not start a
  competing worker.
- `@nexpress/admin/client` contains hook-using views and imports runtime
  validators only from the browser-safe `@nexpress/core/agent-contract`
  subpath.
- The Admin package must not import server-only `@nexpress/core/agents`, DB,
  vault, provider adapters, capability executors, or bootstrap setters.
- New neutral UI primitives remain boundary-neutral and are not individually
  marked `"use client"`. Agent Studio views are client components.
- Heavy diff, screenshot comparison, or structured policy editors are
  lazy-loaded so the global Admin shell does not include them.
- The browser never receives the full server registry, executor, policy
  callback, raw secret reference, or unrestricted artifact location.
- `apps/web` adds only thin route/page wrappers when the surface is shared.

## 17. Accessibility requirements

Agent Studio must meet `PR-NFR-A11Y-001` and WCAG 2.2 AA:

- all navigation, filters, dialogs, tables/cards, diffs, timelines, preview
  controls, and confirmation workflows are keyboard operable;
- focus moves to a dialog heading on open, returns to the invoker on close,
  and moves to the error summary after failed submit;
- status is conveyed with text and icon/shape in addition to color;
- pending live updates use a polite live region; critical execution failure
  uses an assertive announcement once, not on every poll;
- progress indicators expose determinate values only when the server supplies
  them and otherwise use accessible indeterminate language;
- tables include headers and captions; responsive card conversions retain
  label/value semantics and row actions;
- semantic diffs use `<del>`/`<ins>` or equivalent accessible labels, support
  changed-field navigation, and provide a non-color before/after view;
- screenshots/previews have descriptive labels, viewport size, generated and
  expiry time, and a text diff/check alternative;
- risk, model assessment, server fact, untrusted evidence, and human decision
  labels are available in accessible names;
- charts always have an equivalent data table and do not rely on hover;
- icon-only controls have explicit accessible labels;
- destructive or sensitive confirmation is never a timed interaction; expiry
  refreshes server facts instead of forcing a rushed decision; and
- motion honors `prefers-reduced-motion`.

## 18. Responsive requirements

Support at least 320 CSS pixels through the existing Admin content width.

- **Below 640 px:** one column; local navigation is compact; data tables render
  as labelled cards; filters open in a full-width sheet; primary and secondary
  actions stack; approval facts precede decision controls.
- **640–1023 px:** one main column with optional two-card overview grid; detail
  metadata may use two columns; diff before/after defaults to stacked.
- **1024 px and above:** overview may use a 12-column grid; detail pages use a
  main evidence column and a bounded sticky summary/decision rail.
- Sticky decision controls must never hide the final server fact, validation
  error, or mobile browser controls.
- Long opaque IDs, scope names, hashes, capability IDs, and UTC timestamps wrap
  or use accessible copy controls without causing horizontal page overflow.
- Preview screenshots may scroll within a labelled region, but authorizing
  facts and decision controls never require horizontal page scrolling.
- The existing collapsible/mobile Admin sidebar behavior remains authoritative;
  Agent Studio must not create a second left application sidebar.

## 19. UX security constraints

- Never put secrets, approval challenges, plan hashes, raw evidence, or
  credentials in query parameters.
- External links from model or untrusted evidence are plain text by default.
  Server-approved external integration links open with safe `rel` attributes
  and an external destination label.
- No model content may select a route, auto-submit a form, invoke a tool, set a
  confirmation phrase, or render raw HTML.
- Clipboard actions copy only the visibly bounded safe value and announce what
  was copied.
- Browser analytics must exclude secret inputs, policy guidance, model
  assessment, diffs, incident evidence, and approval comments.
- Confirmation dialogs fetch current server facts; they do not trust the list
  row that opened them.
- After a site switch, logout, credential revoke, or permission loss, clear
  relevant client caches and close dialogs.
- Do not use optimistic updates for approval, apply, rollback, connection
  rotation/revocation, policy activation, Agent activation, emergency pause,
  or incident containment.

## 20. Admin release acceptance

An Agent Studio phase is not complete until:

1. every response is validated through `@nexpress/core/agent-contract` before
   rendering;
2. server page and route authorization has cross-role and cross-site tests;
3. each included view implements loading, empty, populated, stale, degraded,
   forbidden, contract-error, conflict, and safe mutation-error fixtures;
4. connection tests prove no create/read/list/error/audit/OpenAPI response
   reveals secret material;
5. approval tests prove all authorizing facts originate from sealed
   server-produced data and model text remains non-authorizing;
6. keyboard-only and screen-reader checks cover the complete connection,
   Agent activation, approval, rollback, and incident-response workflows in
   the phases where they ship;
7. 320 px, tablet, desktop, light, dark, reduced-motion, long-localized-copy,
   and high-data-volume visual checks pass;
8. running-state polling backs off, terminal states stop polling, and failure
   does not create a request or provider-cost loop;
9. audit projections retain exact attribution while applying required
   redaction and permissions;
10. Admin Health and Doctor show safe counts/readiness for vault, adapters,
    runtime, queues, stale runs, approvals, retention, and budget measurement;
11. shared implementation lands in `@nexpress/app` and
    `@nexpress/admin/client` with only thin reference-app wrappers; and
12. the live Admin and agent guides replace proposed language only after the
    corresponding behavior ships.
