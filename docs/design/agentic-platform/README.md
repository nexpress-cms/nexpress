# NexPress Agentic Platform — implementation design

> Status: implementation design; no new behavior in this directory is shipped
> until a matching live guide says so.
> Baseline verified against: `9b1c04e8927e195b8e8e23c7b1261756067ee25f`
> Baseline date: 2026-07-24
> Intended release line: post-`0.4.x`, delivered in independently releasable
> phases.

This directory defines the implementation plan for making NexPress an
agent-operable CMS: a site can be created with an AI coding agent, connected to
an external MCP client, and operated by durable server-side agents without
giving a model unrestricted production access.

The product promise is:

> Connect the AI you choose. NexPress gives it exact, site-scoped,
> approval-aware, reversible operating contracts while the application and
> data remain yours.

This is a planning snapshot, not a live architecture entry point. Current
behavior remains documented by the root [`AGENTS.md`](../../../AGENTS.md) and
the focused live guides under [`docs/`](../../).

## Document map

| Document                                                               | Purpose                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [product-requirements.md](product-requirements.md)                     | Positioning, personas, journeys, requirements, and release acceptance                |
| [architecture.md](architecture.md)                                     | Component boundaries, process topology, packages, and dependency rules               |
| [canonical-contracts.md](canonical-contracts.md)                       | Normative 32-purpose canonical bodies, field maps, owners, and golden-vector gates   |
| [data-model.md](data-model.md)                                         | Proposed persisted rows, invariants, retention, and deletion behavior                |
| [capabilities-and-mcp.md](capabilities-and-mcp.md)                     | Shared capability registry, scopes, MCP resources/tools, and API contracts           |
| [changesets-and-approvals.md](changesets-and-approvals.md)             | Cross-resource planning, preview, approval, apply, verify, and rollback              |
| [agent-runtime-and-guardian.md](agent-runtime-and-guardian.md)         | Durable triggers, provider execution, moderation, operations, and security signals   |
| [security-and-credentials.md](security-and-credentials.md)             | Threat model, credential vault, prompt-injection boundary, and action safety         |
| [admin-agent-studio.md](admin-agent-studio.md)                         | Admin information architecture and operator workflows                                |
| [build-agent-and-site-blueprint.md](build-agent-and-site-blueprint.md) | Prompt-to-site brief, blueprint, design variants, repository generation, and handoff |
| [implementation-roadmap.md](implementation-roadmap.md)                 | Dependency-ordered work packages, file ownership, migrations, and release gates      |
| [testing-and-evaluation.md](testing-and-evaluation.md)                 | Contract, integration, adversarial, model-quality, and operations verification       |

## Locked design decisions

These decisions are shared constraints for every document in this directory.
Changing one requires updating the affected documents together.

1. **One capability contract, two callers.** External MCP clients and the
   internal server-side Agent Runtime call the same validated capability
   registry. Neither path bypasses authorization, policy, audit, or quotas.
2. **Always-on means event-driven.** NexPress does not keep one model process
   alive per site or stream raw logs continuously to a provider. Framework
   events and schedules create bounded durable jobs; a model is called only
   when a rule, policy, or operator requests reasoning.
3. **Build and operate are separate planes.** A Build Agent changes a normal
   NexPress repository and goes through Git, schema generation, migrations,
   tests, and deployment. A Runtime Agent operates only the capabilities
   exposed by a running site.
4. **ChangeSet is the default write boundary.** Content, navigation, theme
   settings, media references, and publish scheduling are proposed, validated,
   previewed, approved when required, applied, and verified as a versioned
   ChangeSet. Narrow reversible actions such as spam quarantine or a temporary
   rate-limit may use a direct capability when policy explicitly allows it.
5. **No generated tool explosion.** OpenAPI and discovery metadata inform
   schemas and resources, but NexPress exposes a bounded purpose-oriented MCP
   tool set instead of mapping every HTTP operation to a separate tool.
6. **Agent scopes are not staff roles.** Existing `NpCapability` authorization
   remains the human/site membership contract. A separate exact
   `NpAgentScope` inventory limits agent credentials and capability calls.
7. **Provider credentials and site authorization are separate.** BYOK or a
   provider-supported delegated credential lets NexPress call a model. MCP
   OAuth or a transport/audience-bound service credential lets an external
   client call NexPress.
   Tokens are audience-bound and are never passed through between these
   relationships.
8. **Deterministic enforcement surrounds model judgment.** Models may classify,
   summarize, and propose. Exact validators, policy evaluation, approval
   challenges, execution allowlists, idempotency, and rollback are enforced by
   NexPress code.
9. **Untrusted data never becomes instruction.** Public content, comments,
   plugin output, remote pages, request metadata, and logs are marked and
   bounded as untrusted evidence. They cannot alter system policy, grant
   scopes, construct approval UI, or authorize actions.
10. **Safe and reversible by default.** Read operations may run unattended.
    Automatic writes must be both policy-allowed and reversible. Destructive,
    credential, schema, plugin-install, restore, and arbitrary code operations
    remain approval-gated or prohibited.
11. **Interactive previews are origin-isolated.** Human preview HTML runs only
    on a dedicated HTTPS origin with a different registrable domain, a
    one-time launch exchange, and a per-preview cookie. If that boundary is
    unavailable, interactive viewing is disabled rather than sharing Admin/
    site cookies; authenticated screenshot and report artifacts still work.

## Product surfaces

The plan uses five product terms consistently:

- **Agent Studio** — Admin surfaces for connections, agents, policies,
  activity, approvals, incidents, and budgets.
- **Agent Gateway** — local-first stdio MCP, explicitly enabled same-origin
  remote MCP, and agent-oriented HTTP resources over one capability registry.
  NexPress opens no dedicated MCP port; ordered exposure ceilings narrow which
  tools each transport/principal sees while the maximum explicit mode retains
  the complete bounded feature inventory.
- **Agent Runtime** — durable triggers, runs, provider calls, and verification
  performed by the site worker.
- **Agent ChangeSet** — a versioned editable draft whose validated plan
  generation is sealed, immutable, and hash-bound to its preview, approval,
  execution, verification, and rollback records.
- **Guardian** — application-level moderation and security-signal correlation;
  it complements rather than replaces a WAF, IDS, malware scanner, or SIEM.

Gateway modes change exposure, not the shipped feature set:

| Mode               | Effective surface                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `disabled`         | No tools, resources, prompts, or remote discovery for that transport                           |
| `read`             | Bounded site/content/ChangeSet/audit/ops/incident inspection                                   |
| `propose`          | All lower access plus ChangeSets, previews, plans, and approval requests; no effects           |
| `approved-execute` | The full 18-tool inventory; effecting branches still require normal scopes and policy/approval |

## Current foundation

The implementation must reuse rather than fork these shipped contracts:

- live collection, media, revision, settings, navigation, plugin, and search
  schemas from [agent-integration.md](../../agent-integration.md);
- bounded public metadata from [public-discovery.md](../../public-discovery.md);
- deterministic status, plan/apply, approval, audit, release, backup, storage,
  and runbook output from [agent-operated-ops.md](../../agent-operated-ops.md);
- site execution scope and authorization from [multi-site.md](../../multi-site.md);
- durable payload, handler, log, and worker behavior from [jobs.md](../../jobs.md);
- logger and reporter containment from [observability.md](../../observability.md);
- rate-limit adapter enforcement from [rate-limiting.md](../../rate-limiting.md);
- document revision and restore behavior from [revisions.md](../../revisions.md).

## Proposed code ownership

The exact file list may move during implementation, but the dependency
direction is fixed:

```text
@nexpress/core/agent-contract     client-safe exact types and analyzers
              ↓
@nexpress/core/agents             server-only registry, policy, runs, vault,
                                  ChangeSets, incidents, and provider facade
              ↓
@nexpress/next bootstrap          installs host adapters and runtime intent
              ↓
@nexpress/app                     HTTP/MCP routes, worker handlers, Admin pages
              ↓
@nexpress/admin/client            browser-only Agent Studio views

@nexpress/mcp                     optional stdio/remote protocol adapter;
                                  calls the same app/core capability facade
```

The adapter is never the authority source. Core descriptors and effect profiles
declare exact transport projection and minimum exposure; deployment intent,
site setting, credential/grant ceiling, scopes, policy, resource authorization,
quota, and approval are intersected at every list/read/call. Therefore
disabling remote MCP removes only that ingress surface and never disables
Agent Studio, internal Runtime, or local stdio when separately enabled.

Core must not import Next.js, Admin, or MCP transport code. The Admin package
may import only client-safe `agent-contract` validators. Every site-owned
durable job carries exact `siteId`; the closed global maintenance exceptions
have `{}` payloads and only claim/fan out exact site jobs as listed in
[agent-runtime-and-guardian.md](agent-runtime-and-guardian.md#durable-pg-boss-jobs).
No request-local or MCP-session state may be assumed to survive enqueue.

## Terminology and identifiers

- Framework-owned symbols follow the repository `np` / `Np` / `NP_` naming
  convention.
- Persisted tables use the `np_agent_*` prefix.
- Wire schema versions use `np.agent-<surface>.v1`.
- Agent scopes use colon-separated identifiers such as `content:read`,
  `content:draft`, `ops:read`, and `moderation:execute`.
- Capability ids use dot-separated verbs such as `content.query`,
  `changeset.create`, and `ops.plan`.
- Every mutation accepts a caller-stable idempotency key.
- Every time value crossing a wire boundary is a canonical UTC ISO string.

## Delivery rule

No phase should land as only a UI or only a model prompt. A phase is complete
when it has:

1. an exact client-safe contract;
2. server-side validation and site authorization;
3. durable/audited behavior where applicable;
4. Admin or CLI visibility;
5. OpenAPI/MCP projection when in scope;
6. Doctor/health diagnostics;
7. unit and Postgres-backed integration coverage;
8. scaffold and live-guide updates;
9. a changeset for affected published packages.
