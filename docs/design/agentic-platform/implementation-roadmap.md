# Agentic Platform implementation roadmap

> Status: dependency-ordered implementation plan.
> Estimates are planning slices, not release commitments.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).

This roadmap turns the design set into mergeable work packages. It deliberately
lands exact contracts, persistence, authorization, and safe no-op runtime
behavior before model calls or production writes.

## 1. Sequencing principles

1. Shared client-safe contracts land before server, route, Admin, MCP, or
   plugin consumers.
2. One owner edits a shared contract/schema/config file in a given PR.
3. New persisted rows land disabled and readable by Doctor before a worker or
   route can create them.
4. Read-only capability execution precedes ChangeSet writes.
5. ChangeSet validation/preview precedes approval/apply.
6. Deterministic event detection and budgets precede model-backed triage.
7. Moderator and Operator templates precede Guardian auto-response.
8. Runtime Agent work never blocks a normal NexPress site when the feature is
   absent or disabled.
9. Each published behavior phase includes a package changeset, scaffold
   propagation, OpenAPI, live guide, and release acceptance.

`R1`–`R7` are the dependency chain for the in-product Agent Gateway/Runtime.
The Build plane is a separate acquisition track: `R8` may start in parallel
after `R0` contract lock and the current CLI/scaffold foundation. It is listed
last to keep the product narrative together, not because provider Runtime or
Guardian is a prerequisite.

## 2. Target package and ownership map

| Area                       | Primary owner/files                                                      | Must not own                      |
| -------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| Client-safe agent contract | `packages/core/src/agent-contract/`, core exports/tsup/package map       | DB/services, Admin UI             |
| Server agent domain        | `packages/core/src/agents/`                                              | Next route components, browser UI |
| System persistence         | `packages/core/src/db/schema/agents.ts`, app/reference migrations        | Generated collection schema       |
| Host/bootstrap             | `packages/next/src/`, framework-host bootstrap export                    | Core contract definitions         |
| HTTP and worker adapters   | `packages/app/src/api/`, scripts/handlers, thin `apps/web` wrappers      | Browser component implementation  |
| Agent Studio               | `packages/admin/src/agents/`, `packages/app/src/admin/protected/agents/` | Core server imports in browser    |
| MCP transport              | proposed `packages/mcp/` (`@nexpress/mcp`)                               | Capability policy/execution logic |
| Build-plane CLI/skill      | `packages/cli`, `packages/cli-nexpress`, scaffold templates              | Runtime production mutation       |
| Provider adapters          | connection facade/fake in R1; inference modules/packages selected in R5  | Secret persistence outside vault  |

High-conflict files include core schema barrels, root/core package exports,
OpenAPI generation, app Admin layout/nav, scaffold manifests, and package
manifests. Each PR names one owner for those files; downstream lanes hand back
requirements instead of editing them concurrently.

## 3. Release milestones

### R0 — Contract lock and threat review

Outcome: issue-ready contracts with no runtime behavior.

Implementation status (2026-08-26): the AP-000 client-safe canonical analyzer
gate now covers all 32 v1 purposes. The final bundled slice adds action,
connection config/destination/operation, event, signal evidence, notification
delivery, policy, and provider request/response bodies together with one
exhaustive purpose/body/analyzer/included/excluded/size dispatch. Runtime,
persistence, migrations, and the remaining threat-review/sign-off work stay
outside this contract-only milestone.

Implementation status (2026-08-27): AP-001 now exports and self-validates all
55 Agent Studio mutation rows from one client-safe
`NpAgentAdminOperationContractV1` registry. It reuses the existing exact JSON
Schema analyzer, `NpCapability`, capability effect-profile validator, API error
code/status inventory, plugin route-path validator, canonical JSON serializer,
SHA digest helper, and invocation-request body. Each row binds stable route and
schema names, body idempotency, row/config/plan preconditions, one-time and
write-only handling, effect verification/compensation, approval and
reauthentication floors, audit redaction, OpenAPI metadata, and error pairs.
The same closed id inventory now rejects unknown Admin operation ids in
`np.agent-idempotency-request.v1`; aggregate and per-operation golden
fingerprints make drift explicit. Routes, persistence, Admin UI, Doctor
runtime checks, provider calls, migrations, and package-version changes remain
outside this contract-only slice.

Work:

- `AP-000`: implement the normative
  [canonical-contracts.md](canonical-contracts.md) appendix: all 32
  canonical-purpose body interfaces/analyzers, explicit included/excluded
  field-membership fixtures, purpose/body/owning-field maps, size bounds, and
  independent golden vectors in the client-safe contract package; any
  divergence blocks every R1+ digest column and migration;
- `AP-001`: land the exhaustive Admin mutation operation map with stable
  operation ids, named input/output/error schemas, staff capability,
  idempotency, version/hash preconditions, one-time-secret behavior, effects,
  approval/reauthentication, redaction, OpenAPI, and fixtures before any Agent
  Studio mutation route is implemented;
- confirm every locked choice in this design set in client-safe contract
  fixtures;
- freeze `NpAgentScope`, risk/autonomy/state inventories, bounds, capability
  ids, error-code additions, Gateway transport/exposure inventories and
  descriptor/effect-profile projection rules, and JSON schema versions;
- freeze the built-in NexPress OAuth issuer/audience/site-consent profile for
  remote MCP and its dedicated signing-key contract;
- freeze the production custom-vault requirement, disabled default, and
  explicit local-envelope development fallback;
- produce data-flow and threat-model review with security sign-off;
- write migration and backward-compatibility notes;
- create the initial model-independent test fixtures.

Gate:

- all 32 canonical-purpose strings, exact appendix bodies, validators,
  field-membership fixtures, owners, and golden vectors are exhaustive and no
  implementation-local `NpAgent*CanonicalV1` substitute remains;
- all inventories round-trip through proposed analyzers;
- every proposed Admin mutation route has exactly one `AP-001` operation
  descriptor and no route-local contract;
- no document disagrees on names, states, scopes, or ownership;
- destructive/runtime schema changes are explicitly out of the first slice.

### R1 — Identity, persistence, vault, and diagnostics

Outcome: operators can configure/revoke inbound agent principals and provider
connections, but no model or capability is invoked.

Suggested work packages:

| ID     | Scope                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-101 | Add `agent-contract` limits, identities, scopes, budgets, connection, run/action, and common wire analyzers                                                                                   |
| AP-102 | Add principal, exposure-bound service-token/OAuth, connection, vault, Gateway settings, and shared Admin invocation/idempotency schema plus reviewed migration; update exports                |
| AP-103 | Add initial site deletion inventory/order and require every later agent-schema PR to extend its exact graph                                                                                   |
| AP-104 | Implement principal/service-token lifecycle through shared Admin invocation admission, transport/audience binding, and scope narrowing                                                        |
| AP-105 | Define vault adapter, explicit opt-in local-envelope development adapter, crash-safe operation journal/inspection, deterministic-CBOR envelope, rotation/revocation, and redaction            |
| AP-106 | Add connection/provider metadata, fake adapter, atomic one-time OAuth callback→code-seal/exchange journal, destination/account HMACs, rotation, disable/enable/revoke, and safe probe service |
| AP-107 | Add `agents.contract` Doctor and read-only Admin Health summary                                                                                                                               |
| AP-108 | Add Agent Studio Connections/Principals read/create/revoke minimum UI                                                                                                                         |
| AP-109 | Propagate disabled-by-default config and migration through scaffold                                                                                                                           |

AP-101 is implemented as a contract-only foundation in
`@nexpress/core/agent-contract`. Its closed seven-schema registry covers
Gateway settings, browser-safe principals, inheritable/concrete budgets,
redacted connections, the existing canonical run limits, safe run rows, and
redacted action activity. Sorted scopes, closed run/action states, a bounded
generic cursor page, per-body fingerprints, and one aggregate registry
fingerprint share the same context-free boundary. It deliberately adds no
schema, migration, route, Admin component, provider call, or package-version
change; AP-102 and later packages remain responsible for persistence and
runtime consumers.

AP-102 and AP-103 are implemented as the first server-side persistence gate.
Core now exports the closed initial Drizzle schema for principals,
exposure-bound service tokens and OAuth, connections and immutable config,
shared Admin/capability invocations, provider-auth operations, credential
versions, vault journals/local envelopes, and the durable site-deletion marker.
Migration `0032_lyrical_maverick.sql` installs the same-site constraints and
deferred lifecycle links. The exact 15-table ordinary-row inventory, sorted
`sdri1` digest input, marker exclusion, and dependency-safe delete order are
owned by one registry reused by legacy site deletion and integration cleanup.
Gateway site intent uses the existing `np_settings` row at `agents.gateway`,
is absent/disabled by default, and has no port field. This gate adds no routes,
Admin UI, provider calls, runtime worker, or package-version change; AP-104 and
later packages add behavior on these frozen contracts.

AP-104 is implemented as the first server-only service slice at
`@nexpress/core/agents`. One shared Admin admission path revalidates the live
staff session and site capability, enforces the operation registry's recent
staff-primary floor, binds exact request/authorization fingerprints, and
commits audit, idempotency evidence, and mutation together. External principal
create/update/suspend/resume/revoke and service-token create/rotate/revoke use
row-version compare-and-swap. Scope changes advance the independent principal
token version; service credentials capture it and fail immediately after
authority loss. Tokens use the exact `npst1` 256-bit opaque-verifier HMAC,
server-derived transport audiences, deployment∩site exposure ceilings,
bounded expiry/rotation overlap, and one-time output replay fencing. Safe
principal/token reads exclude verifiers and lineage. Migration
`0033_past_colonel_america.sql` backfills the new invalidation snapshot before
making it required. This slice still adds no HTTP/Admin UI, MCP listener,
OAuth/provider/vault call, runtime worker, or package-version change.

AP-105 is implemented as the server-only vault boundary at
`@nexpress/core/agents`. One closed adapter registry freezes id, contract
version, fingerprint, algorithm, and development intent; production and hosted
profiles reject the built-in local-envelope adapter. Deterministic RFC 8949
CBOR covers the five exact credential-envelope branches, while a separately
keyed, length-framed HMAC binds operation kind, adapter identity, AAD,
idempotency, and either plaintext bytes or locator/key metadata. Seal, open,
rewrap, destroy, and total inspection use bounded host deadlines and expiring,
single-use, zeroizing leases. The durable journal records intent before
adapter I/O, adopts receipts transactionally, inspects ambiguous results before
redispatch, and never reconstructs or replays lost seal plaintext. The explicit
development-only local adapter uses per-secret AES-256-GCM data keys with a
separately wrapped data key and exact row-version CAS. Migration
`0034_gigantic_caretaker.sql` permits a never-activated failed seal to end
revoked or destroyed without a locator or account subject. Safe operation
projections exclude locators, request/result digests, AAD, and credentials.
This slice adds no HTTP/Admin UI, provider integration, runtime worker,
scaffold/config propagation, or package-version change.

AP-106 is implemented as the server-only provider-connection lifecycle at
`@nexpress/core/agents`. A hardened registry freezes provider adapter identity,
contract fingerprint, permissions, schemas, origins, configuration parsing,
and destination derivation; repeated host evaluation rejects nondeterministic
metadata. Exact canonical config and effective pricing snapshots stay
credential-free, while separately keyed HMAC projections bind raw provider
subjects and destinations to one site and connection context. The bundled fake
adapter exercises API-key and OAuth flows without external network access.
API-key activation and rotation admit their durable operation in the shared
Admin transaction before Vault sealing and provider I/O; a failed replacement
never displaces the known-good credential. Raw Admin credentials become a
separately keyed request HMAC before invocation/audit persistence, and only
the worker executes probe, exchange, or refresh adapter calls. Safe probe, disable/enable/revoke,
and candidate-config activation use exact config/credential compare-and-swap.
OAuth uses bounded S256 PKCE, keyed single-use state, exact redirect and origin
checks, an atomic callback-consumption/code-seal/exchange journal, expiring
temporary leases, refresh-generation fencing, and no blind replay after an
ambiguous provider result. Browser-safe projections exclude credentials,
Vault locators, raw account subjects, and keyed digests. This slice adds no
HTTP/Admin UI, scheduled runtime worker, scaffold/config propagation,
migration, or package-version change.

AP-107 is implemented as one aggregate `agents.contract` diagnostics boundary
shared by Doctor and the existing read-only Admin Health surface. A strict
client-safe `np.agent-health-summary.v1` projection exposes only stable issue
codes, state counts, oldest age by state, and provider/Vault adapter readiness
counts. The server collector verifies the exact 16-table R1 inventory and
critical constraints, same-site references, active config/secret pointers,
OAuth callback evidence, connection and Vault journals, local-envelope
bindings, expiry backlog, stranded operations, and deletion-saga consistency.
Missing schemas and hostile query failures collapse to one opaque
`AGENT_SCHEMA_UNAVAILABLE` issue; row ids, sites, adapter identities,
fingerprints, locators, keyed digests, canonical inputs, results, and
credentials never cross the aggregate boundary. The disabled empty state is
healthy, while frozen adapters that cannot be confirmed are reported as
unknown rather than invented. Unit, hostile-value, multi-site, redaction, and
PostgreSQL fixtures share the same collector. This slice adds no Agent Studio
mutation UI, provider call, runtime worker, scaffold/config propagation,
migration, or package-version change.

AP-108 is implemented as the first Agent Studio control plane across the
client-safe `@nexpress/core/agent-contract`, host-injected server runtime,
shared application routes, and Admin surfaces. One strict overview projects
only installed adapter metadata, disabled-by-default Gateway settings,
redacted connections, principals, and stable runtime issue codes. Connection
definitions are canonicalized and digested in the browser, while API-key
plaintext remains write-only, is replaced by the existing keyed request HMAC
before invocation persistence, and is zeroized around the existing Vault
admission. Connection create/revoke and Gateway principal/service-token
lifecycle reuse the AP-001 shared staff-session, site-capability,
reauthentication, audit, and idempotency boundary. Service-token plaintext is
shown once from a `no-store` response; detail and list projections never
recover it. The Admin UI keeps outbound provider connections distinct from
inbound Gateway authority, explains that no dedicated MCP port is introduced,
and fails closed when the host has not installed either runtime. OAuth
connections may be created in the existing pending state, but this minimum UI
does not add a second OAuth start/callback contract around the AP-106 server
lifecycle. The scaffold snapshot mirrors the same thin page and route wrappers,
but this slice adds no provider call, scheduled worker, disabled-by-default
runtime configuration/default propagation, migration, or package-version
change.

AP-109 completes the disabled-by-default project and scaffold foundation.
`NpConfig.agents.gateway` reuses the exact client-safe Gateway settings
contract as a non-secret deployment ceiling; absence and the exported
`npAgentDisabledProjectConfigV1` both resolve to all transports disabled, while
unknown port, host, relay, token, Vault, and provider fields fail closed. Vault
selection and credentials remain in the existing server-only host seams, and
the host still has to inject the AP-108 runtime explicitly rather than receiving
invented keys or adapters. The reference app and fresh scaffold declare the
same reusable disabled constant. A shared migration generator first delegates
to Drizzle, then adds one reviewed custom migration only when all 16 R1 tables
exist and all nine circular lifecycle foreign keys are absent; partial
inventories fail closed, complete chains are idempotent, and existing migration
SQL is never rewritten. The reference 0032–0034 chain is already complete and
therefore gains no new migration. Packed-scaffold CI now generates and applies
the database to PostgreSQL, proves the exact empty table inventory, nine
`NO ACTION DEFERRABLE INITIALLY DEFERRED` links, absent Agent settings/rows, and
healthy `not-required` diagnostics. This slice adds no seed, provider call,
worker, machine route, dedicated MCP port, automatic runtime factory, or
package-version change.

Gate:

- a site with no agent settings behaves byte-for-byte/API-equivalently where
  existing tests cover it;
- no secret is returned by list/detail, logs, errors, audit, Doctor, or export;
- multi-site and deletion tests pass;
- malformed persisted rows fail closed.

### R2 — Capability registry and read-only Agent Gateway

Outcome: internal code, local stdio MCP, and explicitly enabled same-origin
remote MCP call the same read-only capabilities without opening a dedicated
MCP port.

| ID     | Scope                                                                                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-201 | Implement capability registry/definition validation and derived required scopes                                                                                                                                                                            |
| AP-202 | Add `site.inspect`, `schema.get`, and `content.query` with exact bounded results                                                                                                                                                                           |
| AP-203 | Extend shared invocation admission to capabilities; migrate the generalized `origin=gateway` task/run and action rows, audit correlation, and usage counters without provider calls                                                                        |
| AP-204 | Implement port-free local stdio MCP with exposure-bound service-token/environment credential                                                                                                                                                               |
| AP-205 | Implement optional same-origin remote Streamable HTTP MCP plus the built-in OAuth 2.1 Authorization Server, exposure-bound durable one-time consent requests, signing/JWKS, rotation, and resource-server validation; disabled means route/discovery `404` |
| AP-206 | Project bounded resources, prompts, and tools through the exact deployment/site/credential/scope/policy intersection; add negotiated MCP tasks/results/caps/TTL reconciliation, annotations, and protocol errors                                           |
| AP-207 | Add official Codex/Claude-compatible skill/instructions and connection command                                                                                                                                                                             |
| AP-208 | Enforce the closed core capability inventory and diagnose/reject plugin-defined Agent Gateway capability ids in v1                                                                                                                                         |
| AP-209 | Add Admin Activity views for principals, runs, actions, and revocation                                                                                                                                                                                     |
| AP-210 | Add the four machine Agent HTTP routes, full-origin `agent-http` audience-bound authentication, shared invocation/artifact facades, OpenAPI projection, and thin scaffold wrappers                                                                         |

Through R4, capability policy evaluation uses the immutable framework hard
rules plus the exact disabled-by-default deployment/site feature settings.
There is no mutable Runtime Agent policy row to configure yet. R5 adds
versioned site/agent policies as an additional narrowing layer; it cannot
widen a capability that the earlier hard rules, principal grant, resource
authorization, or human approval deny.

Gate:

- read-only calls never create content/revisions/settings/navigation/media refs;
- service token, OAuth audience, issuer, site, and scope negative tests pass;
- one tenant cannot infer another tenant's resources or counts;
- maximum-profile fixtures preserve every currently shipped master-inventory
  tool while lower profiles expose only their exact subsets;
- no generated or runtime configuration starts a dedicated MCP listener;
- protocol conformance and tool-schema snapshots pass;
- no raw OpenAPI operation is automatically exposed as a tool.

### R3 — ChangeSet proposal, validation, and preview

Outcome: agents can prepare production-realistic plans but cannot apply them.

| ID     | Scope                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-301 | Add ChangeSet/operation/approval client-safe contracts and persistence, including retained discriminated sealed plan bodies, frozen rollback duration, and exact before-snapshot `snapshot_hash`                                                                                                                                                      |
| AP-302 | Implement draft/idempotency/resource canonicalization                                                                                                                                                                                                                                                                                                 |
| AP-303 | Refactor required content/navigation/settings/theme/media services for transaction-aware callers                                                                                                                                                                                                                                                      |
| AP-304 | Implement base fingerprint, conflict detection, exact validation, and deterministic risk                                                                                                                                                                                                                                                              |
| AP-305 | Implement preview async-local overlay and side-effect-free hook intent                                                                                                                                                                                                                                                                                |
| AP-306 | Add dedicated cross-site preview origin with one-time launch exchange/per-preview cookie, exact render ticket/session binding, route/audience bounds, atomic full-set artifact reservation, terminal adapter-operation inspection/fencing, row-first upload journal/private deletion facade, multipart report/header contracts, and screenshot option |
| AP-307 | Add link/SEO/accessibility checks and structured validation evidence                                                                                                                                                                                                                                                                                  |
| AP-308 | Add ChangeSet list/detail/diff/preview Admin views                                                                                                                                                                                                                                                                                                    |
| AP-309 | Expose `changeset.create/get/list/validate/preview` through MCP/API at the `propose` profile without widening existing grants                                                                                                                                                                                                                         |

Gate:

- preview causes zero persistent content/settings/revision/cache/side-effect
  mutations;
- conflicts and malformed plans fail before any mutation;
- ChangeSet diff and preview are produced from the same sealed hash;
- hostile generated text cannot alter Admin controls or approval facts.

### R4 — Approval, apply, verification, and rollback

Outcome: an authorized caller can complete a safe, reversible content operation
through the full control loop.

| ID     | Scope                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-401 | Implement the exact request/decision approval services and routes, keyed statement/decision integrity MACs and rotation-safe keyring, state/expiry, plan/hash/capability binding, reauthentication hook, and normal audit |
| AP-402 | Implement transaction-scoped ChangeSet apply and per-site serialization                                                                                                                                                   |
| AP-403 | Implement exact cancel plus apply/schedule/verify jobs, execution reservations, and crash recovery                                                                                                                        |
| AP-404 | Implement post-commit cache/search/media/hook convergence evidence                                                                                                                                                        |
| AP-405 | Implement forward-compensation rollback with current-state conflict checks                                                                                                                                                |
| AP-406 | Add schedule/apply/rollback capabilities and long-running MCP task projection at `approved-execute`; exposure never substitutes for the required approval                                                                 |
| AP-407 | Add request-approval/cancel, approval queue, execution timeline, verification, and rollback Admin flows                                                                                                                   |
| AP-408 | Extend Doctor/Health/runbook and release checks for stuck/failed ChangeSets                                                                                                                                               |

Gate:

- all acceptance scenarios in
  [changesets-and-approvals.md](changesets-and-approvals.md) pass;
- no approval can be replayed or applied to a changed hash;
- DB mutations, revisions, audit, approval consumption, and state commit
  atomically;
- rollback never overwrites later work;
- remote mutations remain unavailable unless deployment, site, and immutable
  credential/grant ceilings all admit `approved-execute`; every underlying
  capability approval remains independently required.

### R5 — Durable provider-backed Agent Runtime

Outcome: one configured agent can run a bounded event/manual/scheduled workflow
with budget and policy enforcement.

| ID     | Scope                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AP-500 | Add agent/version/policy/trigger/provider-call/usage-reservation/breaker/event schema; extend the R2 generalized run table with exact `runtime` fields, checks, and same-site foreign keys |
| AP-501 | Extend the provider adapter to inference, add one reference provider, structured-output validation, and timeout/cancel                                                                     |
| AP-502 | Add active policy resolution with hard rules separated from instructions                                                                                                                   |
| AP-503 | Add exact event envelope, trigger registration/coalescing, and run jobs                                                                                                                    |
| AP-504 | Add site/agent budgets, admission locking, usage/cost accounting, emergency pause, and local `nexpress agent runtime status/pause/resume` recovery contract                                |
| AP-505 | Add run state machine, bounded context builder, redaction, and action planner                                                                                                              |
| AP-506 | Add retry/circuit breaker/provider-unavailable behavior and fallback policy                                                                                                                |
| AP-507 | Complete Agent Studio Agents/Triggers/Policies/Budgets/Run detail, per-Agent pause/resume, and bounded manual-run admission                                                                |
| AP-508 | Add Agent Runtime readiness/health/ops evidence and retention jobs                                                                                                                         |

Gate:

- no provider call occurs before deterministic admission, redaction, policy,
  and budget checks;
- provider output cannot create an unvalidated capability/action;
- duplicate events coalesce and duplicate jobs remain idempotent;
- model/provider outage leaves normal CMS requests available;
- denial-of-wallet tests trip bounded admission/circuit breakers.

### R6 — Moderator, Operator, and Publisher recipes

Outcome: the platform demonstrates useful unattended work before security
auto-response.

| ID     | Scope                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-600 | Add shared signal (including exact `evidence_digest`), incident, timeline, notification, and moderation-feedback schema plus migration; implement bounded `incident.get/list` services/capabilities           |
| AP-601 | Moderator signal collectors, deterministic scoring, quarantine/restore capability, and feedback labels                                                                                                        |
| AP-602 | Operator jobs/storage/backup/plugin/readiness collectors, `audit.run`, `ops.status/plan`, and the three-action `ops.execute` subset (`cache.revalidate`, linked Agent-run retry, pre-commit Agent-run cancel) |
| AP-603 | Publisher stale-content/SEO/internal-link recipe through ChangeSets                                                                                                                                           |
| AP-604 | Notification delivery service/adapter for Admin plus optional email/Slack integration                                                                                                                         |
| AP-605 | Template-specific Agent Studio setup, recommended scopes, policies, and budgets                                                                                                                               |
| AP-606 | Curated evaluation datasets, operator review tooling, and recipe runbooks                                                                                                                                     |

Gate:

- moderation auto-action is quarantine, never delete;
- Operator model has no direct shell/SQL and cannot bypass `ops.execute`
  approval;
- Publisher defaults to draft/preview;
- false-positive and usefulness thresholds in the evaluation doc are met on
  versioned fixtures.

### R7 — Guardian and application security orchestration

Outcome: application signals are correlated into incidents, with narrowly
reversible responses.

| ID     | Scope                                                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-701 | Extend shared signal/incident contracts with PII-minimized security subjects and actor-restriction persistence, including exact `restriction_hash` |
| AP-702 | Auth, rate-limit, audit, content-integrity, jobs, and health collectors                                                                            |
| AP-703 | Incident fingerprint/coalescing, severity, deterministic rules, and model-assisted summary                                                         |
| AP-704 | Temporary actor-limit and exact session-revocation capabilities                                                                                    |
| AP-705 | WAF/Sentry-style external signal adapter boundary and one reference integration                                                                    |
| AP-706 | Incident list/detail/timeline/action/notification Admin UX                                                                                         |
| AP-707 | Security retention, evidence export, runbooks, Doctor, and recovery                                                                                |
| AP-708 | Adversarial prompt-injection, approval-forging, exfiltration, tenant, and cost test gate                                                           |

Gate:

- Guardian is documented as complementary to WAF/IDS/SIEM;
- untrusted evidence is never instruction or approval UI;
- unattended responses are TTL-bound and reversible;
- permanent bans, broad network blocks, plugin changes, migrations, restore,
  secret rotation, and arbitrary code remain prohibited/approval gated;
- security review approves the threat/test matrix.

### R8 — Build-plane prompt-to-site

Outcome: a coding agent can create a normal owned NexPress repository from a
brief while following existing codegen/migration/release contracts.

The artifact and workflow contract is
[build-agent-and-site-blueprint.md](build-agent-and-site-blueprint.md).

| ID     | Scope                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| AP-801 | Versioned Site Brief and Site Blueprint schemas                                                                    |
| AP-802 | CLI/skill workflow for brief, IA, collection, theme-token, pattern, and seed proposals                             |
| AP-803 | Agent-authored three-direction DraftSet plus trusted deterministic render/seal and independent rerender validation |
| AP-804 | Repository edits, schema generation, migration-plan review, tests, and local preview loop                          |
| AP-805 | Git/PR/deploy-plan handoff with generated artifacts and ownership notes                                            |
| AP-806 | Hosted/ephemeral Launchpad evaluation only after local workflow is stable                                          |

Gate:

- output is a normal NexPress project with no opaque hosted dependency;
- generated collection changes include reviewed schema/migration evidence;
- no Build Agent credential is copied into runtime settings or source;
- `pnpm verify` and packed-scaffold acceptance pass.

## 4. Deployment and migration strategy

The first schema deployment uses a dark launch:

1. release code that understands the new exact settings and tables but treats
   missing `agents.gateway` and `agents.runtime` settings as fully disabled;
2. ship reviewed migrations and update scaffold/reference migrations;
3. run migration status/plan, verified backup, apply, Doctor, and readiness;
4. verify no agent jobs, endpoints, schedules, or provider calls are active;
5. enable read-only Agent Studio/Gateway for one test site;
6. enable ChangeSet writes for one exact site/principal;
7. enable Runtime Agent admission only after budgets and emergency pause are
   tested;
8. expand per site with audit/usage observation.

Rollback before runtime enablement is ordinary application rollback with unused
tables retained. After agent rows exist, package rollback must remain
read-compatible with the newest rows or be accompanied by a reviewed
forward-fix migration; never delete agent history to downgrade.

## 5. Configuration defaults

- Agent Runtime: disabled when setting is absent.
- Agent Gateway transport ceilings: absent means all `disabled`; a site and
  credential/grant may only narrow deployment `read`, `propose`, or
  `approved-execute` ceilings.
- Remote MCP: no dedicated port and `404` until explicit deployment/site intent
  plus built-in OAuth origin, signing key/JWKS, consent, and audience
  configuration are valid.
- Local stdio MCP: opt-in port-free command; newly issued credentials default
  to `read`, while an explicit maximum profile preserves the full tool set.
- Provider calls: impossible without a ready connection and budget.
- Agent triggers: disabled on creation until explicitly activated.
- Agent autonomy: `observe`.
- ChangeSet public writes: human approval.
- Moderator automatic action: disabled until site policy enables reversible
  quarantine.
- Guardian automatic action: disabled until site policy enables one bounded
  TTL action.
- Arbitrary network fetch, shell, SQL, package install, schema migration,
  restore, secret display, and scope escalation: unavailable.

## 6. Documentation transition

While work is pending, this directory remains a design snapshot. As phases
ship:

- create focused live guides such as `docs/agents.md`,
  `docs/agent-changesets.md`, `docs/mcp.md`, and `docs/guardian.md`;
- update `docs/agent-integration.md` and `docs/agent-operated-ops.md` rather than
  leaving conflicting auth/ops instructions;
- update the root `AGENTS.md` only for genuinely current architecture/package
  boundaries;
- mark implemented sections here with PR/commit references without pretending
  unimplemented later phases are live;
- add changesets for all affected published packages.

## 7. Definition of done for every work package

- exact contract and negative tests;
- site authorization, principal scope, policy, quota, and idempotency where
  relevant;
- safe errors with no secret/PII leakage;
- unit plus required Postgres integration coverage;
- malformed persisted state Doctor coverage;
- Admin/CLI/API/MCP/OpenAPI parity for the surfaces in scope;
- multi-site deletion and transfer exclusion;
- scaffold propagation and packed-scaffold verification;
- observability and operator recovery;
- format, targeted lint/typecheck/test, then `pnpm verify` for schema,
  migration, cross-package, or release-sensitive changes;
- package changeset and live documentation.

## 8. Product release boundary

The first credible public release should include R1–R4 plus:

- one official external-agent connection path;
- one Provider-free deterministic demo;
- one model-backed Publisher or Moderator demo from R5/R6;
- Agent Studio activity and approvals;
- complete safety/evaluation evidence.

Guardian may be preview/beta until R7 adversarial and false-positive gates are
met. Prompt-to-site is a separate acquisition track and should not delay the
safe runtime foundation.
