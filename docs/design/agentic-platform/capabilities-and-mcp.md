# NexPress Agentic Platform — capabilities and MCP

> Status: proposed exact contract. This document defines the canonical v1
> capability ids, agent scopes, MCP projection, and transport rules for the
> implementation plan. It does not describe shipped endpoints.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
>
> Read [`README.md`](README.md) and [`architecture.md`](architecture.md)
> first. ChangeSet operation shapes, approval state, persisted credentials,
> Runtime execution, and security controls are specified in the corresponding
> documents in this directory.

## 1. Purpose

External MCP clients and the server-side Agent Runtime must reach production
state through one function:

```ts
npInvokeAgentCapability(request, context);
```

The function is responsible for exact input/output validation, site scope,
authorization, policy, quota, idempotency, approval, audit, and dispatch.
MCP, REST, Admin, a job handler, or a provider adapter may not implement a
shorter path.

The public surface is deliberately small:

- a closed scope vocabulary;
- a closed set of framework capability ids;
- 18 purpose-oriented MCP tools;
- bounded resource templates and four user-selected prompts;
- no plugin-defined runtime capability or generated tool surface in v1.

## 2. Three authorization vocabularies

NexPress has three similarly named concepts that must not be merged:

| Vocabulary           | Meaning                                                   | Example                          |
| -------------------- | --------------------------------------------------------- | -------------------------------- |
| `NpCapability`       | current staff/site membership authorization               | `content.author`, `admin.manage` |
| `NpPluginCapability` | what trusted in-process plugin code may call on `ctx`     | `content:read`, `network:fetch`  |
| `NpAgentScope`       | what one external credential or Runtime agent may request | `content:draft`, `ops:read`      |

An agent scope does not promote a staff user. Plugin manifest capabilities do
not authorize an MCP caller. OAuth consent does not grant a plugin new `ctx`
members.

For a delegated user call, all of these must pass:

```text
valid token
  ∧ exact token audience
  ∧ token site == invocation site
  ∧ required NpAgentScope values
  ∧ current canOnSite(user, mapped NpCapability)
  ∧ capability-specific resource access
  ∧ site Agent Policy
  ∧ quota / budget / approval / idempotency
```

For a service or Runtime agent, the same scope, site, resource, policy, quota,
approval, and idempotency checks apply. A user-created agent also re-resolves
its authority user's current membership. A deployment-defined system agent has
no implicit super-admin authority; its exact site and maximum scopes come from
validated deployment configuration.

## 3. Exact agent scope inventory

```ts
export const npAgentScopes = [
  "site:read",
  "schema:read",
  "changeset:read",
  "changeset:write",
  "changeset:apply",
  "content:read",
  "content:draft",
  "content:publish",
  "media:read",
  "media:write",
  "navigation:read",
  "navigation:write",
  "theme:read",
  "theme:write",
  "settings:read",
  "settings:write",
  "audit:run",
  "ops:read",
  "ops:plan",
  "ops:execute",
  "incident:read",
  "moderation:execute",
  "security:execute",
] as const;

export type NpAgentScope = (typeof npAgentScopes)[number];
```

The union is closed. Unknown strings fail credential creation, OAuth consent,
token verification, agent configuration, descriptor registration, and
invocation. Adding or renaming a scope is a public contract change.

`site:read` is the mandatory base scope on every active v1 credential/grant;
the capability table lists its additional static scopes rather than repeating
that base on every row.

There is intentionally no scope for:

- approving a ChangeSet or action;
- creating credentials or editing Agent Policy;
- reading or exporting secrets;
- installing packages/plugins;
- changing schema or running migrations;
- arbitrary SQL, shell, code, network, or filesystem access;
- deleting audit history;
- escalating an agent's own scopes.

### 3.1 Staff authority required to grant/use a scope

```ts
export const npAgentScopeStaffCapability = {
  "site:read": "site.access",
  "schema:read": "site.access",
  "changeset:read": "content.author",
  "changeset:write": "content.author",
  "changeset:apply": "content.publish",
  "content:read": "site.access",
  "content:draft": "content.author",
  "content:publish": "content.publish",
  "media:read": "site.access",
  "media:write": "content.author",
  "navigation:read": "site.access",
  "navigation:write": "admin.manage",
  "theme:read": "site.access",
  "theme:write": "admin.manage",
  "settings:read": "admin.manage",
  "settings:write": "admin.manage",
  "audit:run": "admin.manage",
  "ops:read": "admin.manage",
  "ops:plan": "admin.manage",
  "ops:execute": "admin.manage",
  "incident:read": "admin.manage",
  "moderation:execute": "community.moderate",
  "security:execute": "admin.manage",
} as const satisfies Record<NpAgentScope, NpCapability>;
```

This table is an authority ceiling, not the complete decision. Collection
access callbacks, row ownership, plugin activation, target state, policy,
approval, and resource-derived scopes still run.

`ops:*` covers only site-owned agent operations in v1. Database migration,
production restore, global queue pause/drain, package installation, plugin code
reload, plugin site activation, and storage cutover remain outside agent
authority even for a super-admin.

The executable ops action inventory is closed:

```ts
export const npAgentExecutableOpsActionIds = [
  "cache.revalidate",
  "agent.run.retry",
  "agent.run.cancel",
] as const;

export type NpAgentExecutableOpsActionId = (typeof npAgentExecutableOpsActionIds)[number];

export const npAgentPlanOnlyOpsActionIds = [
  "migration.plan",
  "restore.plan",
  "storage.migration.plan",
  "plugin.change.plan",
  "queue.global.plan",
] as const;

export type NpAgentPlanOnlyOpsActionId = (typeof npAgentPlanOnlyOpsActionIds)[number];
export type NpAgentOpsPlanActionId = NpAgentExecutableOpsActionId | NpAgentPlanOnlyOpsActionId;

interface NpAgentOpsExecuteCommon {
  planId: string;
  planDigest: string;
  approvalId: string;
}

export type NpAgentOpsExecuteInput =
  | (NpAgentOpsExecuteCommon & {
      action: "cache.revalidate";
      target:
        | { kind: "site" }
        | { kind: "collection"; collection: string }
        | {
            kind: "document";
            collection: string;
            documentSlug: string;
          }
        | { kind: "navigation"; location: string };
    })
  | (NpAgentOpsExecuteCommon & {
      action: "agent.run.retry";
      failedRunId: string;
    })
  | (NpAgentOpsExecuteCommon & {
      action: "agent.run.cancel";
      runId: string;
    });
```

All targets inherit the authenticated current site; no input contains
`siteId`. Retry creates a new linked run and repeats admission, scopes, policy,
budget, approval, and idempotency checks. Cancel is cooperative and succeeds
only before the target run starts its database commit boundary; afterward it
returns `CONFLICT` and may offer a rollback plan. Raw queue job retry/cancel is
not exposed.

`ops.plan` may collect evidence and return a local CLI handoff for migration,
restore, storage, plugin, or queue-global operations, but `ops.execute` rejects
those action ids even when a human approved arbitrary prose.

## 4. Client-safe capability contracts

The following contracts belong in `@nexpress/core/agent-contract`. All wire
objects are exact: unknown keys, accessors, class instances, non-finite
numbers, unsafe strings, excessive depth, and values above published bounds
fail closed.

```ts
export type NpAgentJsonPrimitive = string | number | boolean | null;
export type NpAgentJsonValue =
  NpAgentJsonPrimitive | NpAgentJsonValue[] | { [key: string]: NpAgentJsonValue };
export type NpAgentJsonObject = { [key: string]: NpAgentJsonValue };
export type NpAgentJsonSchema = NpAgentJsonObject & {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  additionalProperties: false;
};

export const npAgentCapabilityRisks = ["read", "reversible", "sensitive", "destructive"] as const;
export type NpAgentCapabilityRisk = (typeof npAgentCapabilityRisks)[number];

export const npAgentApprovalModes = ["none", "policy", "human"] as const;
export type NpAgentApprovalMode = (typeof npAgentApprovalModes)[number];

export const npAgentGatewayExposureModes = [
  "disabled",
  "read",
  "propose",
  "approved-execute",
] as const;
export type NpAgentGatewayExposureMode = (typeof npAgentGatewayExposureModes)[number];

export const npAgentGatewayTransports = ["stdio", "mcp-http", "agent-http"] as const;
export type NpAgentGatewayTransport = (typeof npAgentGatewayTransports)[number];

export const npAgentGatewayExposureRank: Record<NpAgentGatewayExposureMode, number> = {
  disabled: 0,
  read: 1,
  propose: 2,
  "approved-execute": 3,
};

export const npAgentRiskRank: Record<NpAgentCapabilityRisk, number> = {
  read: 0,
  reversible: 1,
  sensitive: 2,
  destructive: 3,
};

export const npAgentApprovalRank: Record<NpAgentApprovalMode, number> = {
  none: 0,
  policy: 1,
  human: 2,
};

export const npAgentExecutionModes = ["inline", "durable", "either"] as const;
export type NpAgentExecutionMode = (typeof npAgentExecutionModes)[number];

export const npAgentIdempotencyModes = ["none", "required"] as const;
export type NpAgentIdempotencyMode = (typeof npAgentIdempotencyModes)[number];

export const npAgentScopeDerivations = [
  "none",
  "schema-resource",
  "content-query",
  "changeset-resources",
  "audit-selection",
  "ops-selection",
  "ops-action",
  "incident-target",
  "moderation-target",
  "security-target",
] as const;
export type NpAgentScopeDerivation = (typeof npAgentScopeDerivations)[number];

export interface NpAgentEffectProfileDescriptor {
  id: string;
  kind: "read" | "mutation";
  reversibility: "none" | "compensatable";
  minimumGatewayExposure: Exclude<NpAgentGatewayExposureMode, "disabled"> | null;
  verifierId: string | null;
  compensatorId: string | null;
}

export interface NpAgentCapabilityDescriptor {
  schemaVersion: "np.agent-capability.v1";
  id: NpAgentCapabilityId;
  contractVersion: 1;
  source: "core" | `app:${string}`;
  title: string;
  description: string;
  requiredScopes: NpAgentScope[];
  scopeDerivation: NpAgentScopeDerivation;
  risk: NpAgentCapabilityRisk;
  approval: NpAgentApprovalMode;
  effectProfiles: NpAgentEffectProfileDescriptor[];
  bootstrapIntent: "plugins" | "write";
  execution: NpAgentExecutionMode;
  idempotency: NpAgentIdempotencyMode;
  gateway: {
    transports: NpAgentGatewayTransport[];
  } | null;
  inputSchema: NpAgentJsonSchema;
  outputSchema: NpAgentJsonSchema;
}
```

`NpAgentJsonSchema` is the repository's bounded JSON Schema 2020-12 subset.
Capability inputs and outputs have object roots and
`additionalProperties: false`. `$ref` may target only definitions in the same
validated schema bundle; remote references, executable formats, custom
keywords, and recursive graphs above the contract limits are rejected.

`gateway` is a closed projection rule, not authority. `null` makes an internal
capability unavailable to every external Gateway transport. A non-null value
names the exact transports that may project it. Each effect profile declares
its own non-null minimum exposure or remains internal with `null`; this lets a
single tool admit a proposal/approval-request branch without admitting its
effecting branch. Transport admission still intersects the deployment ceiling,
site setting, immutable credential/grant ceiling, principal scopes, current
policy, resource authorization, quotas, risk, and approval. A mode can narrow
this intersection but cannot grant a scope or lower an approval floor.

The descriptor is metadata, not enforcement. The registry stores a server-only
definition:

```ts
export interface NpAgentCapabilityDefinition<
  TInput extends NpAgentJsonObject,
  TOutput extends NpAgentJsonObject,
> {
  descriptor: NpAgentCapabilityDescriptor;
  implementationVersion: number;
  effectContracts: Readonly<Record<string, NpAgentEffectContract<TInput, TOutput>>>;
  resolveEffectProfile(input: TInput): string;
  parseInput(value: unknown): TInput;
  parseOutput(value: unknown): TOutput;
  deriveRequirements?(
    input: TInput,
    context: NpAgentRequirementContext,
  ): Promise<NpAgentDerivedRequirements>;
  execute(
    input: TInput,
    context: NpAgentCapabilityContext,
  ): Promise<NpAgentExecutionResult<TOutput> | NpAgentDeferredOutput>;
}

export interface NpAgentRequirementContext {
  siteId: string;
  principal: NpAgentPrincipal;
  requestedAt: string;
}

export type NpAgentActorSubjectV1 =
  | {
      kind: "principal";
      principalKind: "staff" | "member" | "agent-gateway";
      principalId: string;
    }
  | ({ kind: "actor-bucket" } & NpAgentActorBucketRefV1);

export type NpAgentTargetRef =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "media"; mediaId: string }
  | { kind: "navigation"; location: string }
  | { kind: "theme_tokens"; themeId: string }
  | { kind: "setting"; key: string }
  | { kind: "actor"; subject: NpAgentActorSubjectV1 }
  | { kind: "incident"; incidentId: string }
  | { kind: "ops"; action: NpAgentOpsPlanActionId };

export interface NpAgentDerivedRequirements {
  additionalScopes: NpAgentScope[];
  targetRefs: NpAgentTargetRef[];
  riskFloor: NpAgentCapabilityRisk;
  approvalFloor: NpAgentApprovalMode;
}

export type NpAgentDeferredOutput =
  | {
      kind: "accepted";
      runId: string;
      statusResource: string;
      pollAfterMs: number;
    }
  | {
      kind: "approval_required";
      runId: string;
      actionId: string;
      approvalId: string;
      proposalHash: string;
      approvalResource: string;
      expiresAt: string;
    };

export interface NpAgentCapabilityContext {
  invocationId: string;
  siteId: string;
  principal: NpAgentPrincipal;
  idempotencyKey: string | null;
  requestedAt: string;
  abortSignal: AbortSignal;
}

export interface NpAgentMutationReceipt {
  actionId: string;
  effectProfileId: string;
  effectContractVersion: number;
  effectDigest: string;
  targetVersionDigest: string;
  outputDigest: string;
}

export interface NpAgentEffectVerification {
  state: "passed" | "failed" | "ambiguous";
  resultDigest: string;
  evidenceRefs: string[];
}

export interface NpAgentUndoReference {
  kind: "containment" | "changeset_draft";
  id: string;
  targetVersionDigest: string;
}

export interface NpAgentCompensationRequest {
  actionId: string;
  undo: NpAgentUndoReference;
  expectedCurrentVersionDigest: string;
  idempotencyKey: string;
}

export interface NpAgentCompensationResult {
  state: "compensated" | "conflicted" | "failed";
  resultDigest: string;
  evidenceRefs: string[];
}

export type NpAgentEffectContract<
  TInput extends NpAgentJsonObject,
  TOutput extends NpAgentJsonObject,
> =
  | {
      profileId: string;
      kind: "read";
      effectContractVersion: number;
    }
  | {
      profileId: string;
      kind: "mutation";
      reversibility: "none";
      effectContractVersion: number;
      verifierId: string;
      verify(
        input: TInput,
        output: TOutput,
        receipt: NpAgentMutationReceipt,
        context: NpAgentCapabilityContext,
      ): Promise<NpAgentEffectVerification>;
    }
  | {
      profileId: string;
      kind: "mutation";
      reversibility: "compensatable";
      effectContractVersion: number;
      verifierId: string;
      compensatorId: string;
      deriveUndo(
        input: TInput,
        output: TOutput,
        receipt: NpAgentMutationReceipt,
      ): NpAgentUndoReference;
      verify(
        input: TInput,
        output: TOutput,
        receipt: NpAgentMutationReceipt,
        context: NpAgentCapabilityContext,
      ): Promise<NpAgentEffectVerification>;
      compensate(
        request: NpAgentCompensationRequest,
        context: NpAgentCapabilityContext,
      ): Promise<NpAgentCompensationResult>;
    };

export type NpAgentExecutionResult<TOutput extends NpAgentJsonObject> =
  | {
      kind: "completed-read";
      output: TOutput;
    }
  | {
      kind: "completed-no-effect";
      output: TOutput;
      reasonCode: string;
    }
  | {
      kind: "completed-mutation";
      output: TOutput;
      receipt: NpAgentMutationReceipt;
    };
```

`deriveRequirements()` may only add scopes/targets or raise risk/approval. It
cannot lower descriptor requirements. “Raise” is the explicit maximum by
`npAgentRiskRank` or `npAgentApprovalRank`; composition uses the same
associative/commutative maximum and never tuple declaration order. The
executor receives no raw bearer
token, provider key, integration secret, cookie, CSRF value, policy mutation
method, or approval-grant method.

Registration computes each canonical capability fingerprint with purpose
`np.agent-capability-registry.v1` and
`projection:"definition"` over exactly one complete descriptor, exact
input/output schema digests, `implementationVersion`, and sorted declared
effect profiles plus each profile's kind, reversibility, version, verifier,
and compensator ids. The complete non-empty installed set uses the same
purpose with `projection:"registry"` to produce only
`registryFingerprint`. Definition and registry projections cannot substitute
for one another. Function source text is never fingerprint input. Invocations
and actions persist both the capability fingerprint and resolved effect
profile; approvals additionally bind them. Any contract or
execution-semantics change that changes this fingerprint invalidates an
unconsumed approval and requires an explicit implementation-version bump
rather than silently reusing the old statement.

Effect invariants are closed: a read profile has `reversibility:"none"` and
null verifier/compensator ids; every mutation profile requires a read-side
verifier; a compensatable profile requires `deriveUndo`, `compensate`, and a
non-null matching compensator id; and a non-compensatable mutation forbids
those members. `resolveEffectProfile()` must return one descriptor-owned id and
is run on the already parsed input before policy/admission. Unknown or
mode-incompatible profiles fail closed. Undo uses only the server-derived
opaque handle plus installed/current target-version digests and a fresh
idempotency key. A model cannot invent restoration state, and a conflict never
falls back to blind replay.

`completed-read` is valid only for a read profile.
`completed-no-effect` is valid only when the parsed capability output and
stable reason code declare a pre-write conflict/failure and the server-owned
transaction proves no domain mutation occurred. `completed-mutation` is the
only successful mutating envelope and must carry a receipt whose profile/
contract version matches admission; receipt and domain mutation commit
together where the storage transaction supports it. A crash-ambiguous external
effect remains an executing/ambiguous action and is reconciled by the
verifier—it is never downgraded to `completed-no-effect`.

### 4.1 Principal contract

The server resolves one of these before registry dispatch:

```ts
export type NpAgentPrincipal =
  | {
      kind: "oauth-user";
      principalId: string;
      siteId: string;
      subjectUserId: string;
      oauthGrantId: string;
      clientId: string;
      gatewayExposureCeiling: Exclude<NpAgentGatewayExposureMode, "disabled">;
      scopes: readonly NpAgentScope[];
    }
  | {
      kind: "service";
      principalId: string;
      siteId: string;
      credentialId: string;
      authority: { kind: "user"; userId: string } | { kind: "deployment"; policyId: string };
      gatewayExposureCeiling: Exclude<NpAgentGatewayExposureMode, "disabled">;
      scopes: readonly NpAgentScope[];
    }
  | {
      kind: "runtime";
      principalId: string;
      siteId: string;
      agentId: string;
      runId: string;
      authority: { kind: "user"; userId: string } | { kind: "deployment"; policyId: string };
      scopes: readonly NpAgentScope[];
      autonomy: NpAgentAutonomyMode;
      capabilityModesHash: string;
    };
```

This is a server context type. Public wires expose stable actor references, not
credential/token identifiers that are unnecessary for the caller. External
OAuth/service principals intentionally have no autonomy field;
`gatewayExposureCeiling` is the immutable credential/grant value, while the
invocation context below carries the effective outer-narrowed value. Scope,
hard rules, site feature settings, resource authorization, and capability
approval decide their calls. Runtime autonomy/modes come only from the
immutable active Agent version frozen on its run.

### 4.2 Invocation request and result

```ts
export interface NpAgentNormalizedCapabilityInvocationRequest {
  schemaVersion: "np.agent-invocation-request.v1";
  capabilityId: NpAgentCapabilityId;
  input: NpAgentJsonObject;
  idempotencyKey: string | null;
}

export interface NpAgentInvocationAuthContext {
  transport: "mcp-oauth" | "mcp-service" | "stdio" | "agent-api" | "runtime";
  effectiveGatewayExposure: Exclude<NpAgentGatewayExposureMode, "disabled"> | null;
  requestId: string;
  principal: NpAgentPrincipal;
}

interface NpAgentInvocationCommon {
  schemaVersion: "np.agent-invocation.v1";
  ok: true;
  invocationId: string;
  capabilityId: NpAgentCapabilityId;
  siteId: string;
  requestedAt: string;
  auditEventId: string;
}

export type NpAgentCapabilityInvocationResult<TOutput extends NpAgentJsonObject> =
  | (NpAgentInvocationCommon & {
      state: "completed";
      output: TOutput;
      completedAt: string;
    })
  | (NpAgentInvocationCommon & {
      state: "accepted";
      runId: string;
      statusResource: string;
      pollAfterMs: number;
    })
  | (NpAgentInvocationCommon & {
      state: "approval_required";
      runId: string;
      actionId: string;
      approvalId: string;
      proposalHash: string;
      approvalResource: string;
      expiresAt: string;
    });

export interface NpAgentCapabilityInvoker {
  invoke(
    request: NpAgentNormalizedCapabilityInvocationRequest,
    context: NpAgentInvocationAuthContext,
  ): Promise<NpAgentCapabilityInvocationResult<NpAgentJsonObject>>;
}
```

`effectiveGatewayExposure` is non-null for admitted `mcp-oauth`,
`mcp-service`, `stdio`, and `agent-api` calls and null for `runtime`. The
invocation/audit authorization snapshot freezes that value so a later
deployment or site widening cannot reinterpret an earlier request.

`NpAgentActorBucketRefV1` is the shared exact
purpose/projection-version/projection-fingerprint/key-id/bucket contract from
the Guardian domain. Capability requirement derivation resolves
`incident-subject` to `NpAgentActorSubjectV1` before it emits a target ref.
There is no `credential`, bare `ip-bucket`, raw IP/email, or unnamespaced
opaque string branch, so policy, idempotency, audit, and restriction
enforcement use the same canonical subject bytes.

Every wire timestamp is canonical UTC ISO. `statusResource` and
`approvalResource` are opaque site-scoped references. An `approval_required`
result is not authorization to execute. Approval is recorded through the
authenticated Admin approval contract and is bound to the proposal, preview,
policy, target, and expiry hashes.

Approval-gated execution is always a second invocation with a new
caller-stable idempotency key. A first ChangeSet schedule/apply request may
carry `approvalId:null` to create the exact approval-required result; execution
then carries the sealed target hash and approved id. Rollback uses its explicit
request/execute modes; `ops.execute` carries its plan/hash/approval tuple. The
four direct moderation/security capabilities use this exact input shape:

```ts
type NpAgentDirectActionInput<TProposal extends NpAgentJsonObject> =
  | { mode: "propose"; proposal: TProposal }
  | {
      mode: "execute_approved";
      actionId: string;
      approvalId: string;
      proposalHash: string;
    };
```

The `execute_approved` branch cannot submit a new target or arguments. The
registry resolves the original action from the approval, checks its frozen
input/proposal hash, descriptor fingerprint, scopes, required human
capabilities, policies, target versions, expiry, and single-use state, then
links the new invocation as the action's execution invocation. An unrelated,
changed, expired, revoked, consumed, or cross-site approval fails closed. A
policy-allowed direct proposal may complete in its first invocation; the
second branch is accepted only for an action that actually stopped at human
approval.

## 5. Canonical framework capability inventory

```ts
export const npAgentCapabilityIds = [
  "site.inspect",
  "schema.get",
  "content.query",
  "changeset.create",
  "changeset.validate",
  "changeset.preview",
  "changeset.schedule",
  "changeset.apply",
  "changeset.rollback",
  "changeset.get",
  "changeset.list",
  "audit.run",
  "ops.status",
  "ops.plan",
  "ops.execute",
  "incident.get",
  "incident.list",
  "moderation.quarantine",
  "moderation.restore",
  "security.limitActor",
  "security.revokeSessions",
] as const;

export type NpCoreAgentCapabilityId = (typeof npAgentCapabilityIds)[number];
export type NpAgentCapabilityId = NpCoreAgentCapabilityId;
```

The v1 union is closed to these 21 framework ids. App code may own a core
definition's implementation source, but cannot add an unversioned id.

| Capability                | Static scopes        | Derived scopes                        | Risk / approval                                | Execution / idempotency |
| ------------------------- | -------------------- | ------------------------------------- | ---------------------------------------------- | ----------------------- |
| `site.inspect`            | `site:read`          | none                                  | read / none                                    | inline / none           |
| `schema.get`              | `schema:read`        | resource visibility                   | read / none                                    | inline / none           |
| `content.query`           | `content:read`       | collection/row access                 | read / none                                    | inline / none           |
| `changeset.create`        | `changeset:write`    | every operation's draft/write scopes  | reversible / none                              | inline / required       |
| `changeset.validate`      | `changeset:read`     | visibility for every target           | read / none                                    | either / required       |
| `changeset.preview`       | `changeset:read`     | visibility for every target           | read / none                                    | durable / required      |
| `changeset.schedule`      | `changeset:apply`    | publish/write scopes for every target | sensitive / human                              | durable / required      |
| `changeset.apply`         | `changeset:apply`    | publish/write scopes for every target | sensitive / human                              | durable / required      |
| `changeset.rollback`      | `changeset:apply`    | publish/write scopes for every target | read / none; execute derives sensitive / human | durable / required      |
| `changeset.get`           | `changeset:read`     | visibility for every included target  | read / none                                    | inline / none           |
| `changeset.list`          | `changeset:read`     | result filtering by target visibility | read / none                                    | inline / none           |
| `audit.run`               | `audit:run`          | selected collections/check families   | read / none                                    | durable / required      |
| `ops.status`              | `ops:read`           | selected site check families          | read / none                                    | inline / none           |
| `ops.plan`                | `ops:plan`           | exact allowlisted action              | read / none                                    | either / required       |
| `ops.execute`             | `ops:execute`        | action-specific scopes and approval   | sensitive / human                              | durable / required      |
| `incident.get`            | `incident:read`      | incident target visibility            | read / none                                    | inline / none           |
| `incident.list`           | `incident:read`      | result filtering                      | read / none                                    | inline / none           |
| `moderation.quarantine`   | `moderation:execute` | target collection/community policy    | reversible / policy                            | either / required       |
| `moderation.restore`      | `moderation:execute` | exact content-quarantine target       | sensitive / human                              | either / required       |
| `security.limitActor`     | `security:execute`   | actor/limit/enforcement availability  | reversible / policy                            | either / required       |
| `security.revokeSessions` | `security:execute`   | exact actor/session-family impact     | sensitive / human                              | durable / required      |

The `scopeDerivation` mapping is also closed: `site.inspect` uses `none`;
`schema.get` uses `schema-resource`; `content.query` uses `content-query`;
every `changeset.*` capability uses `changeset-resources`; `audit.run` uses
`audit-selection`; `ops.status` uses `ops-selection`; `ops.plan` and
`ops.execute` use `ops-action`; incident, moderation, and security capability
families use `incident-target`, `moderation-target`, and `security-target`
respectively. A descriptor with a different mapping fails registration.

### 5.1 Exact domain-effect profiles

An effect profile describes mutation of the capability's domain target.
Framework bookkeeping required to make an invocation safe—invocation/run/audit
rows, immutable evidence, preview/audit artifacts, an ops plan, or a pending
approval—is not a domain mutation. That bookkeeping is still exact,
idempotent, transactional where required, retained, and audited; excluding it
from the effect profile does not permit it to fail open.

The v1 profile assignment is normative:

| Capability / input branch                                           | Resolved profile             | Domain effect and verification                                                              | Compensation                                                   |
| ------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `site.inspect`, `schema.get`, `content.query`, `changeset.get/list` | `domain.read`                | Read only                                                                                   | none                                                           |
| `changeset.create`                                                  | `changeset.draft-create`     | Persist one draft; verify exact id/version/hash                                             | cancel exact unexecuted draft via `changeset_draft` handle     |
| `changeset.validate`, `changeset.preview`, `audit.run`              | `domain.read`                | Domain read; sealed validation/preview/audit artifacts are framework bookkeeping            | none                                                           |
| `changeset.schedule`                                                | `changeset.schedule`         | Bind one approved schedule; verify queued/scheduled identity                                | none; cancellation is a separately authorized state transition |
| `changeset.apply`                                                   | `changeset.apply`            | Mutate exact sealed resources; verify committed target/convergence digests                  | none in generic API; separate rollback-plan/approval workflow  |
| `changeset.rollback` `prepare` or `request_approval`                | `domain.read`                | Domain read; rollback plan/approval rows are framework bookkeeping                          | none                                                           |
| `changeset.rollback` `execute_approved`                             | `changeset.rollback-execute` | Mutate exact compensation targets; verify result/convergence; this is itself a compensation | none; later changes require a new ChangeSet                    |
| `ops.status`, `ops.plan`, `incident.get/list`                       | `domain.read`                | Domain read; plan/evidence/approval rows are framework bookkeeping                          | none                                                           |
| `ops.execute`                                                       | `ops.execute`                | Execute only the three closed site-owned actions and verify their exact resulting state     | none; retry/cancel/revalidation is a new admitted operation    |
| `moderation.quarantine`                                             | `containment.create`         | Create exact quarantine containment and verify installed state                              | restore via server-owned `containment` handle                  |
| `moderation.restore`                                                | `containment.restore`        | Restore exact containment and verify current target                                         | none; re-quarantine requires a new proposal                    |
| `security.limitActor`                                               | `containment.create`         | Create expiring shared restriction and verify adapter installation                          | remove via server-owned `containment` handle                   |
| `security.revokeSessions`                                           | `sessions.revoke`            | Revoke the approved exact session family and verify persisted/session invalidation          | none                                                           |

Every row with a mutating profile declares the named verifier in its
descriptor/definition. The three compensatable rows additionally declare the
named compensator and derive only the listed opaque undo handle. Every
capability except `changeset.rollback` resolves one fixed named profile from
the table; rollback resolves `domain.read` for `prepare`/`request_approval`
and `changeset.rollback-execute` for `execute_approved`. A new branch is a
contract-version change. A completed read profile cannot return a mutation
receipt, and a mutation cannot complete without its receipt and verifier
outcome.

### 5.2 Exact input/output contract map

Every registry definition, OpenAPI `oneOf` branch, REST invocation, MCP tool,
and test fixture imports the following named pair. There is no generic
"operation + unknown JSON" fallback after capability selection.

| Capability                | Exact input                                                 | Exact completed output              |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `site.inspect`            | `NpAgentEmptyInputV1`                                       | `NpAgentSiteInspectOutputV1`        |
| `schema.get`              | `NpAgentSchemaGetInputV1`                                   | `NpAgentSchemaGetOutputV1`          |
| `content.query`           | `NpAgentContentQueryInputV1`                                | `NpAgentContentQueryOutputV1`       |
| `changeset.create`        | `NpAgentChangeSetCreateInputV1`                             | `NpAgentChangeSetOutputV1`          |
| `changeset.validate`      | `NpAgentChangeSetValidateInputV1`                           | `NpAgentChangeSetOutputV1`          |
| `changeset.preview`       | `NpAgentChangeSetPreviewInputV1`                            | `NpAgentChangeSetOutputV1`          |
| `changeset.schedule`      | `NpAgentChangeSetScheduleInputV1`                           | `NpAgentChangeSetOutputV1`          |
| `changeset.apply`         | `NpAgentChangeSetApplyInputV1`                              | `NpAgentChangeSetOutputV1`          |
| `changeset.rollback`      | `NpAgentChangeSetRollbackInputV1`                           | `NpAgentChangeSetOutputV1`          |
| `changeset.get`           | `NpAgentChangeSetGetInputV1`                                | `NpAgentChangeSetOutputV1`          |
| `changeset.list`          | `NpAgentChangeSetListInputV1`                               | `NpAgentChangeSetListOutputV1`      |
| `audit.run`               | `NpAgentAuditRunInputV1`                                    | `NpAgentAuditRunOutputV1`           |
| `ops.status`              | `NpAgentOpsStatusInputV1`                                   | `NpAgentOpsStatusOutputV1`          |
| `ops.plan`                | `NpAgentOpsPlanInputV1`                                     | `NpAgentOpsPlanOutputV1`            |
| `ops.execute`             | `NpAgentOpsExecuteInput`                                    | `NpAgentOpsExecuteOutputV1`         |
| `incident.get`            | `NpAgentIncidentGetInputV1`                                 | `NpAgentIncidentOutputV1`           |
| `incident.list`           | `NpAgentIncidentListInputV1`                                | `NpAgentIncidentListOutputV1`       |
| `moderation.quarantine`   | `NpAgentDirectActionInput<NpAgentQuarantineProposalV1>`     | `NpAgentContainmentCreateOutputV1`  |
| `moderation.restore`      | `NpAgentDirectActionInput<NpAgentRestoreProposalV1>`        | `NpAgentContainmentRestoreOutputV1` |
| `security.limitActor`     | `NpAgentDirectActionInput<NpAgentLimitActorProposalV1>`     | `NpAgentContainmentCreateOutputV1`  |
| `security.revokeSessions` | `NpAgentDirectActionInput<NpAgentRevokeSessionsProposalV1>` | `NpAgentSessionRevokeOutputV1`      |

The table's input is the domain payload nested in one exact public transport
projection:

```ts
interface NpAgentInputByCapability {
  "site.inspect": NpAgentEmptyInputV1;
  "schema.get": NpAgentSchemaGetInputV1;
  "content.query": NpAgentContentQueryInputV1;
  "changeset.create": NpAgentChangeSetCreateInputV1;
  "changeset.validate": NpAgentChangeSetValidateInputV1;
  "changeset.preview": NpAgentChangeSetPreviewInputV1;
  "changeset.schedule": NpAgentChangeSetScheduleInputV1;
  "changeset.apply": NpAgentChangeSetApplyInputV1;
  "changeset.rollback": NpAgentChangeSetRollbackInputV1;
  "changeset.get": NpAgentChangeSetGetInputV1;
  "changeset.list": NpAgentChangeSetListInputV1;
  "audit.run": NpAgentAuditRunInputV1;
  "ops.status": NpAgentOpsStatusInputV1;
  "ops.plan": NpAgentOpsPlanInputV1;
  "ops.execute": NpAgentOpsExecuteInput;
  "incident.get": NpAgentIncidentGetInputV1;
  "incident.list": NpAgentIncidentListInputV1;
  "moderation.quarantine": NpAgentDirectActionInput<NpAgentQuarantineProposalV1>;
  "moderation.restore": NpAgentDirectActionInput<NpAgentRestoreProposalV1>;
  "security.limitActor": NpAgentDirectActionInput<NpAgentLimitActorProposalV1>;
  "security.revokeSessions": NpAgentDirectActionInput<NpAgentRevokeSessionsProposalV1>;
}

type NpAgentNoIdempotencyCapabilityId =
  | "site.inspect"
  | "schema.get"
  | "content.query"
  | "changeset.get"
  | "changeset.list"
  | "ops.status"
  | "incident.get"
  | "incident.list";

type NpAgentCapabilityArguments<C extends NpAgentCapabilityId> =
  C extends NpAgentNoIdempotencyCapabilityId
    ? { input: NpAgentInputByCapability[C]; idempotencyKey: null }
    : { input: NpAgentInputByCapability[C]; idempotencyKey: string };

type NpAgentCapabilityInvocationRequest = {
  [C in NpAgentCapabilityId]: {
    schemaVersion: "np.agent-invocation-request.v1";
    capabilityId: C;
    arguments: NpAgentCapabilityArguments<C>;
  };
}[NpAgentCapabilityId];
```

The REST invocation body is the closed discriminated request union above. An
MCP tool mapped to capability `C` exposes exactly
`NpAgentCapabilityArguments<C>` as its argument schema and does not repeat the
capability id/schema version. The shared parser then produces
`NpAgentNormalizedCapabilityInvocationRequest`; callers cannot submit that
internal flattened form. The eight direct read branches require the literal
`idempotencyKey:null`; every other branch requires a validated non-null key.
Descriptor startup tests prove this conditional set matches the
execution/idempotency table, so changing either side alone fails.

The normative wrapper shapes are:

```ts
type NpAgentEmptyInputV1 = Record<string, never>;

interface NpAgentSiteInspectOutputV1 {
  schemaVersion: "np.agent-site-inspect.v1";
  site: {
    id: string;
    name: string;
    defaultLocale: string;
    locales: string[];
  };
  features: {
    remoteMcp: boolean;
    agentHttp: boolean;
    runtime: "disabled" | "ready" | "paused" | "degraded";
  };
  counts: {
    collections: number;
    blocks: number;
    activePlugins: number;
  };
  resourceUris: string[];
}

type NpAgentSchemaGetInputV1 =
  | { selector: "catalog" }
  | { selector: "collection"; slug: string }
  | { selector: "blocks" }
  | { selector: "block"; type: string };

interface NpAgentSchemaGetOutputV1 {
  schemaVersion: "np.agent-schema-resource.v1";
  selector: NpAgentSchemaGetInputV1;
  digest: string;
  schema: NpAgentJsonSchema;
}

type NpAgentContentScalar = string | number | boolean | null;
type NpAgentContentFilterV1 =
  | {
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      field: string;
      value: NpAgentContentScalar;
    }
  | { op: "in"; field: string; values: NpAgentContentScalar[] }
  | { op: "exists"; field: string; value: boolean }
  | { op: "all" | "any"; terms: NpAgentContentFilterV1[] };

interface NpAgentContentQueryInputV1 {
  collection: string;
  filter: NpAgentContentFilterV1 | null;
  fields: string[];
  audience: "public" | "member" | "private";
  status: "draft" | "published" | "any";
  sort: Array<{ field: string; direction: "asc" | "desc" }>;
  limit: number;
  cursor: string | null;
}

interface NpAgentContentDocumentV1 {
  id: string;
  slug: string | null;
  status: "draft" | "published" | "archived";
  locale: string | null;
  version: string;
  digest: string;
  updatedAt: string;
  data: NpAgentJsonObject;
}

interface NpAgentContentQueryOutputV1 {
  schemaVersion: "np.agent-content-query.v1";
  collection: string;
  items: NpAgentContentDocumentV1[];
  nextCursor: string | null;
}

interface NpAgentChangeSetCreateInputV1 {
  title: string;
  summary: string | null;
  operations: NpAgentChangeSetOperationInput[];
}

interface NpAgentChangeSetValidateInputV1 {
  changeSetId: string;
  draftVersion: number;
  draftHash: string;
}

interface NpAgentChangeSetPreviewInputV1 {
  changeSetId: string;
  planHash: string;
}

interface NpAgentChangeSetScheduleInputV1 {
  changeSetId: string;
  planHash: string;
  scheduledFor: string;
  approvalId: string | null;
}

interface NpAgentChangeSetApplyInputV1 {
  changeSetId: string;
  planHash: string;
  approvalId: string | null;
}

type NpAgentChangeSetRollbackInputV1 =
  | {
      mode: "prepare";
      changeSetId: string;
    }
  | {
      mode: "request_approval";
      changeSetId: string;
      rollbackPlanId: string;
      planHash: string;
    }
  | {
      mode: "execute_approved";
      changeSetId: string;
      rollbackPlanId: string;
      planHash: string;
      approvalId: string;
    };

interface NpAgentChangeSetGetInputV1 {
  changeSetId: string;
}

interface NpAgentChangeSetListInputV1 {
  states: NpAgentChangeSetState[];
  actorKinds: Array<"runtime" | "external" | "staff">;
  createdAfter: string | null;
  createdBefore: string | null;
  limit: number;
  cursor: string | null;
}

interface NpAgentChangeSetOutputV1 {
  schemaVersion: "np.agent-changeset-result.v1";
  changeSet: NpAgentChangeSetWire;
}

interface NpAgentChangeSetListOutputV1 {
  schemaVersion: "np.agent-changeset-list.v1";
  items: NpAgentChangeSetWire[];
  nextCursor: string | null;
}

const npAgentAuditCheckFamilies = [
  "contracts",
  "content",
  "links",
  "seo",
  "accessibility",
  "jobs",
  "storage",
  "plugins",
  "security",
] as const;
type NpAgentAuditCheckFamily = (typeof npAgentAuditCheckFamilies)[number];

interface NpAgentAuditRunInputV1 {
  families: NpAgentAuditCheckFamily[];
  collections: string[];
  maxTargets: number;
}

interface NpAgentAuditRunOutputV1 {
  schemaVersion: "np.agent-audit.v1";
  auditId: string;
  state: "completed";
  checks: Array<{
    id: string;
    family: NpAgentAuditCheckFamily;
    status: "pass" | "warn" | "fail" | "unknown";
    evidenceRefs: string[];
  }>;
  digest: string | null;
}

const npAgentOpsCheckFamilies = [
  "readiness",
  "jobs",
  "storage",
  "backup",
  "plugins",
  "cache",
  "agents",
] as const;
type NpAgentOpsCheckFamily = (typeof npAgentOpsCheckFamilies)[number];

interface NpAgentOpsStatusInputV1 {
  families: NpAgentOpsCheckFamily[];
}

interface NpAgentOpsStatusOutputV1 {
  schemaVersion: "np.agent-ops-status.v1";
  report: NpOpsStatusV1;
  digest: string;
}

type NpAgentOpsTargetV1 =
  | { kind: "site" }
  | { kind: "collection"; collection: string }
  | { kind: "document"; collection: string; documentSlug: string }
  | { kind: "navigation"; location: string }
  | { kind: "run"; runId: string }
  | { kind: "backup"; manifestId: string }
  | { kind: "storage"; adapterId: string }
  | {
      kind: "plugin";
      pluginId: string;
      operation: "enable" | "disable" | "upgrade";
    }
  | {
      kind: "queue";
      operation: "pause" | "drain" | "retry-failed";
      jobName: string | null;
    };

type NpAgentOpsPlanInputV1 =
  | {
      action: "cache.revalidate";
      target:
        | { kind: "site" }
        | { kind: "collection"; collection: string }
        | { kind: "document"; collection: string; documentSlug: string }
        | { kind: "navigation"; location: string };
    }
  | {
      action: "agent.run.retry" | "agent.run.cancel";
      target: { kind: "run"; runId: string };
    }
  | {
      action: "migration.plan";
      target: { kind: "site" };
    }
  | {
      action: "restore.plan";
      target: { kind: "backup"; manifestId: string };
    }
  | {
      action: "storage.migration.plan";
      target: { kind: "storage"; adapterId: string };
    }
  | {
      action: "plugin.change.plan";
      target: {
        kind: "plugin";
        pluginId: string;
        operation: "enable" | "disable" | "upgrade";
      };
    }
  | {
      action: "queue.global.plan";
      target: {
        kind: "queue";
        operation: "pause" | "drain" | "retry-failed";
        jobName: string | null;
      };
    };

type NpAgentExecutableOpsPlanInputV1 = Extract<
  NpAgentOpsPlanInputV1,
  { action: NpAgentExecutableOpsActionId }
>;

type NpAgentPlanOnlyOpsPlanInputV1 = Extract<
  NpAgentOpsPlanInputV1,
  { action: NpAgentPlanOnlyOpsActionId }
>;

interface NpAgentOpsPlanOutputCommonV1 {
  schemaVersion: "np.agent-ops-plan.v1";
  planId: string;
  planDigest: string;
  checks: Array<{ id: string; status: "pass" | "warn" | "fail" }>;
  expiresAt: string;
}

type NpAgentOpsPlanOutputV1 =
  | (NpAgentOpsPlanOutputCommonV1 & {
      operation: NpAgentExecutableOpsPlanInputV1;
      execution: {
        kind: "agent-executable";
        approvalId: string;
        approvalResource: string;
      };
    })
  | (NpAgentOpsPlanOutputCommonV1 & {
      operation: NpAgentPlanOnlyOpsPlanInputV1;
      execution: {
        kind: "local-cli-handoff";
        contractId: string;
        planArtifactId: string;
        projectCommand: string;
      };
    });

interface NpAgentOpsExecuteOutputV1 {
  schemaVersion: "np.agent-ops-execution.v1";
  planId: string;
  action: NpAgentExecutableOpsActionId;
  state: "succeeded" | "failed" | "conflicted";
  resultDigest: string;
  verificationRefs: string[];
}

interface NpAgentIncidentGetInputV1 {
  incidentId: string;
}

interface NpAgentIncidentListInputV1 {
  statuses: NpAgentIncidentState[];
  categories: NpAgentIncidentCategory[];
  severities: Array<"info" | "low" | "medium" | "high" | "critical">;
  updatedAfter: string | null;
  limit: number;
  cursor: string | null;
}

interface NpAgentIncidentOutputV1 {
  schemaVersion: "np.agent-incident-result.v1";
  incident: NpAgentIncidentV1;
}

interface NpAgentIncidentListOutputV1 {
  schemaVersion: "np.agent-incident-list.v1";
  items: NpAgentIncidentV1[];
  nextCursor: string | null;
}

interface NpAgentQuarantineProposalV1 {
  incidentId: string | null;
  target: { kind: "comment" | "document"; collection: string; id: string };
  expectedVersionDigest: string;
  reasonCode: string;
}

interface NpAgentRestoreProposalV1 {
  containmentKind: "content_quarantine";
  containmentId: string;
  expectedVersionDigest: string;
}

interface NpAgentLimitActorProposalV1 {
  incidentId: string;
  actorRef:
    | { kind: "incident-subject" }
    | {
        kind: "principal";
        principalKind: "staff" | "member" | "agent-gateway";
        principalId: string;
      };
  actionScopes: NpAgentActorRestrictionScope[];
  ttlSeconds: number;
  expectedSubjectVersionDigest: string;
}

interface NpAgentRevokeSessionsProposalV1 {
  incidentId: string;
  actor: {
    kind: "staff" | "member";
    actorId: string;
    sessionFamilyId: string;
  };
  expectedVersionDigest: string;
}

interface NpAgentDirectActionOutputCommonV1 {
  schemaVersion: "np.agent-direct-action.v1";
  actionId: string;
  resultDigest: string;
  verificationRefs: string[];
}

type NpAgentContainmentCreateOutputV1 =
  | (NpAgentDirectActionOutputCommonV1 & {
      state: "succeeded";
      containmentId: string;
    })
  | (NpAgentDirectActionOutputCommonV1 & {
      state: "failed";
      containmentId: string | null;
    });

type NpAgentContainmentRestoreOutputV1 =
  | (NpAgentDirectActionOutputCommonV1 & {
      state: "compensated";
      containmentId: string;
    })
  | (NpAgentDirectActionOutputCommonV1 & {
      state: "failed";
      containmentId: string;
    });

type NpAgentSessionRevokeOutputV1 = NpAgentDirectActionOutputCommonV1 & {
  state: "succeeded" | "failed";
  containmentId: null;
};
```

`NpAgentChangeSet*`, `NpAgentIncident*`, `NpAgentSubject`,
`NpAgentActorRestrictionScope`, and `NpOpsStatusV1` are the same normative
client-safe contracts owned by the linked ChangeSet, Runtime/Guardian, and
shipped `np.ops.v1` documents—not lookalike transport types. Dynamic collection
`data` is reparsed by the selected live generated collection schema; requested
fields/filter paths must exist and be readable.

Filters are at most four levels/32 terms; `in` has at most 100 unique values;
field/sort lists have at most 100 unique entries; sorts have at most 5 keys.
List limits use the global 20/100 pagination contract. Audit selects 1–9 unique
families, at most 64 collections and 1,000 targets. ChangeSet operation and
full-plan rollback limits come from the ChangeSet contract. Empty or unknown
enum arrays, undeclared fields, cross-site ids, unsafe integers, and unknown
object keys fail closed.

`changeset.rollback` is one mode-discriminated capability to avoid adding
transport-only ids. Its base descriptor permits plan preparation and approval
request, but the registry has a locked derivation rule:
`mode:"execute_approved"` raises risk to `sensitive` and approval to `human`
and requires the exact rollback plan/hash/approval. No site policy can lower
that branch. `ops.plan` action/target combinations are discriminated exactly as
shown. Executable plans create a pending approval reference; plan-only actions
return a server-owned shipped ops contract/artifact/command handoff and can
never enter `ops.execute`. `security.limitActor` never accepts a
caller-created bucket/key: `incident-subject` resolves the current normalized
incident subject, and `principal` is resolved server-side to the enforcement
key.

### 5.3 ChangeSet resource-derived scopes

`changeset:*` scopes authorize the proposal workflow only. They never authorize
the resources inside it.

| ChangeSet operation target | Create/edit requirement                                           | Validate/preview/read requirement | Schedule/apply/rollback requirement             |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| document                   | `content:draft`                                                   | `content:read` plus row policy    | `content:publish` plus current row policy       |
| media reference            | `media:read` plus `media:write` for every persisted attach/detach | `media:read`                      | `media:write` for every persisted attach/detach |
| navigation                 | `navigation:write`                                                | `navigation:read`                 | `navigation:write`                              |
| theme tokens               | `theme:write`                                                     | `theme:read`                      | `theme:write`                                   |
| allowlisted setting        | `settings:write`                                                  | `settings:read`                   | `settings:write`                                |

The registry derives the union across all operations and requires every scope.
Create, validate, preview, approval, schedule/apply, and rollback each derive
again from the immutable stored operations. A descriptor or model-provided
scope list is never trusted.

`changeset.list` omits rows whose included targets the caller cannot view.
`changeset.get` fails closed when any included target is not visible; it does
not return a partially redacted proposal that could hide an approved side
effect.

### 5.4 Direct security action semantics

The actor-restriction inventory and bounds are frozen in `agent-contract`:

```ts
export const npAgentActorRestrictionScopes = [
  "auth.staff",
  "auth.member",
  "agent.gateway",
  "community.write",
  "content.write",
] as const;

export type NpAgentActorRestrictionScope = (typeof npAgentActorRestrictionScopes)[number];

export const NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS = 60;
export const NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS = 15 * 60;
export const NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS = 60 * 60;
```

The proxy/API layer owns one exhaustive route/operation-to-scope map generated
from this same inventory. Unknown strings, empty selections, caller-supplied
paths, or a TTL outside the inclusive bounds fail validation; policy may only
shorten the maximum. Doctor and tests compare the capability and enforcement
maps so an admitted restriction cannot become an unenforced label.

`moderation.quarantine` and `security.limitActor` return an opaque,
site-scoped `containmentId` backed by the shared containment row.
`moderation.restore` is closed to `containmentKind:"content_quarantine"` and
rejects an actor restriction before scope derivation; moderation authority can
never remove a security control. It accepts that handle plus expected
containment version, not a newly model-authored target or restoration body.
The restore action links `compensatesActionId` to the source action and uses
the server-owned original state with compare-and-swap. Actor restriction
removal occurs only through TTL expiry, the server-internal
`security.limitActor` compensator under the same security policy, or the
Admin incident restore operation with `admin.manage` and current security
authorization. Active containment retains its source action, approval,
incident evidence, and restore material beyond nominal history retention.

`security.limitActor` writes a durable, site-scoped restriction with an exact
expiry. The proxy/rate-limit entrypoint must read the same shared enforcement
contract in every node. If no shared enforcement adapter is installed, the
capability is unavailable and `ops.plan` may only propose the manual response;
a worker must never pretend that mutating its own memory protected the site.
Its input accepts only a same-site incident/subject reference or exact
authenticated principal id plus an allowlisted action family and TTL. It never
accepts a raw IP, email, route pattern, HMAC key id, or caller-computed bucket;
the server resolves the current opaque enforcement key.

`security.revokeSessions` revokes every NexPress browser session in the exact
selected actor/principal session family. It is not “clear the current cookie,”
and it is not an unconstrained all-users operation. The server classifies
impact as current-site or deployment. A staff/global/cross-site-capable family
adds the exact `is-super-admin` human predicate to the approval statement;
site `admin.manage` alone is insufficient. The predicate, impact digest, and
affected-site count are server-derived and rechecked at decision/execution.
Human approval is always required.

## 6. Registry behavior

### 6.1 Registration

The registry is process-global because capability code is deployed code.
Authorization and policy are resolved per site. Plugin activation may change
the schemas and hooks a framework capability observes, but it does not add or
remove v1 capability ids.

Registration rules:

1. Analyze the complete descriptor, schemas, parsers, handler, source, and
   effect metadata before insertion.
2. Require the descriptor id and source namespace to agree.
3. Compile input/output validators once.
4. Require all static scopes to exist in `npAgentScopes`.
5. Reject a capability whose resolved effect profile is absent from its
   descriptor or inconsistent with its bootstrap/result contract.
6. Reject a mutation without required idempotency or a read-side verifier.
7. Reject a `compensatable` profile without typed undo derivation and a
   matching compensator, or a `none` profile that declares either.
8. Reject `approval: "none"` for sensitive/destructive effects.
9. Require every non-null Gateway projection to have a sorted unique non-empty
   transport set and at least one effect profile with a valid non-disabled
   minimum exposure. A null Gateway requires every effect profile exposure to
   be null. A Gateway-projected mutation profile cannot have `read` as its
   minimum. Require every MCP master-tool mapping and each input-selected
   profile minimum to match the locked table above.
10. Same source + same definition fingerprint may register again for HMR.
11. Same id + a different fingerprint is a startup error. There is no
    last-write-wins behavior for security contracts.
12. Registry listing returns immutable, sorted descriptor copies.

Framework definitions register after the existing plugin host is ready, so
their schema/discovery dependencies see the resolved runtime. Plugins do not
register agent capability definitions in v1.

### 6.2 Invocation order

The order is fixed:

```text
parse request envelope
  → resolve definition
  → parse exact input
  → resolve principal and explicit site
  → intersect transport/deployment/site/credential exposure
  → check static scopes and current staff authority
  → derive target/scopes/risk/approval
  → authorize every resource
  → evaluate enabled state, policy, quota, and budget
  → reserve idempotency/admission row
  → persist audit start
  → execute inline or enqueue durable run
  → parse exact output
  → persist result/audit completion
  → return
```

Mutations fail closed if idempotency or audit persistence is unavailable.
Output validation happens before marking an invocation `completed` or a run
`succeeded`.

## 7. MCP server profile

V1 targets the current
[MCP `2025-11-25` specification](https://modelcontextprotocol.io/specification/2025-11-25)
and negotiates through normal initialization. The official
[versioning page](https://modelcontextprotocol.io/docs/learn/versioning) lists
`2025-11-25` as the current protocol at this design baseline. Before
implementation starts, the team must recheck that page and the selected
TypeScript SDK's supported versions; adopting a later current/draft revision
is a separate compatibility task, not an implicit documentation update.

The v1 server implements tools, resources, prompts, opaque pagination, and the
negotiated experimental task utility. It does not request client sampling,
roots, or arbitrary elicitation.

MCP annotations are usability hints only. NexPress authorization and policy
never trust a client confirmation or a tool's `destructiveHint`.

### 7.1 Bounded tool inventory and exposure profiles

Tool names are stable snake_case strings. A core capability addition does not
automatically add a tool.

The full v1 master inventory remains 18 tools. Exposure profiles do not remove
functionality: an explicitly enabled `approved-execute` transport with the
required principal scopes can discover and call all 18 tools, subject to the
same policy, resource, idempotency, and approval checks as every other caller.
Lower profiles deliberately project a subset. When one tool has proposal and
effecting input branches, `tools/list` uses the least exposure of its externally
projectable effect profiles, while invocation reparses the input, resolves its
exact effect profile, and requires that profile's higher ceiling before any
approval consumption or handler execution:

| MCP tool                  | Capability dispatch        | Listed from        | Notes                                            |
| ------------------------- | -------------------------- | ------------------ | ------------------------------------------------ |
| `inspect_site`            | `site.inspect`             | `read`             | safe site summary plus resource links            |
| `query_content`           | `content.query`            | `read`             | exact collection, filters, fields, opaque cursor |
| `create_changeset`        | `changeset.create`         | `propose`          | no direct production write                       |
| `validate_changeset`      | `changeset.validate`       | `propose`          | immutable version/hash required                  |
| `preview_changeset`       | `changeset.preview`        | `propose`          | returns/queues preview artifacts                 |
| `schedule_changeset`      | `changeset.schedule`       | `propose`          | approval request at propose; effect at execute   |
| `apply_changeset`         | `changeset.apply`          | `propose`          | approval request at propose; does not approve    |
| `rollback_changeset`      | `changeset.rollback`       | `propose`          | prepare/request at propose; effect at execute    |
| `query_changesets`        | `changeset.get` or `.list` | `read`             | exact discriminated `by_id` / `list` selector    |
| `run_site_audit`          | `audit.run`                | `read`             | bounded check families; durable by default       |
| `get_ops_status`          | `ops.status`               | `read`             | reuses shipped exact ops evidence                |
| `plan_ops_action`         | `ops.plan`                 | `propose`          | allowlisted site action only                     |
| `execute_approved_action` | `ops.execute`              | `approved-execute` | exact plan/hash/approval; never shell text       |
| `query_incidents`         | `incident.get` or `.list`  | `read`             | exact discriminated selector                     |
| `quarantine_content`      | `moderation.quarantine`    | `propose`          | proposal first; reversible effect at execute     |
| `restore_content`         | `moderation.restore`       | `propose`          | proposal first; restore effect at execute        |
| `temporarily_limit_actor` | `security.limitActor`      | `propose`          | proposal first; capped TTL effect at execute     |
| `revoke_sessions`         | `security.revokeSessions`  | `propose`          | proposal first; exact effect at execute          |

`schema.get` is projected through MCP resources instead of another tool.

After base authentication, `tools/list` returns the deterministic sorted
intersection of:

```text
shipped master inventory
  ∩ capability transport allowlist
  ∩ deployment exposure ceiling
  ∩ site exposure ceiling
  ∩ credential/grant exposure ceiling
  ∩ principal granted scopes
  ∩ currently enabled site capability policy
```

Target-specific authorization is still repeated on every call. A hidden tool
cannot be invoked by guessing its name. Transport/mode/policy exclusion is the
same non-oracular unavailable result as an unknown tool; when the transport and
mode admit the tool and only an OAuth principal scope is missing, a direct
known call may return the exact insufficient-scope challenge without executing
the handler. Service credentials receive the bounded forbidden result. A
listed tool's higher effect branch returns a stable exposure-policy denial when
its resolved profile exceeds the credential ceiling; it never turns listing
into execution authority. A tool that loses scope or mode between listing and
invocation fails closed. The capability catalog resource publishes only the
same effective projection with required scopes, risk, approval, and
idempotency metadata.
Admin consent and principal-management UI, not an overbroad MCP list, are where
an operator reviews grantable authority.

All inputs have exact object schemas using the shared
`{ input, idempotencyKey }` projection above. Every mutation and durable or
cost-bearing read includes a non-null `idempotencyKey`; tools do not derive one
from the JSON-RPC id. Tool output schemas are exact unions of completed,
accepted, approval-required, and structured error results with a
capability-specific `output` branch.

Recommended annotations are generated from the descriptor:

```ts
interface NpMcpToolProjection {
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  execution: {
    taskSupport: "forbidden" | "optional";
  };
}
```

No v1 tool has required task support, so a compatible client without the
experimental task utility can receive an accepted run reference and poll a
normal resource. `ops.execute` and `revoke_sessions` set
`destructiveHint: true`; this hint does not replace server approval.

### 7.2 Resources

Resource listing is a bounded catalog, not a dump of site content. These
templates are initially supported:

```text
nexpress://site/{siteId}/summary
nexpress://site/{siteId}/capabilities
nexpress://site/{siteId}/schema
nexpress://site/{siteId}/schema/collections/{slug}
nexpress://site/{siteId}/schema/blocks
nexpress://site/{siteId}/plugins
nexpress://site/{siteId}/agent-policy
nexpress://site/{siteId}/changesets/{changesetId}
nexpress://site/{siteId}/agent-previews/{previewId}/artifacts/{artifactId}
nexpress://site/{siteId}/incidents/{incidentId}
nexpress://site/{siteId}/runs/{runId}
```

| Resource family                             | Required scope                                                  |
| ------------------------------------------- | --------------------------------------------------------------- |
| summary, capability catalog, plugin catalog | `site:read`                                                     |
| aggregate/collection/block schema           | `schema:read`                                                   |
| effective Agent Policy                      | `settings:read`                                                 |
| ChangeSet                                   | `changeset:read` plus included-target visibility                |
| preview artifact                            | `changeset:read` plus every included-target visibility          |
| incident                                    | `incident:read` plus target visibility                          |
| run                                         | `site:read` plus owning principal, or matching Admin visibility |

Rules:

- list/read requires an effective exposure of at least `read`; catalogs omit
  entries whose backing capability or required scope is outside the current
  transport projection;
- `{siteId}` must equal the authenticated principal's site.
- Catalog metadata reuses exact discovery contracts and omits handlers,
  access callbacks, config secrets, credentials, hidden policy rules, and raw
  logs.
- Instance templates are read on demand. `resources/list` never enumerates
  every document, run, ChangeSet, or incident.
- Content search remains `query_content`; arbitrary document bodies are not
  exposed as an unbounded resource list.
- JSON resources use `application/json` and exact wire contracts.
- A preview-artifact read requires its same-site preview to remain
  `ready`/unexpired, plan/digest to match, and every ChangeSet target to remain
  visible. It returns only exact MIME `image/png`, `image/webp`, or
  `application/json`; screenshot blobs are at most 2 MiB and report text at
  most 512 KiB. Larger artifacts fail generation and are never converted into
  a storage-signed URL.
- Preview tools return the artifact resource URI/digest metadata rather than
  oversized base64 results; `resources/read` performs the live authorization
  and returns one bounded MCP resource-content item. It never returns an HTTP
  stream or storage redirect.
- A resource URI is a reference, not authority; every read repeats scope,
  site, ownership, and visibility checks.

The exact artifact `ReadResourceResult` projection for MCP 2025-11-25 is:

```ts
interface NpAgentMcpArtifactResourceMetaV1 {
  schemaVersion: "np.agent-mcp-artifact-resource-meta.v1";
  artifactId: string;
  contentDigest: string;
  previewManifestDigest: string;
  bytes: number;
}

type NpAgentMcpArtifactReadResultV1 = {
  contents: [
    | {
        uri: string;
        mimeType: "image/png" | "image/webp";
        blob: string;
      }
    | {
        uri: string;
        mimeType: "application/json";
        text: string;
      },
  ];
  _meta: {
    "nexpress/artifact": NpAgentMcpArtifactResourceMetaV1;
  };
};
```

For images, `blob` is RFC 4648 canonical base64 with required `=` padding and
no whitespace; its decoded length and content digest must match metadata. For
reports, `text` is the exact canonical UTF-8 `NpAgentPreviewReportV1` decoded
with fatal UTF-8 handling and reparsed before return. The one-item JSON-RPC
result, after JSON encoding, is at most 4 MiB; an artifact that cannot satisfy
that projection fails generation rather than truncating on read. The URI
contains only site/preview/artifact ids. `contentDigest` is server-loaded
integrity metadata and an HTTP ETag, never a caller-supplied authorization or
MCP precondition.

### 7.3 Prompts

Prompts are optional, user-selected workflow starters:

| Prompt                              | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `nexpress_content_maintenance`      | find stale content and prepare a previewed ChangeSet             |
| `nexpress_moderation_review`        | review a bounded moderation queue and propose quarantine/restore |
| `nexpress_ops_triage`               | collect site ops evidence and prepare an allowlisted plan        |
| `nexpress_security_incident_review` | summarize one incident and propose reversible response           |

Prompt arguments are short identifiers and bounded goals, not raw log/content
dumps. `prompts/list` includes a starter only when its required read/propose/
execute tools are in the current effective projection. Prompt messages:

- identify public content/log fields as untrusted evidence;
- instruct the client to use resources and tools;
- never include secrets, hidden policy text, bearer tokens, approval tokens,
  or provider credentials;
- cannot create an approval, raise a scope, or alter a tool schema.

Plugins cannot add MCP prompts in v1.

## 8. Local stdio transport

The stdio server is intended for a locally running client connected to a
checked-out NexPress project.

```text
MCP client
  → child process stdin/stdout
  → @nexpress/mcp stdio adapter
  → project bootstrap + shared capability invoker
```

This is the local-first MCP shape. It opens no TCP listener or MCP port; the
client owns the child process and exchanges frames only through stdin/stdout.

Requirements:

- credentials are read from environment, consistent with the MCP stdio
  authorization guidance;
- `NP_AGENT_SERVICE_TOKEN` is an opaque, site-bound service credential stored
  hashed by NexPress and shown only at creation;
- the token is never accepted as a command-line flag, printed, or written to a
  generated config file;
- stdout contains MCP frames only; logs and diagnostics go to stderr;
- the credential determines the site. `NP_AGENT_SITE_ID` cannot override it;
- the adapter uses the normal `ensureFor()` and terminal bootstrap shutdown;
- local transport does not bypass scope, policy, idempotency, audit, approval,
  or quota because it is on the same machine.

The stdio credential also freezes a `read`, `propose`, or
`approved-execute` ceiling and defaults to `read`. An operator may explicitly
issue a broader stdio credential, so the local transport retains the full
18-tool feature set without making that authority implicit.

The stdio adapter does not proxy a client token to a remote NexPress server.
Use the remote OAuth flow for a remote site.

## 9. Remote Streamable HTTP transport

The proposed endpoint is:

```text
POST /api/mcp
```

NexPress does not define or accept a dedicated MCP port. When enabled, this
path is mounted on the existing canonical HTTPS site origin and therefore uses
the deployment's normal TLS listener, reverse proxy, WAF, request limits, and
observability. It never starts a standalone public listener or binds an MCP
server to `0.0.0.0`. A deployment may additionally restrict the path through a
private ingress, VPN, mTLS gateway, or IP allowlist, but those controls never
replace NexPress authentication and authorization.

Remote MCP is absent by default. Unless deployment intent, the site's selected
exposure mode, canonical origin, OAuth signing/JWKS, consent, and audience
configuration are all valid, `/api/mcp`, its protected-resource metadata, and
Agent Gateway authorization discovery return the same deliberate `404` and do
not reveal a partially configured surface. V1 does not add a NexPress-hosted
relay or automatic tunnel. The supported profiles are `read`, `propose`, and
`approved-execute`; the last preserves the full bounded tool inventory but
does not itself satisfy any capability approval requirement.

It runs in the Node.js runtime. Initial v1 is stateless and polling-oriented:

- POST accepts exactly one MCP JSON-RPC message. A request returns one
  `application/json` JSON-RPC object; an accepted notification or response
  returns `202` with no body;
- clients send an `Accept` header listing both `application/json` and
  `text/event-stream`, even though this initial server chooses the JSON branch
  for requests;
- GET returns `405` until resumable server-initiated SSE is implemented;
- DELETE returns `405` because v1 does not issue `MCP-Session-Id`;
- initialization still negotiates a supported protocol version, and every
  subsequent HTTP request follows the specification's
  `MCP-Protocol-Version` header and unsupported-version behavior;
- tasks/runs are durable in Postgres, so no sticky session is required;
- a disconnect is not cancellation.

A later SSE implementation must replay only bounded agent status events from
the persisted event/outbox contract. It must not stream raw request logs or
provider transcripts.

The route validates request content type, size, JSON-RPC shape, protocol
version, `Origin`, and canonical Host before parsing tool input. In production,
the v1 rule is closed:

- an `Origin` header, when present, must contain exactly the configured
  canonical HTTPS site origin; `null`, multiple, malformed, foreign, wildcard,
  subdomain-suffix, and redirect-derived values are rejected;
- a missing `Origin` is accepted only after a valid header-borne Agent Gateway
  OAuth access token or exact `mcp-http` service credential authenticates the
  request; no user-agent/header heuristic attempts to decide whether it is a
  browser;
- CORS preflight and response headers name only that canonical origin and
  never use `*`; cookie credentials are not enabled;
- canonical Host/forwarded-host resolution comes only from the deployment's
  existing trusted-proxy/origin contract and must equal the token resource/
  audience host.

There is no v1 “non-browser policy” setting or per-client Origin wildcard.
These rules run before JSON-RPC/tool parsing and prevent DNS-rebinding from
turning a valid local browser session into Agent Gateway authority.

## 10. Remote authentication profile

Every remote MCP method is protected; there are no anonymous MCP tools or
resources.

For an interactive MCP client, NexPress owns both sides of the Agent Gateway
authorization boundary:

- `/api/mcp` is the OAuth 2.1 resource server;
- the built-in NexPress Authorization Server owns the authorize/token
  endpoints, site/scope consent, grant, access-token issuer, refresh rotation,
  and revocation;
- an external OIDC provider may authenticate the staff user inside that
  authorize flow, but it never issues Agent Gateway access/refresh tokens or
  agent scope grants.

The built-in server implements the current MCP authorization profile:

- Protected Resource Metadata at the endpoint-specific well-known path and
  root fallback;
- `WWW-Authenticate: Bearer` with `resource_metadata` on `401`;
- NexPress authorization-server metadata discovery;
- Authorization Code with PKCE `S256` for user delegation;
- exact redirect URI matching and `state`;
- `resource` in authorization and token requests;
- access-token audience equal to the canonical site MCP URI
  `https://<site-host>/api/mcp`;
- short-lived access tokens and rotating refresh tokens;
- an immutable grant exposure ceiling included in consent, authorization code,
  refresh family, and access-token claims;
- bearer token in the `Authorization` header on every request, never query
  string, cookie, or MCP arguments;
- `401` for missing/invalid/expired/wrong-audience tokens;
- `403` plus `error="insufficient_scope"`, exact `scope`, and
  `resource_metadata` for step-up.

The v1 endpoint map is fixed as:

```text
GET  /.well-known/oauth-protected-resource/api/mcp
GET  /.well-known/oauth-protected-resource
GET  /.well-known/oauth-authorization-server
GET|POST /api/agent-oauth/authorize
POST /api/agent-oauth/token
POST /api/agent-oauth/revoke
GET  /api/agent-oauth/jwks
```

The endpoint-specific Protected Resource Metadata is authoritative; the root
document is the required discovery fallback and returns the same site resource
when the origin serves one canonical NexPress MCP endpoint. Metadata is derived
only from the resolved site's trusted canonical origin:

```json
{
  "resource": "https://site.example/api/mcp",
  "authorization_servers": ["https://site.example"],
  "scopes_supported": [
    "site:read",
    "schema:read",
    "changeset:read",
    "changeset:write",
    "changeset:apply",
    "content:read",
    "content:draft",
    "content:publish",
    "media:read",
    "media:write",
    "navigation:read",
    "navigation:write",
    "theme:read",
    "theme:write",
    "settings:read",
    "settings:write",
    "audit:run",
    "ops:read",
    "ops:plan",
    "ops:execute",
    "incident:read",
    "moderation:execute",
    "security:execute"
  ]
}
```

This array is generated from the complete exact `npAgentScopes` inventory.
Initial authorization requests challenge only for the currently needed
minimum—normally `site:read`—and default the NexPress-owned
`nexpress_gateway_mode` authorization parameter to `read`. The parameter may
be exactly `read`, `propose`, or `approved-execute` and cannot exceed the
deployment/site ceiling. Later insufficient-scope responses request an exact
narrow scope step-up subset within the already granted mode. Advertising a
scope or mode does not grant it.

Authorization Server metadata publishes the fixed endpoints above,
`response_types_supported: ["code"]`,
`grant_types_supported: ["authorization_code", "refresh_token"]`, and
`code_challenge_methods_supported: ["S256"]`, and
`token_endpoint_auth_methods_supported: ["none"]`. It also publishes the
namespaced extension
`nexpress_gateway_modes_supported: ["read", "propose", "approved-execute"]`;
generic OAuth clients may ignore it and use the default `read`. Access tokens
are audience-bound, short-lived NexPress tokens signed by the Agent OAuth
keyring; JWKS exposes only active/retiring public keys with stable `kid`
values.
Authorization codes are one-time and short-lived. Refresh token bodies are
shown only to the client, stored hash-only, rotated on every use, and revoked
as one grant family.

The authorize GET validates the request and renders/redirects to NexPress's
staff-authenticated consent UI; it never grants on GET. The authorize POST
requires that staff session, CSRF, the original one-time consent challenge, and
an exact selected site/scope/exposure set before issuing a code. Token and
revocation requests use OAuth form encoding and never accept browser session
authority as a substitute for the code, refresh token, or service credential.

The initial challenge requests only `site:read` and `read`. A client receives
exact step-up challenges for additional tool scopes within that exposure.
Widening exposure requires a fresh authorization request and consent; it is not
encoded as an OAuth scope or inferred from a tool call. The built-in
Authorization Server confirms the consenting user's current site membership,
deployment/site exposure ceiling, and `npAgentScopeStaffCapability` ceiling
before issuing each grant.

V1 supports only registered public OAuth clients:

1. an admin pre-registers the client id, display metadata, and exact redirect
   URI inventory in Agent Studio;
2. NexPress does not issue or accept an OAuth client secret;
3. every authorization-code exchange uses PKCE `S256`;
4. HTTPS Client ID Metadata Documents and Dynamic Client Registration are
   future compatibility work; DCR is absent/default-off in v1.

Unattended automation uses a separately issued, site/scope/transport-bound
NexPress service credential. The high-entropy token is shown once and only its
hash and non-secret fingerprint are persisted. It is not a provider API key,
OAuth refresh token, browser session, or user's ChatGPT/Claude session token.
Remote verification applies the credential's exact MCP or Agent API audience;
a stdio-only credential cannot be replayed over HTTP.

### 10.1 No token passthrough

The inbound token authorizes only NexPress:

```text
MCP bearer token ──X──> OpenAI / Anthropic / Cloudflare / Slack / plugin API
```

After validation, transport code converts claims to `NpAgentPrincipal` and
discards the raw token before capability context creation. Provider calls use
the site's separately encrypted provider connection. Downstream integrations
use their own separately encrypted credentials.

The raw token, authorization code, refresh token, PKCE verifier, provider key,
and downstream token are prohibited from:

- capability input/output;
- ChangeSets, run steps, incidents, signals, and audit detail;
- logger/error-reporter context;
- provider prompts and tool messages;
- MCP resources or prompt templates.

## 11. Structured outputs and errors

Every successful tool response includes:

- `structuredContent` conforming to the tool's `outputSchema`;
- when canonical structured JSON is at most 256 KiB, a JSON-serialized text
  content block with the same object for compatibility;
- above 256 KiB, only a bounded text summary/resource link rather than a
  duplicate object;
- resource links for large or separately authorized artifacts.

The server validates structured content, serializes the complete JSON-RPC
envelope, and enforces the 5 MiB frame limit after escaping/duplication. An
inline structured result is at most 3 MiB; a larger valid capability output is
stored behind an authorized resource/task result. A handler that returns
malformed or oversized data produces no partial result.

### 11.1 Exact tool error wire

```ts
export interface NpAgentToolErrorWire {
  schemaVersion: "np.agent-tool-error.v1";
  ok: false;
  capabilityId: NpAgentCapabilityId | null;
  invocationId: string | null;
  error: {
    code: string;
    message: string;
    details?: NpAgentJsonValue;
  };
  status: number;
  retryable: boolean;
  retryAfterSeconds: number | null;
}
```

The nested `error` and `status` obey `@nexpress/core/api-contract`. Initial
implementation reuses known codes:

| Condition                                        | Existing API code       |
| ------------------------------------------------ | ----------------------- |
| malformed capability input                       | `VALIDATION_ERROR`      |
| missing agent scope/current site authority       | `FORBIDDEN`             |
| missing resource/capability                      | `NOT_FOUND`             |
| stale version, approval, or idempotency-key hash | `CONFLICT`              |
| quota/budget/rate limit                          | `RATE_LIMITED`          |
| jobs/provider/vault/enforcement unavailable      | `SERVICE_UNAVAILABLE`   |
| malformed internal result                        | opaque `INTERNAL_ERROR` |

New stable codes require the normal API-contract update process; message text
is never a branching contract.

The first Agentic Platform release intentionally adds only the exact bounded
`details.reasonCode` specializations defined in
[changesets-and-approvals.md](changesets-and-approvals.md#16-api-and-mcp-projection);
it does not add parallel top-level `AGENT_*`/`CHANGESET_*` status mappings.

MCP error mapping:

- malformed JSON-RPC, unknown method/tool, or invalid MCP framing uses standard
  JSON-RPC protocol errors;
- a well-formed tool call with invalid domain arguments or business failure
  returns `isError: true` and `NpAgentToolErrorWire`, allowing a model to
  correct its call;
- remote authentication/insufficient scope returns HTTP `401`/`403` before
  tool execution, not a tool-level error;
- internal errors omit stack, provider response, SQL, secret names/values, and
  untrusted raw evidence.

### 11.2 Exact preview-artifact read outcome

MCP, Agent HTTP, and Admin call one resource service and consume only this
total internal union:

```ts
type NpAgentPreviewArtifactReadOutcomeV1 =
  | {
      kind: "ok";
      artifact: NpAgentPreviewArtifactRefWireV1;
      previewManifestDigest: string;
      bytes: Uint8Array;
    }
  | {
      kind: "authentication_failed";
      reason: "missing" | "invalid" | "wrong-audience";
    }
  | { kind: "not_found" }
  | { kind: "integrity_failure"; incidentId: string }
  | {
      kind: "dependency_unavailable";
      retryAfterSeconds: number | null;
    };
```

The locator contains only preview/artifact ids. The service loads
`contentDigest`, MIME, size, and manifest metadata, reads the private object,
then recomputes content/manifest integrity before `ok`. Unknown, malformed,
foreign-site, deleted, expired/not-ready, scope/capability loss,
target-invisibility, route-audience change, and id/preview mismatch all become
the same `not_found`, with no timing-distinguishing storage probe. A digest,
MIME, size, parser, or manifest mismatch creates a high-severity integrity
incident and returns `integrity_failure`; it never leaks which check failed.

The transport map is exact:

| Outcome                  | Agent/Admin HTTP                                                                   | MCP `resources/read`                                                   |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ok`                     | `200` private byte stream with shared exact artifact headers                       | one exact `BlobResourceContents` or `TextResourceContents` result      |
| `authentication_failed`  | `401 AUTHENTICATION_REQUIRED`; machine response carries the required full audience | Streamable-HTTP `401` before JSON-RPC; no resource error body          |
| `not_found`              | `404 NOT_FOUND` with no artifact/preview distinction                               | JSON-RPC `-32002`, message `Resource not found`, data `{uri}` only     |
| `integrity_failure`      | `500 INTERNAL_ERROR`, opaque message                                               | JSON-RPC `-32603`, message `Resource unavailable`, no incident id      |
| `dependency_unavailable` | `503 SERVICE_UNAVAILABLE`, optional integer `Retry-After`                          | JSON-RPC `-32603`, message `Resource unavailable`, retry detail absent |

Admin uses its current staff session instead of a bearer audience but otherwise
shares the same map. Cross-transport fixtures must produce the same union
member before encoding and prove that foreign/invisible ids are
indistinguishable from random ids. No transport catches an error and
direct-reads storage as a fallback.

## 12. Idempotency

Every mutation and every durable/cost-bearing read requires a caller-stable
idempotency key.

Proposed key contract:

```ts
export const NP_AGENT_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
// ASCII letters, digits, ".", "_", ":", and "-" only; 1..128 characters.
```

The server atomically reserves the canonical invocation tuple defined in
[data-model.md §5.7](data-model.md#57-np_agent_invocations):

```text
(siteId, actorKind, actorFingerprint, authorizationContextFingerprint,
 operationKind, operationId, idempotencyKey)
```

with the operation contract/effect profile and canonical request hash frozen
on the same row. Capability calls use `operationKind="capability"` and their
capability id; Admin mutations use `operationKind="admin"` and the closed
route-operation id. OAuth, service-family, Runtime, and staff-session
boundaries are part of `authorizationContextFingerprint`, so sharing a
principal name never merges independent authorities.

- same tuple + same hash returns the original accepted/completed/failed result;
- same tuple + different hash returns `CONFLICT`;
- concurrent first calls serialize on the reservation;
- a terminal failure remains the result for that key; retrying a materially
  new operation requires a new key;
- JSON-RPC ids, HTTP request ids, job ids, timestamps, and model-generated
  random values are not substitutes;
- ChangeSet apply additionally binds the immutable version/proposal hash and
  approval hash.

Direct reads without cost or side effects do not accept/need a key.

## 13. Pagination

All agent list/query contracts use opaque cursor pagination, including REST,
MCP resources/tools, and MCP tasks.

Cursor properties:

- authenticated and opaque;
- bound to schema version, site, principal visibility, query hash, stable sort,
  and expiry;
- never a trusted raw SQL offset or caller-editable site id;
- not portable between credentials, sites, filters, or sessions;
- invalid/expired cursor is a validation error (`-32602` for an MCP list
  protocol cursor).

Default page size is 20 and the initial maximum is 100. Callers may request a
smaller limit; the server may return fewer items. Stable domain queries use a
deterministic keyset such as `(updatedAt, id)` and return `nextCursor` only when
another authorized item exists.

MCP `tools/list`, `resources/list`, `resources/templates/list`, and
`prompts/list` implement the protocol cursor shape even though the core lists
are small.

## 14. MCP tasks and NexPress runs

An MCP task is an immutable transport projection of one admitted
`np_agent_invocations` row and may reference one durable `NpAgentRun`. The
invocation/result is the task identity; a mutable run or raw pg-boss job is not
the source of public task authority.

They are advertised only when protocol negotiation supports the
`2025-11-25` experimental task utility. Tool descriptors use
`execution.taskSupport: "optional"` for durable operations and
`execution.taskSupport: "forbidden"` for strictly inline reads.

When the selected protocol is `2025-11-25` and the deployment task feature is
enabled, InitializeResult contains exactly:

```json
{
  "capabilities": {
    "tasks": {
      "list": {},
      "cancel": {},
      "requests": { "tools": { "call": {} } }
    }
  }
}
```

The normal non-task capability members remain alongside it. Client task
capabilities describe requests the client can receive and do not gate this
server branch. For an older protocol or disabled feature, the `tasks` member
is omitted and the server processes `tools/call` normally while
ignoring a task augmentation field as the MCP task-support rule requires. Only
after the request-type capability above is active does a task attempt against
`execution.taskSupport:"forbidden"` return `-32601`. V1 has no
`execution.taskSupport:"required"` tool. Initialize snapshots and
conformance tests cover all four negotiation branches.

The exact public projection is:

```ts
export const npAgentMcpTaskLimits = {
  ttlMinMs: 60_000,
  ttlDefaultMs: 3_600_000,
  ttlMaxMs: 86_400_000,
  pollIntervalMinMs: 1_000,
  pollIntervalDefaultMs: 2_000,
  pollIntervalMaxMs: 10_000,
  activePerAuthorizationContext: 32,
  activePerSite: 1_000,
  operationsPerAuthorizationContextPerMinute: 120,
} as const;

interface NpAgentMcpTaskV1 {
  taskId: string;
  status: "working" | "completed" | "failed" | "cancelled";
  statusMessage: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval: number;
}

interface NpAgentMcpCreateTaskResultV1 {
  task: NpAgentMcpTaskV1;
  _meta: {
    "io.modelcontextprotocol/related-task": { taskId: string };
    "io.modelcontextprotocol/model-immediate-response": "Task registered. Fetch its status or result.";
  };
}
```

`taskId` is receiver-generated `npt1_<lowercase-uuidv7>` and globally unique.
All numbers are safe integer milliseconds. Every task response includes the
persisted actual `ttl`, `createdAt`, `lastUpdatedAt`, and `pollInterval`;
constants and row semantics are defined in
[data-model.md](data-model.md#58-np_agent_mcp_tasks). `statusMessage` is
derived from the closed status map (`Operation in progress`, `Operation
completed`, `Operation failed`, `Operation cancelled`) and stores no provider
or model text. CreateTaskResult always starts `working`, even when terminal
work can be committed immediately after the response. An idempotent
task-augmented replay with the same requested TTL returns the existing task
with its current status; it does not lie by projecting a terminal row as
`working`, attach a second task, or inline the underlying terminal result.
Changing normal/task mode or requested TTL under the same domain idempotency
tuple returns the ordinary top-level `CONFLICT`; v1 adds no undeclared
task-specific reason code. Replaying the original task-augmented `tools/call`
after that task's actual TTL returns the same non-oracular
`-32602 Invalid params` used for an expired task id; it neither creates a new
task nor falls back to the longer-retained domain invocation result.

Task admission serializes on site and authorization-context counters. A 33rd
working task for one context, 1,001st for a site, or 121st task operation in a
rolling minute is rejected before invocation/task creation with JSON-RPC
server error `-32000`, safe data
`{code:"RATE_LIMITED",retryAfterSeconds:<1..60>}`. `Retry-After` is the
earliest counter-window/working-task expiry capped to that range. Terminal
rows do not consume active slots but remain under TTL retention. Metrics and
Doctor expose only authorized aggregate pressure, never foreign task ids.

Mapping:

| MCP task         | Exact NexPress mapping                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `taskId`         | opaque id bound to one invocation, site/principal/authorization-context fingerprint, and optional run |
| `working`        | linked run is `queued`, `running`, `waiting_retry`, or `verifying`                                    |
| `input_required` | reserved; v1 does not solicit approval through MCP                                                    |
| `completed`      | run `succeeded`, or the invocation has immutable `approval_required`/inline success                   |
| `failed`         | run is `failed`, `policy_blocked`, or `budget_blocked`                                                |
| `cancelled`      | run/invocation cancellation is recorded; the task never returns to another state                      |

A linked run in `waiting_approval` does **not** leave the public task working:
the original invocation task persists `completed` with its exact
`approval_required` result. Internal run/action state may wait for a human, but
that later state cannot rewrite a terminal task projection.
The run-state rows in the table are consulted only while the task is
non-terminal; a persisted terminal invocation/task result always wins if the
linked run later fails after approval rejection, expires, or resumes.

Rules:

- `tasks/get`, `tasks/list`, `tasks/result`, and `tasks/cancel` see only tasks
  belonging to the same site, principal, and persisted non-PII authorization
  context fingerprint. OAuth binds client/grant/version; service auth binds
  the rotation family plus immutable family-authority/principal-authority
  versions, transport, and audience—not the individual rotated token id. A
  live same-family replacement may continue its predecessor's task; an
  independent family for the same principal cannot;
- optional status notifications are hints; clients must poll;
- `tasks/list` uses an opaque cursor;
- task timestamps are canonical ISO and TTL/poll interval are server bounded;
- `tasks/result` returns the same validated result the original tool would
  return;
- when policy requires approval, the task completes with the exact
  `approval_required` result and server-owned Admin resource link; MCP cannot
  grant that approval;
- a later approved apply/`execute_approved` is a new invocation with a new
  idempotency key and a new MCP task. It may resume the persisted action/run
  under its explicit execution-invocation link, but the original task remains
  terminal and its result never regresses;
- cancellation is best effort for provider calls and future run steps;
- cancellation cannot undo an already committed action or ChangeSet. A
  separate rollback capability is required;
- once cancellation is acknowledged, the public task remains cancelled even
  if an underlying non-cancellable adapter finishes later;
- task ids and `io.modelcontextprotocol/related-task` metadata never authorize
  resource access.

The total terminalization map is:

| Stored underlying outcome                                                             | Task status | Required terminal result                                             |
| ------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| validated `CallToolResult` with absent/false `isError`, including `approval_required` | `completed` | that exact result                                                    |
| validated `CallToolResult` with `isError:true`                                        | `failed`    | that exact result                                                    |
| stored JSON-RPC execution error                                                       | `failed`    | that exact error                                                     |
| accepted `tasks/cancel` or committed non-deletion underlying cancellation             | `cancelled` | id-less error `{code:-32800,message:"Request cancelled"}`            |
| actual task TTL elapsed while still working                                           | `cancelled` | id-less error `{code:-32800,message:"Task lifetime expired"}`        |
| site deletion fences a working task                                                   | `cancelled` | id-less error `{code:-32800,message:"Site deletion cancelled task"}` |
| missing/malformed immutable invocation/run parent before TTL                          | `failed`    | id-less error `{code:-32603,message:"Internal error"}`               |

Every terminal row sets `terminal_result`, its digest, `lastUpdatedAt`, and
state in one CAS. A terminal status with no result/digest, or a successful
result under `failed`, is malformed and Doctor-blocking.

`tasks/get`, `tasks/list`, and successful `tasks/cancel` return the complete
task object and omit related-task metadata because the task id is already in
the protocol shape. `tasks/result` blocks while `working`; at a terminal state
it returns the exact stored underlying `CallToolResult` or JSON-RPC error and
injects only
`_meta["io.modelcontextprotocol/related-task"]={taskId}` into the applicable
result metadata. A cancelled task stores the exact id-less
`-32800` branch selected by the total map (`Request cancelled`,
`Task lifetime expired`, or `Site deletion cancelled task`) and wraps it with
the current `tasks/result` request id. Notifications, when enabled, carry the
complete task object and no related-task metadata. Any downstream
task-associated request/response that lacks a task id in its own protocol
shape carries the same related-task object.

Malformed/unknown/expired/foreign/invisible task ids and invalid/unknown
cursors return non-oracular `-32602 Invalid params`. Cancelling
`completed|failed|cancelled` also returns `-32602`; a valid working cancel
first commits terminal `cancelled`, then responds. The initial task-augmented
`tools/call` validates optional `task.ttl` as an integer within the published
bounds. A task/result exists only through
`createdAt + persisted actual ttl`; after that, every task operation returns
the same non-oracular invalid-params result even if the underlying NexPress
run remains retained.

Clients without task support receive `state: "accepted"`, a run resource URI,
and `pollAfterMs` immediately.

## 15. Plugin extension rules

Plugins are trusted in-process Node code, but exposing a plugin handler to a
remote agent creates a new authorization surface. V1 therefore does **not**
accept plugin-defined agent capabilities.

Exact v1 rules:

1. `NpAgentCapabilityId` contains only the 21 framework ids in §5.
2. The registry rejects a `plugin:*` descriptor source or an unknown
   capability id.
3. `definePlugin()` has no `agentCapabilities` field and the plugin manifest
   has no `agent:capability` grant.
4. Plugins cannot add MCP tools, resource templates, prompts, or scope strings.
5. Plugin routes/actions do not become agent capabilities automatically.
6. Existing plugin discovery remains visible through the bounded plugins
   resource, subject to site activation and metadata filtering.
7. Framework capabilities may still trigger normal collection hooks and other
   plugin behavior through the existing host; that does not expose a new
   plugin entrypoint.

A future plugin-agent extension is a separate compatibility project. It must
version the capability id namespace and scope story, cap definitions per
plugin/site, require closed input/output schemas, verify existing
`NpPluginCapability` gates for every reachable `ctx.*` method, filter by
site activation, and use one bounded generic MCP tool rather than generate one
tool per plugin action. It cannot ship by quietly widening the v1 unions.

## 16. OpenAPI and agent HTTP projection

MCP JSON-RPC framing is documented as MCP, not falsely modeled as ordinary
OpenAPI operations. The live OpenAPI 3.1 document still projects the same
contracts for agent-oriented HTTP and Admin clients.

Proposed machine HTTP surface:

```text
GET  /api/agent/v1/capabilities
POST /api/agent/v1/invocations
GET  /api/agent/v1/runs/{runId}
GET  /api/agent/v1/previews/{previewId}/artifacts/{artifactId}
```

Proposed Agent Studio surfaces live under `/api/admin/agents/*` and use the
normal staff session/CSRF contract.

Machine HTTP v1 accepts only an `agent-http` service credential whose audience
is the canonical `https://<site-host>/api/agent/v1` resource, with the
deployment-owned external origin normalized by the shared origin builder. It
cannot be reused as an MCP or provider token, and an MCP OAuth access token
cannot be replayed on these routes. The credential resolves the same
`NpAgentPrincipal` and calls the invocation or artifact facade selected by the
route. A future interactive Agent API OAuth audience would be a separate
metadata/grant contract.

The capabilities GET and invocation POST use the same descriptor transport
allowlist and deployment/site/credential/scope/policy exposure intersection as
MCP. Agent HTTP cannot be used to invoke a capability hidden from its effective
Gateway profile. Conversely, an explicitly enabled `approved-execute`
Agent HTTP credential retains the complete shipped capability inventory; this
projection rule narrows default exposure without deleting functionality.

The artifact GET accepts only the same `agent-http` audience and logical
preview/artifact ids returned by an authorized ChangeSet preview. The server
loads the expected `contentDigest`; callers neither send a digest parameter nor
turn an ETag into authority. It repeats site, `changeset:read`, every-target
visibility, ready/unexpired preview, artifact `object_state=ready`, storage
presence, content-digest/MIME/size/report-part invariants, and
principal-currentness checks before streaming the private object with the
exact no-store/nosniff/content-disposition headers.
The equivalent MCP `resources/read` URI and HTTP path are transport
projections of one resource contract, not interchangeable credentials.

OpenAPI generation:

1. boots active plugins so collection/block/plugin discovery matches the
   current site, without accepting plugin-defined agent capabilities;
2. exports `NpAgentCapabilityDescriptor`, invocation result, task/run, and
   error schemas under components;
3. emits an exact `oneOf` request branch for every v1 framework capability:
   `capabilityId` is a `const` and `input` references that capability's exact
   schema;
4. emits matching capability-specific output branches;
5. includes `x-nexpress-capability-id`, scopes, risk, approval, and
   idempotency metadata for tooling;
6. uses the existing exact API error envelope for every HTTP error;
7. omits handler functions, provider/model configuration, credentials,
   persisted secret values, hidden policy rules, and internal job routes.

The OpenAPI projection is discovery, not authority. A cached spec cannot make a
disabled plugin discoverable at runtime or bypass a changed site policy.

## 17. Contract limits and diagnostics

The following table is the normative v1 `npAgentContractLimits` source.
Registry, MCP, REST, OpenAPI, Admin clients, Doctor, and tests import the same
frozen constants; deployment settings may lower operational byte/page/task
limits but cannot raise them or change the fixed inventories.

| Limit                                                   |                                                               Exact v1 value |
| ------------------------------------------------------- | ---------------------------------------------------------------------------: |
| Core capability descriptors                             |                                                                           21 |
| MCP tools                                               |                                                                           18 |
| MCP resource templates                                  |                                                                           11 |
| MCP prompts                                             |                                                                            4 |
| Capability/scope/id characters                          |                          1–128, exact ASCII grammar declared by each id type |
| Human title / description                               |                                            120 / 2,000 Unicode scalar values |
| Scopes on one principal/descriptor                      |                                                                           23 |
| JSON Schema serialized bytes                            |                                                                      512 KiB |
| JSON Schema depth / total nodes / local definitions     |                                                             16 / 4,096 / 128 |
| Properties per schema object / declared `maxItems`      |                                                          128 / at most 1,000 |
| Declared schema string `maxLength`                      |                                                   at most 262,144 characters |
| Invocation input or output serialized bytes             |                                                                   4 MiB each |
| Invocation JSON depth / total nodes                     |                                                                  32 / 20,000 |
| Invocation array items / object properties / one string |                                             5,000 / 512 / 262,144 characters |
| MCP JSON-RPC request or response frame                  |                                                                        5 MiB |
| Inline MCP structured result                            |                    3 MiB; compatibility text duplicates only through 256 KiB |
| Page size                                               |                                                      default 20; maximum 100 |
| Opaque cursor                                           |                                           maximum 2,048 bytes; 15-minute TTL |
| Prompt arguments                                        |                                     at most 8; each at most 4,000 characters |
| Task polling                                            |                   minimum 1,000 ms; default 2,000 ms; maximum hint 10,000 ms |
| Active task wall clock                                  |                         owning run deadline; absolute maximum 86,400 seconds |
| Task/result availability                                | creation plus actual TTL; minimum 1 minute, default 1 hour, maximum 24 hours |
| Direct mutation primary targets                         |                                                  exactly 1 per direct action |
| Verification/evidence references per action             |                                                                          100 |
| Actor restriction TTL                                   |                  60-second minimum, 900-second default, 3,600-second maximum |

Counts apply after canonicalization. Bytes are UTF-8 serialized bytes;
characters are Unicode scalar values. Object keys count as nodes and bytes.
Schemas must declare all string/array bounds within these ceilings; omitting a
reachable bound fails registration. The separate ChangeSet plan/snapshot
limits remain normative in
[changesets-and-approvals.md](changesets-and-approvals.md), and a result above
the inline limit becomes a scoped resource/task reference rather than being
truncated into a different schema.

Doctor/health checks must report:

- malformed or duplicate capability definitions;
- descriptor/schema/OpenAPI drift;
- attempted unknown or plugin-sourced v1 capability definitions;
- missing audit/idempotency/job/provider/vault/enforcement dependencies;
- agent jobs enabled without a live worker;
- OAuth resource/audience/redirect misconfiguration;
- expired/invalid grants and credentials without exposing secrets;
- policy references to unknown capabilities/scopes;
- orphaned run/task/approval/incident references;
- malformed task ids, duplicate/mismatched invocation links, mode/TTL drift,
  authorization-context mismatch, invalid state/result/digest/timestamps, or
  a terminal row without its exact stored result;
- `working` tasks whose immutable invocation/run is terminal, working tasks
  past expiry or without a live parent, task rows/result bodies retained past
  actual TTL, and cleanup/counter pressure beyond the frozen caps.

## 18. Required verification

Minimum acceptance coverage:

1. client-safe `agent-contract` bundle test;
2. exhaustive scope-to-staff-capability map test;
3. exhaustive core capability descriptor test;
4. input/output exactness and bounds tests;
5. duplicate registration/HMR fingerprint tests;
6. site mismatch, default fallback, wildcard, and concurrent site-isolation
   tests;
7. scope step-up and revoked membership tests;
8. idempotency same-hash, mismatched-hash, and concurrent admission tests;
9. ChangeSet resource-derived scope matrix tests;
10. audit failure and jobs-disabled fail-closed tests;
11. local stdio framing/credential/redaction tests;
12. remote Streamable HTTP initialize/tool/resource/prompt/auth tests;
13. OAuth PKCE, audience, resource indicator, redirect, rotation, `401`, and
    `403` challenge tests;
14. token-passthrough regression tests at every provider/integration adapter;
15. structured output/error validation tests;
16. opaque cursor tamper/site/principal/query binding tests;
17. MCP task polling, result, cancellation, TTL, and authorization tests;
18. v1 rejection tests for plugin capability/tool/resource/prompt additions;
19. OpenAPI live-registry parity tests;
20. Postgres-backed multi-worker admission and durable run tests.

## 19. Protocol references

Implementation should pin and test against the official MCP specification
rather than blog examples:

- [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools and structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [MCP cursor pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)
- [MCP experimental tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
