# NexPress Agentic Platform — product requirements

> Status: implementation design. Nothing in this document is a claim of
> shipped behavior.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
> Parent decisions: [Agentic Platform implementation design](README.md).
> Intended release line: post-`0.4.x`, delivered behind explicit feature
> gates in independently releasable phases.

This document defines the product outcome, users, journeys, requirements, and
release acceptance for the NexPress Agentic Platform. Architecture and wire
details live in the sibling design documents. If this document conflicts with
the locked decisions in the parent README, the parent README wins.

## 1. Product thesis

NexPress should not compete only on how quickly a model can draw a first
website. Site generation is becoming a commodity; operating the result safely
for months or years is the harder, less-served problem.

The product position is:

> **NexPress is the open-source CMS built for AI-operated sites. Connect the AI
> you choose; NexPress gives it exact, site-scoped, approval-aware, reversible
> operating contracts while the application and data remain yours.**

The product has two distinct planes:

- the **Build plane**, where an AI coding agent changes an ordinary NexPress
  repository and goes through Git, schema generation, migrations, tests,
  preview, and deployment; and
- the **Operate plane**, where an external client or the server-side Agent
  Runtime can use only registered capabilities exposed by a running site.

Neither plane is a privileged model shell. The Build plane is governed by the
repository and delivery pipeline. The Operate plane is governed by site
authorization, agent scopes, deterministic policy, quotas, audit, approval,
and rollback.

## 2. Problem statement

Current site-building agents can produce an attractive first version quickly,
but a production site still needs recurring human attention:

- stale content must be found, edited, previewed, scheduled, and checked after
  publication;
- community spam and abuse arrive continuously and require consistent,
  explainable moderation;
- jobs, storage, backups, plugins, and releases produce operational evidence
  that is spread across tools;
- application-level attack signals need correlation without exposing a model
  to unlimited raw logs or unrestricted response tools;
- model-provider credentials and site credentials have different trust
  relationships but are often handled as if they were interchangeable; and
- a general-purpose agent can call low-level APIs, but cannot reliably know
  which actions need a plan, approval, idempotency key, verification, or
  rollback.

NexPress already has exact collection and discovery schemas, versioned
documents, durable jobs, deterministic operations reports, and plan/apply
contracts. The product opportunity is to compose those foundations into a
safe operating layer, rather than adding an unbounded chat box over existing
HTTP endpoints.

## 3. Goals

| ID            | Goal                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-GOAL-001` | Let a site owner connect a supported model provider or external agent without sharing provider credentials with the Agent Gateway or sharing NexPress credentials with a provider. |
| `PR-GOAL-002` | Give internal and external agents one bounded, exact, site-scoped capability surface.                                                                                              |
| `PR-GOAL-003` | Make an Agent ChangeSet the normal path for cross-resource content and presentation writes, including validation, preview, approval, apply, verification, and rollback evidence.   |
| `PR-GOAL-004` | Support event-driven, durable Publisher, Moderator, Operator, and Guardian workflows without keeping a model process alive per site.                                               |
| `PR-GOAL-005` | Let operators choose and understand each agent's model, scopes, triggers, policy, autonomy, budget, and current state.                                                             |
| `PR-GOAL-006` | Permit unattended actions only when server policy explicitly allows a bounded, reversible action.                                                                                  |
| `PR-GOAL-007` | Make every material decision and action attributable, inspectable, retry-safe where applicable, and visible in Admin.                                                              |
| `PR-GOAL-008` | Preserve NexPress's self-hosted ownership model: generated source, site data, provider choice, and deployment remain under the operator's control.                                 |
| `PR-GOAL-009` | Provide a prompt-to-repository Build Agent path that accelerates first value without creating a proprietary runtime format.                                                        |

## 4. Non-goals

| ID               | Non-goal                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-NONGOAL-001` | Building a general autonomous computer-use agent, unrestricted shell, arbitrary SQL console, or general web browser inside production.                                                                   |
| `PR-NONGOAL-002` | Replacing Git review, schema generation, migration review, CI, deployment controls, or infrastructure access in the Build plane.                                                                         |
| `PR-NONGOAL-003` | Replacing a WAF, IDS/IPS, malware scanner, endpoint protection product, SIEM, backup system, or incident-response team. Guardian correlates application-level signals and coordinates bounded responses. |
| `PR-NONGOAL-004` | Mapping every OpenAPI operation to an MCP tool. The tool set remains small and purpose-oriented.                                                                                                         |
| `PR-NONGOAL-005` | Guaranteeing that model classification is correct or that all spam, abuse, vulnerabilities, or attacks will be detected.                                                                                 |
| `PR-NONGOAL-006` | Providing a free-form visual canvas equivalent to a dedicated design product in the first Build Agent release.                                                                                           |
| `PR-NONGOAL-007` | Reselling consumer AI subscriptions or assuming that a consumer chat-product OAuth grant authorizes model API use.                                                                                       |
| `PR-NONGOAL-008` | Training shared models on customer content, logs, prompts, or operator feedback.                                                                                                                         |
| `PR-NONGOAL-009` | Letting a runtime agent install plugins, change schema, run migrations, restore production, reveal credentials, grant itself scopes, or delete audit evidence.                                           |

## 5. Product principles

1. **Contracts before prompts.** Exact schemas, bounded evidence, stable IDs,
   and deterministic policy are product behavior; a prompt is an
   implementation detail.
2. **Safe defaults are visible defaults.** New agents start paused or in
   Observe mode, no provider connection silently becomes active, and no
   reversible-action exception is hidden from the operator.
3. **Human capability and agent scope stay separate.** A staff member approves
   with the existing `NpCapability` authorization contract. An agent calls
   with the separate `NpAgentScope` inventory. One never implies the other.
4. **Reasoning does not authorize.** A model may classify, summarize, and
   propose. NexPress code validates, evaluates policy, authorizes, executes,
   and verifies.
5. **Evidence is data, not instruction.** Comments, documents, plugin output,
   remote pages, request metadata, and logs remain bounded untrusted evidence.
6. **Reversibility earns autonomy.** Unattended writes are allowed only when a
   site policy permits them and the capability declares and implements a
   tested reversal or expiry.
7. **Always-on is event-driven.** Framework events and schedules enqueue
   bounded durable work. Models are called only when policy or an operator
   requests judgment.
8. **The operator can always answer what happened.** Agent identity, model
   connection alias, policy version, capability, inputs digest, outcome,
   approval, cost, and reversal state are inspectable without exposing
   secrets or hidden chain-of-thought.

## 6. Personas

| Persona                  | Context                                                                                                 | Primary need                                                                                                              | Principal risk                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Owner-operator**       | Runs a small or medium self-hosted site without a dedicated operations team.                            | Connect a preferred provider, choose safe defaults, and know the site is being watched.                                   | An agent spends unexpectedly, publishes the wrong content, or changes production outside the intended site. |
| **Content lead**         | Owns editorial quality, SEO, campaigns, localization, and publishing cadence.                           | Ask for coherent multi-document changes, compare a preview, approve once, and verify publication.                         | A stale proposal overwrites a human edit or mixes draft and public content incorrectly.                     |
| **Community moderator**  | Reviews reports, spam, abusive behavior, and account patterns.                                          | Remove high-confidence spam quickly while retaining an explainable review and restore path.                               | False positives silence legitimate members or untrusted text manipulates the model.                         |
| **Platform operator**    | Maintains deployment, jobs, storage, backups, plugins, and release readiness.                           | Turn exact health evidence into a safe response plan and execute only approved runbook actions.                           | A model improvises a destructive command, repeats a mutation, or hides incomplete recovery.                 |
| **Security owner**       | Owns application security and incident response, sometimes as the same person as the platform operator. | Correlate authentication, authorization, content-change, WAF, and error signals into incidents and temporary containment. | Guardian is mistaken for a security boundary, leaks sensitive logs, or blocks real users without an expiry. |
| **NexPress implementer** | Developer or agency creating a site and its deployment pipeline.                                        | Generate a conventional repository, inspect every change, and hand off an operable site.                                  | Runtime shortcuts bypass source control or generated code and create an unreproducible deployment.          |
| **External-agent user**  | Uses Codex, Claude, or another MCP-capable client for an interactive task.                              | Authorize only the needed site and capabilities, complete the task, and revoke access.                                    | Broad, long-lived credentials or an MCP client confusing public discovery with mutation authority.          |

## 7. Jobs to be done

| ID           | Situation and job                                                                                                                                                       | Desired outcome                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PR-JOB-001` | When I start a new project, help me turn a brief into a normal NexPress repository with collections, theme tokens, page patterns, sample content, tests, and a preview. | I retain a reviewable codebase and can use the normal NexPress delivery workflow.                               |
| `PR-JOB-002` | When I want an external agent to help with one site, let me authorize a narrow set of agent capabilities for a limited period.                                          | The agent can finish the requested task without a staff password or unrelated site access.                      |
| `PR-JOB-003` | When several related content and presentation changes are needed, assemble them into one reviewable proposal.                                                           | I can see exact diffs, checks, previews, risks, and rollback readiness before approving.                        |
| `PR-JOB-004` | When content becomes stale or underperforms, find candidates and prepare improvements on a schedule.                                                                    | Useful drafts arrive on schedule; publication always waits for human approval in v1.                            |
| `PR-JOB-005` | When suspicious community content appears, distinguish high-confidence spam from uncertain cases.                                                                       | Reversible spam quarantine is fast; uncertain cases remain in a human queue with evidence.                      |
| `PR-JOB-006` | When a worker, backup, storage adapter, or plugin becomes unhealthy, correlate deterministic checks and prepare the applicable runbook plan.                            | I receive an evidence-backed plan instead of speculative shell commands.                                        |
| `PR-JOB-007` | When authentication or authorization signals look abnormal, group related evidence into one incident and contain only what policy permits.                              | I can investigate a bounded timeline, restore temporary actions, and escalate to infrastructure security tools. |
| `PR-JOB-008` | When an agent acts or is blocked, show me the exact policy and server facts responsible.                                                                                | I can audit, explain, retry, revoke, or improve the policy without reading model chain-of-thought.              |
| `PR-JOB-009` | When provider usage grows, enforce the budget before a runaway loop can spend beyond the configured hard limit.                                                         | Cost remains bounded even under retries, spam floods, or provider failures.                                     |

## 8. End-to-end journeys

### 8.1 Build Agent journey

**Trigger:** an implementer supplies a product brief to an AI coding agent in a
new or existing NexPress repository.

1. The Build Agent inspects repository instructions, package versions,
   collection and block discovery where a live preview exists, and the current
   Git state.
2. It writes a versioned site brief and an exact three-direction DraftSet over
   the same information architecture, sample content, discovery catalog,
   projection inputs, and desktop/mobile viewports. The trusted deterministic
   CLI renderer validates that draft, creates the six comparison montages, and
   seals the canonical direction set.
3. The user selects exactly one member id/hash from that sealed set. Combining or editing
   directions creates a new complete set/hash; it never mutates the reviewed
   set in place.
4. The CLI independently rerenders and byte-compares the sealed previews while
   validating the canonical brief, direction set, selected digests, and
   blueprint. The agent then changes source files—never generated schema output
   by hand.
5. Collection changes run schema generation and create a migration for human
   review. Package changes receive the required changeset.
6. The agent runs the scoped build, typecheck, tests, and visual preview
   required by the repository.
7. It hands off the canonical brief, complete direction set, selected
   id/hash, blueprint, Git diff, migration impact, verification, and unresolved
   risks. A human or CI pipeline decides whether to merge and deploy.
8. After deployment, an operator explicitly configures provider and Agent
   Gateway connections; repository access never becomes runtime authority.

**Failure behavior:** the repository remains in a normal reviewable Git state.
The agent does not apply a production migration, bypass CI, or use a runtime
agent credential to finish build work.

### 8.2 External agent authorization journey

**Trigger:** a user asks an MCP-capable client to work on one existing site.

1. The pre-registered client starts NexPress Authorization Code + PKCE for the
   exact `/api/mcp` resource, site, redirect URI, requested scopes, and
   requested exposure mode.
2. NexPress authenticates the staff browser, shows
   client/site/scope/exposure/expiry facts, and lets an authorized operator
   narrow or deny the request.
3. Consent creates the site-scoped principal/grant and one-time code; the
   client exchanges it for short-lived NexPress tokens. No staff cookie,
   provider key, or upstream identity token is passed through.
4. The client discovers the fixed capabilities and performs only calls allowed
   by the intersection of grant, current principal scopes, target access,
   policy, budgets, and approval floors.
5. A write proposal returns a ChangeSet or `approval_required`. The user
   decides through Agent Studio; the MCP client cannot approve.
6. The user revokes the grant/principal after the task. Refresh and bearer
   replay fail on the next authoritative check, and bounded activity remains
   auditable.

Unattended CI/local automation uses a separately created, expiring,
transport/audience-bound service credential and the same capability checks. It
does not emulate interactive OAuth or reuse an MCP credential as a provider
secret.

### 8.3 Provider and runtime onboarding journey

**Trigger:** an owner wants NexPress to run a site Agent on events or a
schedule.

1. The owner explicitly enables a production-capable vault adapter (or the
   labelled local development adapter) and adds a provider connection using a
   write-only API credential or the provider adapter's supported OAuth flow.
2. NexPress seals the credential, runs one bounded server-side probe, and
   exposes only safe provider/model/account metadata. Failure leaves the
   connection non-ready without returning provider bodies or secret material.
3. The owner creates an Agent configuration from a role template, chooses the
   exact provider/model, scopes, triggers, autonomy modes, resource bounds,
   policy, and site/Agent budgets, then reviews the effective server result.
4. Activation validates worker, vault, provider, policy, scopes, budget
   measurement, and emergency controls. No run is admitted before every
   dependency is ready.
5. Events/schedules enqueue bounded site-stamped jobs; there is no permanently
   running model process. The owner monitors runs, cost, approvals, incidents,
   and breakers in Agent Studio.
6. Pause immediately blocks new provider calls/automatic mutation. Disable,
   rotate, revoke, or resume follows the exact dependency and audit lifecycle;
   normal CMS traffic remains independent.

Phase 1 ships only the connection/principal foundation. Configured Runtime
Agents and this full activation journey arrive in Product Phase 3/R5; the UI
must not display unshipped controls as functional.

### 8.4 Content operations journey

**Trigger:** a content lead requests an improvement, or a scheduled Publisher
policy selects stale content.

1. `content.query` retrieves only documents allowed by the agent scope and
   site context.
2. The Publisher receives a bounded, schema-derived representation and
   produces proposed edits.
3. `changeset.create` records a versioned draft proposal containing every
   affected document, navigation entry, theme value, media reference, and
   schedule; successful validation seals one immutable plan generation.
4. NexPress validates live schema, authorization, references, current version
   preconditions, links, SEO rules, accessibility rules, quotas, and policy.
5. The preview renderer produces a time-limited preview and bounded desktop
   and mobile artifacts. The server produces the structural and field diffs.
6. Proposal, validation, and preview may proceed without approval when scope
   and policy allow them. Every v1 ChangeSet schedule, apply, or rollback
   execution creates and consumes a fresh hash-bound human approval; rollback
   preparation may run without approval but cannot mutate state. Publisher
   policy cannot auto-publish or directly write a content draft outside the
   ChangeSet.
7. Apply rechecks the proposal hash and live preconditions, writes
   transactionally where supported, records revisions, invalidates caches, and
   schedules publication.
8. Verification fetches the resulting state and public rendering when
   applicable. Failure remains visibly failed, opens or links an incident when
   the deterministic incident policy requires it, and offers the declared
   rollback; it does not report success early.

**Conflict behavior:** if a human or another run has changed a target, apply
stops with a stale/conflict result. It never silently rebases model output.

### 8.5 Moderation journey

**Trigger:** a comment, post, report, account, or activity window matches a
deterministic moderation rule.

1. A lightweight rule or statistical detector creates a bounded moderation
   signal and deduplicates it into an existing incident when applicable.
2. A model is called only if policy requires semantic classification. Public
   text is labeled untrusted evidence and the model has no write capability.
3. The classifier returns an exact category, confidence, reason code, and
   evidence references. Invalid output fails closed into human review.
4. Policy compares the classification with site thresholds, account history,
   detector agreement, budget, and action limits.
5. High-confidence spam may use a direct `moderation.quarantine` capability
   only when configured. Quarantine preserves content and has a restore path.
6. Ambiguous or sensitive cases create an approval task for a user with
   `community.moderate`; deletion and permanent bans are never inferred from a
   model score alone.
7. The moderator can confirm, restore, dismiss, or escalate. Feedback records
   the disposition for evaluation, not for uncontrolled online model training.

**Flood behavior:** deduplication, rate limits, batch classification, and a
circuit breaker cap provider calls. Content volume cannot create unbounded
model spend.

### 8.6 Operations journey

**Trigger:** a schedule, a health event, or an operator requests an audit.

1. The Operator reads deterministic `np.ops.v1`, doctor, jobs, storage,
   backup, plugin, readiness, and runbook evidence.
2. It correlates checks by stable IDs and may summarize likely impact. It does
   not reinterpret a failed check as passing.
3. For a mutation, `ops.plan` creates or imports the same task-specific plan
   artifact used by the shipped CLI contract.
4. NexPress displays the exact command/action allowlist entry, plan ID,
   evidence, preconditions, expected mutation, required staff capability, and
   the effective Gateway exposure mode and whether it admits remote mutation.
5. A permitted reader can inspect the plan. Execution still requires the
   existing feature gate, `admin.manage`, and the task-specific hash-bound
   approval.
6. The deterministic executor applies the approved action with the
   caller-stable idempotency key; the model never receives shell or database
   access.
7. Post-checks and audit identify succeeded, failed, partial, or stale
   outcomes. A partial result always remains operator-visible.

### 8.7 Guardian journey

**Trigger:** authentication, authorization, request, content-change, provider,
or approved external integration signals cross a deterministic threshold.

1. The signal collector removes secrets, masks configured PII, bounds values,
   and assigns stable source, type, subject, site, severity, and time fields.
2. Correlation merges related signals, such as many login failures against
   several accounts, into a site-scoped incident without sending a raw log
   stream to a provider.
3. Guardian may ask a read-only model to classify the pattern and summarize
   evidence. Untrusted fields cannot select tools or change policy.
4. Deterministic policy chooses among record-only, notify, request approval,
   or a preconfigured reversible containment capability.
5. Allowed automatic containment is narrow and expiring: for example a
   temporary actor rate limit or reversible content quarantine.
   Suspicious-session-family revocation is a separate sensitive,
   non-reversible response option and always requires a fresh human approval.
   Permanent network blocks, data deletion, restore, plugin installation, and
   arbitrary infrastructure changes are excluded.
6. The security owner sees the incident timeline, correlated server facts,
   model assessment clearly labeled as such, actions, expiry, and links to
   WAF/SIEM evidence when configured.
7. The owner can restore/revoke containment, let its fixed TTL expire, resolve
   the incident, or escalate externally. V1 has no in-place TTL extension;
   later containment requires a newly admitted action after the prior one is
   terminal.

**Degraded behavior:** if the provider, queue, or correlation service is
unavailable, deterministic request security and rate limiting continue.
Signals queue within retention and surface a degraded-state alert; the site
does not fail open because model reasoning is absent.

## 9. Functional requirements

Requirement IDs in this section are stable references for design, code,
tests, and release acceptance. Rewording an ID must not broaden its behavior;
semantic replacement requires a new ID and an explicit supersession note.

### 9.1 Foundation, identity, and credentials

| ID           | Requirement                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-FND-001` | NexPress must define one exact client-safe agent contract containing versioned analyzers for agent identity, scope, capability metadata, runs, policy decisions, approvals, ChangeSets, incidents, budgets, and redacted audit rows.                    |
| `PR-FND-002` | Every agent caller must have an immutable identity, exact `siteId`, status, creation actor, expiry or rotation metadata, and an allowlisted `NpAgentScope` set independent of staff role.                                                               |
| `PR-FND-003` | Every capability invocation must authorize the current site, caller identity, required agent scopes, resource preconditions, policy version, quota, and risk class before execution.                                                                    |
| `PR-FND-004` | Provider credentials, Agent Gateway credentials, and integration credentials must be distinct audience-bound credential kinds and must never be passed through to another relationship.                                                                 |
| `PR-FND-005` | Provider connections must support BYOK first and may support delegated OAuth only when the provider explicitly authorizes server-side API use.                                                                                                          |
| `PR-FND-006` | Secret material must be encrypted using the configured vault boundary, never returned after creation, redacted from logs and model context, and independently rotatable and revocable per site.                                                         |
| `PR-FND-007` | An agent configuration must bind one role/template, provider connection and model allowlist where applicable, scopes, capabilities, triggers, policy mode, autonomy level, and budget; each admitted run freezes the resolved active policy ids/hashes. |
| `PR-FND-008` | New or materially expanded agent configurations must remain paused until an authorized human activates the exact reviewed version.                                                                                                                      |
| `PR-FND-009` | Site deletion and credential revocation must stop new runs immediately and cause queued work to fail closed before any capability executes.                                                                                                             |

### 9.2 Shared capabilities and Agent Gateway

| ID           | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-GWY-001` | External MCP clients and internal Agent Runtime jobs must call the same capability registry and execution facade.                                                                                                                                                                                                                                                                                                                       |
| `PR-GWY-002` | Every registered capability must declare exact input/output schemas, required scopes, risk, approval policy, reversibility, idempotency behavior, resource limits, and server-owned executor.                                                                                                                                                                                                                                           |
| `PR-GWY-003` | The 18-tool v1 master inventory must remain bounded, purpose-oriented, and complete at the maximum explicit exposure; each client list is the deterministic intersection of transport, deployment, site, immutable credential/grant, scope, and policy ceilings. OpenAPI operations may inform schemas but must not automatically become one tool each.                                                                                 |
| `PR-GWY-004` | MCP resources must project only bounded client-safe OpenAPI and public discovery metadata; server functions, access callbacks, persisted plugin config, credentials, and executable values must remain absent.                                                                                                                                                                                                                          |
| `PR-GWY-005` | Remote MCP authorization must bind audience, site, client, scopes, exposure mode, expiry, and revocation. Local credentials must receive equivalent scope, exposure, and audit enforcement.                                                                                                                                                                                                                                             |
| `PR-GWY-006` | Every mutation must require a caller-stable idempotency key and return the previously recorded compatible outcome on a valid retry.                                                                                                                                                                                                                                                                                                     |
| `PR-GWY-007` | Capability errors must use the shipped bounded API error envelope with stable safe codes; provider or internal errors must be normalized and may not leak secrets.                                                                                                                                                                                                                                                                      |
| `PR-GWY-008` | Capability calls must be rate-limited and quota-limited by site, agent, credential, capability, and provider budget as applicable.                                                                                                                                                                                                                                                                                                      |
| `PR-GWY-009` | Read-only public discovery must not imply agent authorization, and an MCP client must be unable to exchange a discovery response for mutation authority.                                                                                                                                                                                                                                                                                |
| `PR-GWY-010` | Local MCP must use stdio without a network listener. Remote MCP must be absent by default and, when explicitly enabled, mount only on the existing canonical HTTPS origin; NexPress must not require a dedicated MCP port, standalone public listener, hosted relay, or automatic tunnel.                                                                                                                                               |
| `PR-GWY-011` | Gateway exposure modes must be the closed ordered inventory `disabled`, `read`, `propose`, and `approved-execute`. They may only narrow authority, never grant scopes or lower approval floors; admission checks the exact input-selected effect profile, so proposal/approval-request branches remain usable without admitting their higher effecting branch, and the maximum mode preserves every shipped bounded Gateway capability. |

### 9.3 Agent ChangeSets and approvals

| ID           | Requirement                                                                                                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-CHG-001` | Content, navigation, theme setting, media-reference, and publication-schedule proposals must use a versioned editable Agent ChangeSet whose validated plan generation becomes immutable and hash-bound.                                                                                   |
| `PR-CHG-002` | A ChangeSet must record exact site, caller, agent configuration version, base resource versions, normalized operations, proposal hash, policy version, creation time, expiry, and caller-stable idempotency key.                                                                          |
| `PR-CHG-003` | Proposal creation must not mutate target resources. Validation and preview artifacts must be attributable to the exact proposal hash.                                                                                                                                                     |
| `PR-CHG-004` | Validation must re-use the live collection, field, block, navigation, theme, media, authorization, quota, and publication contracts and fail closed on unknown or stale data.                                                                                                             |
| `PR-CHG-005` | NexPress, not the model, must produce structural and field diffs, target inventories, check results, risk classification, approval requirements, and rollback availability shown to users.                                                                                                |
| `PR-CHG-006` | Preview must be site-scoped, time-limited, non-indexable, and unable to grant broader draft access. Desktop/mobile artifacts must identify rendering failures rather than silently omitting them.                                                                                         |
| `PR-CHG-007` | Approval must bind the human actor, required `NpCapability` set, proposal hash, policy version, challenge, expiry, decision, and optional bounded comment.                                                                                                                                |
| `PR-CHG-008` | Apply must atomically claim a valid approval and recheck authorization, policy, expiry, proposal hash, quotas, and target versions before writing. A stale proposal must not be silently rebased.                                                                                         |
| `PR-CHG-009` | ChangeSet application must use transactions where the existing resource contracts support them and must report any externally non-atomic step explicitly.                                                                                                                                 |
| `PR-CHG-010` | Verification must compare persisted and rendered results with the approved proposal and end in the exact ChangeSet state `verified`, `verification_failed`, `apply_failed`, `rolled_back`, or `rollback_failed`; partial/external convergence is structured evidence, not an extra state. |
| `PR-CHG-011` | Every reversible ChangeSet must create a tested rollback plan before apply; rollback is a new audited operation and never deletes the original evidence.                                                                                                                                  |
| `PR-CHG-012` | Rejected/cancelled and failed ChangeSets plus expired approval, superseded hash, stale base, and partial-convergence reason codes must remain inspectable within retention and must not authorize another proposal.                                                                       |

### 9.4 Event-driven Agent Runtime

| ID           | Requirement                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-RUN-001` | Runtime triggers must originate from a validated framework event, schedule, manual request, or approved integration signal and enqueue an exact durable payload with `siteId`.                    |
| `PR-RUN-002` | NexPress must not keep a model process alive per site or continuously stream raw logs to a provider.                                                                                              |
| `PR-RUN-003` | A run must have a finite state, deadline, attempt limit, model-call limit, tool-call limit, token/cost budget, and cancellation state.                                                            |
| `PR-RUN-004` | Run retries must be at-least-once safe through capability idempotency and must not repeat an already committed action under a new implicit key.                                                   |
| `PR-RUN-005` | The runtime must separate read-only analysis from deterministic execution; model output alone cannot authorize or execute a write.                                                                |
| `PR-RUN-006` | Model inputs must use bounded structured context, mark untrusted evidence, exclude configured secrets/PII, and record a safe digest and provenance.                                               |
| `PR-RUN-007` | Invalid, out-of-bounds, or unsupported model output must fail closed into a safe terminal or review state.                                                                                        |
| `PR-RUN-008` | Hard budgets and circuit breakers must prevent new provider calls before a configured limit is exceeded and must surface the degraded state.                                                      |
| `PR-RUN-009` | Pausing an agent must prevent new runs and model calls while allowing an in-flight deterministic action to reach a recorded safe boundary.                                                        |
| `PR-RUN-010` | Every run must expose bounded status, timing, usage, capability events, policy decisions, approvals, errors, verification, and incident links without storing or showing hidden chain-of-thought. |

### 9.5 Publisher and moderation

| ID           | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-CNT-001` | Publisher must query and propose only fields and documents allowed by the current site's exact collection and agent-scope contracts.                                                                                                                                                                                                                                                                                                                                        |
| `PR-CNT-002` | Scheduled content maintenance must record its selection criteria, candidate snapshot, exclusions, and maximum target count before model calls.                                                                                                                                                                                                                                                                                                                              |
| `PR-CNT-003` | Every v1 ChangeSet schedule, apply, and rollback execution must require a fresh human approval with every server-derived underlying human capability; rollback preparation may run without approval but cannot mutate state. Content publication includes `content.publish`, while navigation/theme/settings/media-only plans use their applicable capability set. Policy may permit proposal/validation/preview but cannot auto-publish or directly write a content draft. |
| `PR-MOD-001` | Moderation signals must use bounded reason codes, evidence references, site scope, subject scope, event time, and deduplication keys.                                                                                                                                                                                                                                                                                                                                       |
| `PR-MOD-002` | Semantic classifiers must be read-only and return a validated category, confidence, reason codes, and evidence references; free-form prose cannot select an action.                                                                                                                                                                                                                                                                                                         |
| `PR-MOD-003` | Automatic spam quarantine must be opt-in, thresholded by deterministic policy, preserve the original content, identify the policy version, and expose a restore capability.                                                                                                                                                                                                                                                                                                 |
| `PR-MOD-004` | Permanent deletion, permanent bans, and cross-site member actions must not be performed from model classification alone.                                                                                                                                                                                                                                                                                                                                                    |
| `PR-MOD-005` | Moderation floods must be deduplicated and batched within published bounds, with provider-call and action circuit breakers.                                                                                                                                                                                                                                                                                                                                                 |
| `PR-MOD-006` | Human disposition must record confirm, restore, dismiss, or escalate outcomes for evaluation and audit without silently changing the active model or policy.                                                                                                                                                                                                                                                                                                                |

### 9.6 Operator and Guardian

| ID           | Requirement                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-OPS-001` | Operator must consume shipped deterministic operations, doctor, jobs, storage, backup, plugin, readiness, release, and runbook contracts by their stable schema and check IDs.                                                                                  |
| `PR-OPS-002` | A model summary may add hypotheses but cannot remove, alter, or downgrade a deterministic failed check in the server facts.                                                                                                                                     |
| `PR-OPS-003` | Remote operations mutation must remain disabled unless the shipped feature gate is enabled and must retain its action allowlist, plan artifact, `admin.manage`, execute flag, and task-specific approval.                                                       |
| `PR-OPS-004` | The runtime must not expose arbitrary shell, SQL, filesystem, migration, restore, plugin-install, or infrastructure credentials to a model.                                                                                                                     |
| `PR-OPS-005` | Operations apply must return the same bounded mutation/audit and post-check evidence as the equivalent deterministic executor.                                                                                                                                  |
| `PR-GDN-001` | Guardian must normalize, redact, bound, retain, and correlate application-level signals without treating a model as an inline request security dependency.                                                                                                      |
| `PR-GDN-002` | Signal and incident identity must be exact and site-scoped; malformed or cross-site evidence must fail closed and reach diagnostics.                                                                                                                            |
| `PR-GDN-003` | Guardian model calls must be read-only and unable to modify tool inventory, policy, approval UI, signal severity, or authorizing facts.                                                                                                                         |
| `PR-GDN-004` | Any automatic containment must be separately opt-in, allowlisted, reversible or expiring, rate-limited, and attributable to the policy and evidence that selected it.                                                                                           |
| `PR-GDN-005` | Initial automatic containment may include bounded spam quarantine and temporary actor rate limits. Exact suspicious-session-family revocation is approval-gated, non-reversible, and never automatic; permanent blocks and destructive actions remain excluded. |
| `PR-GDN-006` | Guardian must preserve deterministic authentication, authorization, proxy rate limiting, and application availability when the model provider is unavailable.                                                                                                   |
| `PR-GDN-007` | An incident must distinguish observed server facts, deterministic conclusions, model assessments, human notes, and actions in its timeline.                                                                                                                     |
| `PR-GDN-008` | External WAF, error-monitoring, or SIEM integrations must use independent least-privilege credentials and treat imported evidence as untrusted.                                                                                                                 |
| `PR-GDN-009` | Product language and UI must state that Guardian complements rather than replaces infrastructure and security controls.                                                                                                                                         |

### 9.7 Agent Studio and Build Agent

| ID           | Requirement                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-ADM-001` | Agent Studio must provide site-scoped views for connections, agents, policies, activity, approvals, incidents, and budgets.                                                                                                                                     |
| `PR-ADM-002` | Every view and mutation must be authorized server-side with the applicable existing human `NpCapability`; hidden navigation is not authorization.                                                                                                               |
| `PR-ADM-003` | Approval UI must render targets, diffs, check results, risk, reversibility, policy, expiry, required capabilities, and proposal identity from server-produced facts rather than model-authored markup.                                                          |
| `PR-ADM-004` | Model explanations must be visibly labeled as untrusted assessment, rendered as bounded plain text, and separated from authorizing server facts.                                                                                                                |
| `PR-ADM-005` | Agent Studio must show loading, empty, degraded, stale, conflict, permission, quota, provider, execution, verification, and rollback states without collapsing them into generic success or failure.                                                            |
| `PR-ADM-006` | Connection secrets must be write-only; UI may display alias, provider, credential kind, scopes, status, last test, rotation, and revocation metadata but never recover secret material.                                                                         |
| `PR-ADM-007` | Agent Studio must expose append-only audit attribution and allow an authorized operator to pause an agent or revoke a credential independently.                                                                                                                 |
| `PR-BLD-001` | Build Agent output must remain a normal NexPress repository using supported collection, block, pattern, theme, plugin, scaffold, migration, and package contracts.                                                                                              |
| `PR-BLD-002` | Build Agent must inspect and preserve repository instructions and unrelated user changes, and must report every file, generated artifact, migration, and verification result it changes.                                                                        |
| `PR-BLD-003` | Collection or schema changes must run normal schema generation and produce a human-reviewable migration; generated schema must not be edited directly.                                                                                                          |
| `PR-BLD-004` | Build Agent must not use runtime Agent Gateway authorization as permission to merge, deploy, migrate, or alter infrastructure.                                                                                                                                  |
| `PR-BLD-005` | The first prompt-to-site product may constrain design to supported tokens, blocks, and patterns but must produce one canonical three-direction set, bind the selected id/hash and responsive preview digests into the blueprint, and hand off the complete set. |

## 10. Non-functional requirements

| ID                  | Requirement                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-NFR-SEC-001`    | All persisted and wire inputs must use exact bounded validators; unknown security-relevant fields fail closed.                                                                                                          |
| `PR-NFR-SEC-002`    | All reads, jobs, signals, runs, approvals, mutations, audit rows, and streamed invalidations must carry and enforce canonical site scope. Cross-site leakage is a release blocker.                                      |
| `PR-NFR-SEC-003`    | Credential encryption must support key rotation without returning plaintext through application APIs. A deployment without a usable vault must fail startup safety for provider execution.                              |
| `PR-NFR-SEC-004`    | Threat-model and adversarial tests must cover indirect prompt injection, tool-confusion, confused deputy, stale approval, replay, SSRF, secret exfiltration, cross-site access, budget exhaustion, and audit tampering. |
| `PR-NFR-REL-001`    | Durable runs use at-least-once delivery with explicit terminal states and caller-stable idempotency; lost, indefinitely running, and duplicate mutation states must reach Doctor/health diagnostics.                    |
| `PR-NFR-REL-002`    | Provider, integration, and model-output failures must be contained. Existing public reads, staff writes, proxy security, and deterministic operations must continue without the Agentic Platform.                       |
| `PR-NFR-REL-003`    | Reversible-action and ChangeSet rollback drills must be part of release acceptance; a UI rollback control is insufficient without persisted and integration-tested behavior.                                            |
| `PR-NFR-PERF-001`   | Event collection and deterministic request-path filtering must not wait for a provider response. Model calls occur out of band in the worker.                                                                           |
| `PR-NFR-PERF-002`   | All list, evidence, prompt-context, diff, preview, signal, incident, and audit surfaces must define pagination, size, depth, and retention bounds before release.                                                       |
| `PR-NFR-COST-001`   | A hard budget is an admission control, not an alert: a provider call that cannot fit the remaining configured allowance must not start.                                                                                 |
| `PR-NFR-COST-002`   | Usage accounting must distinguish provider-reported values, locally estimated values, reserved allowance, finalized cost, and unknown cost. Unknown cost must not be represented as zero.                               |
| `PR-NFR-PRIV-001`   | Raw request bodies and logs are not model context by default. Context projection must minimize fields, redact secrets, mask configured PII, bound retention, and record provenance.                                     |
| `PR-NFR-PRIV-002`   | Customer content, feedback, signals, and audit evidence must not be used for cross-customer model training by NexPress. Provider data handling remains an explicit connection choice.                                   |
| `PR-NFR-AUD-001`    | Material run and action audit is append-only within the application contract, time-ordered by persisted server sequence, and records hashes for large or separately retained artifacts.                                 |
| `PR-NFR-A11Y-001`   | Agent Studio and approval flows must meet WCAG 2.2 AA, including keyboard-only operation, visible focus, non-color status cues, semantic diffs, and accessible live updates.                                            |
| `PR-NFR-UX-001`     | Critical review and incident workflows must work from 320 CSS pixels through the existing Admin maximum width without hiding authorizing facts behind hover-only interactions.                                          |
| `PR-NFR-COMPAT-001` | The feature must preserve the supported Node, Postgres, Next, package-export, ESM, and scaffold contracts and must not add a second DB pool or runtime registry.                                                        |
| `PR-NFR-VERS-001`   | Public agent wire surfaces use `np.agent-<surface>.v1`; breaking changes require a new schema version and a documented compatibility or migration path.                                                                 |
| `PR-NFR-OBS-001`    | Provider, policy, queue, capability, approval, apply, verification, and rollback failures must emit bounded structured observability and surface in Doctor/health without leaking model inputs or credentials.          |
| `PR-NFR-I18N-001`   | Contract values and identifiers remain locale-independent; Admin copy uses the existing i18n contract before a phase is considered generally available.                                                                 |
| `PR-NFR-DEL-001`    | Every phase must meet the nine-part delivery rule in the parent README: contract, authorization, durability/audit, visibility, projection, diagnostics, tests, scaffold/docs, and package changeset.                    |

## 11. Phased release acceptance

Each phase is independently releasable and disabled by default until its
acceptance criteria pass. Later phases may depend on earlier phases, but an
operator must be able to use earlier shipped functionality without configuring
a model provider.

The implementation roadmap uses finer-grained `R0`–`R8` milestones. Product
phase mapping is:

| Product phase                                | Roadmap milestones                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Phase 1 — Agent Foundation                   | `R0` contract/threat lock and `R1` identity, vault, persistence, diagnostics    |
| Phase 2 — Agent Gateway and ChangeSets       | `R2` read-only Gateway, `R3` proposal/preview, and `R4` approval/apply/rollback |
| Phase 3 — Publisher, Moderator, and Operator | `R5` durable provider runtime and `R6` product recipes                          |
| Phase 4 — Guardian                           | `R7` security-signal orchestration                                              |
| Phase 5 — Build Agent experience             | `R8` prompt-to-site Build plane                                                 |

### Phase 1 — Agent Foundation

**Scope:** exact client-safe contract inventories, site-scoped principals,
transport/audience-bound service credentials, inbound OAuth persistence,
provider connections and vault metadata, diagnostics, and the minimum Agent
Studio Connections/Principals surface. Runtime Agent, policy, trigger, run,
action, budget, and provider-inference persistence intentionally waits for
Roadmap R5.

Acceptance:

- The contract portions of `PR-FND-001`, plus `PR-FND-002`,
  `PR-FND-004` through `PR-FND-006`, the credential-revocation and
  site-deletion portion of `PR-FND-009`, `PR-ADM-002`, `PR-ADM-006`, and the
  applicable NFRs have contract and Postgres-backed coverage.
- An admin can add a write-only provider credential, test it through a bounded
  fake/safe-probe adapter, rotate/revoke it, and prove the API never returns
  the secret.
- An admin can create a site-scoped principal with exact narrowed scopes,
  create or revoke its transport/audience-bound credential, and inspect the
  resulting redacted audit/diagnostic facts.
- No Runtime Agent, trigger, capability invocation, production write, or
  provider-inference path exists yet. Foundation release can be verified
  without spending provider tokens.
- Site deletion, credential revocation, cross-site access, malformed rows,
  and unavailable vault behavior fail closed and reach Doctor.

### Phase 2 — Agent Gateway and ChangeSets

**Scope:** local-first stdio MCP, optional same-origin remote MCP, bounded
resources and tools, external agent authorization, content read/draft
capabilities, ChangeSet validation, preview, approval, apply, verification,
and rollback. Exposure profiles stage authority without deleting any master
inventory capability.

Acceptance:

- `PR-GWY-001` through `PR-GWY-011` and `PR-CHG-001` through `PR-CHG-012`
  pass contract, transport, replay, stale-write, cross-site, and integration
  tests.
- A newly authorized external client can discover the bounded tool set, query
  one permitted collection, create a multi-document draft ChangeSet, and
  render a preview without receiving a staff password.
- A maximum-profile test principal with every required scope sees all shipped
  members of the 18-tool master inventory, while every lower profile and
  narrowed grant exposes only its exact deterministic subset.
- The approval page displays only server-derived target/diff/risk/check/policy
  facts, binds approval to the proposal hash, and rejects expiry, replay,
  modified payloads, and changed target versions.
- Successful apply records revisions and verification. A release drill proves
  rollback produces a new audited state and does not erase the original run.
- OpenAPI/MCP, Admin, CLI where applicable, Doctor, scaffold, live-guide, and
  package changeset work land together.

### Phase 3 — Publisher, Moderator, and Operator

**Scope:** durable framework/schedule triggers, bounded provider execution,
versioned Runtime Agents and policies, hard budgets, content maintenance, spam
classification/quarantine, operations analysis, and notifications.

Acceptance:

- `PR-FND-003`, `PR-FND-007` through `PR-FND-009`,
  `PR-RUN-001` through `PR-RUN-010`, `PR-CNT-001` through `PR-CNT-003`,
  `PR-MOD-001` through `PR-MOD-006`, and `PR-OPS-001` through
  `PR-OPS-005` pass policy, worker, retry, cancellation, quota, deletion, and
  adversarial tests.
- An admin can create a paused immutable Agent version, inspect its provider,
  scopes, capabilities, triggers, policy mode, autonomy, and hard budget, then
  activate or pause the exact reviewed version.
- A scheduled Publisher run selects a bounded candidate snapshot and produces
  a draft ChangeSet; it cannot publish without the applicable human approval.
- A labeled moderation corpus meets the launch precision threshold for the
  configured auto-quarantine tier, while malformed or uncertain output routes
  to human review. Restore is proven end to end.
- A signal flood proves deduplication, batching, circuit breaker, and hard
  budget admission without dropping deterministic moderation records.
- Operator can summarize exact shipped check IDs and create an existing
  operations plan, but remote apply remains subject to all current feature
  gates and approval requirements.

### Phase 4 — Guardian

**Scope:** application security signals, correlation, incident workflow,
bounded integrations, temporary containment, and incident evaluation.

Acceptance:

- `PR-GDN-001` through `PR-GDN-009` pass exact-contract, cross-site,
  prompt-injection, provider-outage, replay, false-positive, expiry, and
  restoration tests.
- Credential-stuffing, suspicious-session, mass-content-change, and agent-token
  misuse fixtures create bounded, deduplicated incidents with separated fact,
  model, human, and action timeline entries.
- Provider unavailability never disables existing authentication,
  authorization, rate limiting, or deterministic signal capture.
- Every automatic containment type is opt-in, allowlisted, expiring or
  reversible, action-rate-limited, and can be restored through an audited
  deterministic capability. Approval-gated session revocation is evaluated
  separately as a non-reversible response.
- Product copy, Admin help, and live docs explicitly state the WAF/IDS/SIEM
  non-replacement boundary.

### Phase 5 — Build Agent experience

**Scope:** prompt-to-site brief, supported collection/pattern/theme generation,
sample content, validation, responsive preview, and repository handoff.

Acceptance:

- `PR-BLD-001` through `PR-BLD-005` pass against the packed scaffolder rather
  than only the monorepo source tree.
- A representative brief produces a conventional project that installs,
  produces one exact three-direction DraftSet, seals it through the trusted
  deterministic renderer, independently rerenders/byte-compares the final
  previews, binds one selected id/hash and its desktop/mobile preview digests
  to the canonical blueprint, generates schema, typechecks, tests, builds, and
  renders the required responsive preview.
- Editing or combining a direction creates a new complete set/hash; validation
  and generation both reload the canonical set and reject a changed,
  non-member, expired, or byte-mismatched preview.
- Any collection change includes a generated schema and reviewable migration;
  the Build Agent does not apply it to production.
- The handoff includes the brief, complete canonical direction set, selected
  id/hash, blueprint, source/generated files, migration impact, verification,
  assumptions, and unresolved risk, and remains compatible with normal Git
  review and supported deployment targets.

## 12. Success metrics and safety gates

Product metrics are evaluated per site and in aggregate only from bounded,
privacy-reviewed telemetry. Targets below are initial release hypotheses and
must be revisited with production baselines. Safety gates are release blockers,
not optimization targets.

| ID              | Metric                            | Definition                                                                                                                                         | Initial target or gate                                                                                                                                                                                                              |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-METRIC-001` | Time to first safe value          | Median time from starting connection setup to the first successful read-only run or previewed draft ChangeSet.                                     | Product hypothesis: under 15 minutes for a supported provider.                                                                                                                                                                      |
| `PR-METRIC-002` | ChangeSet completion              | Applied-and-verified ChangeSets divided by valid ChangeSets submitted for approval, segmented by rejection, stale conflict, and execution failure. | Establish baseline in Phase 2; improve without reducing approval quality.                                                                                                                                                           |
| `PR-METRIC-003` | Useful proposal rate              | Approved without material manual rewrite divided by reviewed Publisher ChangeSets.                                                                 | Product hypothesis: at least 60% in the first supported content scenarios.                                                                                                                                                          |
| `PR-METRIC-004` | Auto-quarantine precision         | Human-confirmed spam among items automatically quarantined, measured on both acceptance corpus and sampled production review.                      | Safety gate: ≥99.5% reviewed precision, one-sided 95% Wilson lower bound ≥99.0%, ≥1,000 predicted positives and ≥1,000 legitimate hard negatives per enabled policy/locale bundle, plus a 14-day shadow period; otherwise advisory. |
| `PR-METRIC-005` | Restore success                   | Successful verified restores divided by attempted moderation and ChangeSet rollback drills.                                                        | Safety gate: 100% in release acceptance fixtures.                                                                                                                                                                                   |
| `PR-METRIC-006` | Incident detection latency        | Time from first retained qualifying signal to incident creation, excluding signals below configured thresholds.                                    | Publish a Phase 4 SLO after load evaluation; provider response is not on the request path.                                                                                                                                          |
| `PR-METRIC-007` | Containment false-positive rate   | Reversed or dismissed automatic containments divided by reviewed automatic containments, by action type.                                           | Safety gate set per action before enabling that action; no global threshold may authorize a new action type.                                                                                                                        |
| `PR-METRIC-008` | Human operations saved            | Completed agent actions that replace a defined manual workflow, reported by workflow rather than raw tool-call count.                              | Directional adoption metric; tool calls are not counted as value.                                                                                                                                                                   |
| `PR-METRIC-009` | Mutation audit coverage           | Material agent mutations with complete caller, site, policy, approval, idempotency, outcome, and verification attribution.                         | Safety gate: 100%.                                                                                                                                                                                                                  |
| `PR-METRIC-010` | Cross-site isolation failures     | Any response, model context, run, signal, approval, or action containing unauthorized site data.                                                   | Safety gate: zero; any occurrence blocks or rolls back release.                                                                                                                                                                     |
| `PR-METRIC-011` | Budget overshoot                  | Finalized provider cost above the configured hard allowance caused by an admitted call.                                                            | Safety gate: zero admitted calls after exhaustion; reservation-estimate error is reported separately.                                                                                                                               |
| `PR-METRIC-012` | Duplicate mutation rate           | Additional material mutations caused by delivery retries with the same idempotency key.                                                            | Safety gate: zero in retry and failover acceptance tests.                                                                                                                                                                           |
| `PR-METRIC-013` | Provider-independent availability | Existing non-agent reads/writes and deterministic security/ops behavior that remain healthy during provider outage tests.                          | Safety gate: all documented baseline behavior remains available.                                                                                                                                                                    |
| `PR-METRIC-014` | Policy prevention visibility      | Policy-blocked risky actions that record a safe reason and appear to an authorized operator.                                                       | Safety gate: 100% of attempted capability calls after identity resolution.                                                                                                                                                          |
| `PR-METRIC-015` | Weekly operated sites             | Sites with at least one successful, approved, or policy-allowed Agent Runtime workflow in seven days.                                              | Adoption metric segmented by Publisher, Moderator, Operator, and Guardian.                                                                                                                                                          |

## 13. Explicit exclusions from the initial program

The following remain outside all five phases unless this design is revised:

- arbitrary runtime code execution, package installation, shell, SQL, raw
  filesystem access, production migration apply, production restore apply, and
  infrastructure credential use by a model;
- cross-site global agents or one agent credential that silently inherits all
  sites of a human account;
- model-authored approval HTML, model-selected staff capability, model-created
  approval tokens, or approval based only on conversational confirmation;
- permanent deletion, permanent network bans, destructive schema changes, or
  irreversible moderation as an unattended capability;
- continuous provider ingestion of raw logs, request bodies, cookies,
  authorization headers, secrets, or unrestricted public content;
- unsandboxed remote URL fetching selected by untrusted content;
- autonomous merge, production deploy, DNS change, domain purchase, billing
  change, or release publication in the Build Agent;
- a promise that Guardian prevents compromise, a claim of compliance
  certification, or replacement of specialist security controls;
- support for a model provider whose authentication or data-use terms cannot
  be represented by the credential, privacy, and budget contracts;
- shared customer-data training, autonomous policy self-modification, or using
  moderator feedback to change production thresholds without a versioned
  authorized policy update; and
- a proprietary generated-site format that cannot be built, tested, and
  deployed as a conventional NexPress project.

## 14. Requirement ownership and change control

- Product requirement changes update this file and every affected architecture,
  data, capability, security, UX, roadmap, and test document in the same
  change.
- Exact wire and persisted enums belong to the client-safe contract and data
  design documents; this document names only states required for the product
  journey.
- A phase may narrow scope before implementation, but it may not claim
  acceptance while silently deferring a safety requirement cited by that
  phase.
- Shipped behavior is documented only after implementation in the focused live
  guides. This planning document remains clearly labeled as design history or
  is updated to point at those guides.
