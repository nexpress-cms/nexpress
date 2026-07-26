# Agent Runtime and Guardian

> Status: implementation design. This document proposes future behavior; the
> current shipped runtime remains documented by
> [`jobs.md`](../../jobs.md), [`community.md`](../../community.md), and
> [`agent-operated-ops.md`](../../agent-operated-ops.md).
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
>
> Parent design: [Agentic Platform](README.md)

This document defines the durable server-side runtime that operates a site
after deployment. It covers triggers, normalized evidence, provider calls,
budgets, role templates, actions, verification, incidents, and Guardian.

Guardian is an application-level correlation and response layer. It
**complements, and does not replace, a WAF, IDS, malware scanner, host
monitor, or SIEM**. Cloudflare, a reverse proxy, Sentry, and similar systems
remain responsible for the controls they are designed to enforce. Guardian
combines their bounded signals with NexPress authentication, authorization,
community, content, job, and audit events.

## Goals and non-goals

The runtime must:

- turn exact framework events and UTC schedules into durable, site-scoped work;
- execute only registered agents, provider adapters, and capabilities;
- run deterministic detection and policy before spending model tokens;
- preserve enough state to retry after a process crash without duplicating an
  action;
- keep provider calls, capability calls, approvals, verification, cost, and
  incidents visible to Admin and Doctor;
- let low-risk reversible work run automatically when site policy permits it;
- retain useful evidence without continuously exporting raw logs or secrets.

The runtime does not:

- run one persistent model process or chat session per site;
- let a model execute SQL, shell commands, plugin code, or arbitrary HTTP;
- make model classification an authentication, authorization, or tenant
  boundary;
- stream request logs, cookies, content bodies, or database rows continuously
  to a provider;
- infer a site, identity, or permission from AsyncLocalStorage after enqueue;
- replace existing spam adapters, rate limiters, observability adapters, job
  health, backup checks, or remote-ops approval.

## Runtime topology

```text
framework writes / proxy aggregates / external adapters / schedules
                              |
                    normalized agent event
                              |
                deterministic detectors and rules
                              |
                      signal + incident merge
                              |
           +------------------+------------------+
           |                                     |
   deterministic response                 provider analysis
   when policy allows it              after budget admission
           |                                     |
           +------------------+------------------+
                              |
                    exact capability proposal
                              |
                policy + approval + idempotency
                              |
                 execute -> verify -> undo/close
```

The worker owns provider execution. Web and proxy processes may persist events
and enqueue exact jobs, but they never decrypt provider credentials or perform
a model loop. `createBootstrap().ensureFor("worker")` installs the agent
runtime after observability, DB, storage, collections, plugins, and the worker
queue are ready. Shutdown stops new run claims, waits for bounded active calls,
closes provider adapters, clears credential leases, then continues the
existing reverse bootstrap shutdown order.

The optional Agent Gateway is a caller, not another execution engine. An
external MCP client invokes the same capability facade but does not enter the
server-side provider loop.

## Exact normalized contracts

Client-safe contracts belong under `@nexpress/core/agent-contract`. Server
recording, detection, correlation, and execution belong under
`@nexpress/core/agents`. Every outer object is exact: unknown keys, missing
required keys, malformed UUIDs, non-canonical site ids, non-canonical UTC
times, excessive nesting, and unsupported enum values fail closed.

The snippets below show the logical wire shape. The implementation must publish
bounds beside each parser and reuse those constants in Core, Admin, OpenAPI,
MCP, Doctor, and tests.

### Event

An event is immutable normalized evidence that something happened. It is not a
command and cannot contain an instruction for an agent.

```ts
interface NpAgentEventV1 {
  version: "np.agent-event.v1";
  id: string; // UUID
  siteId: string; // canonical site id
  kind: NpAgentEventKind;
  occurredAt: string; // canonical UTC ISO
  recordedAt: string; // canonical UTC ISO
  source: {
    kind:
      | "auth"
      | "api"
      | "community"
      | "content"
      | "jobs"
      | "ops"
      | "storage"
      | "plugin"
      | "integration"
      | "agent";
    component: string; // bounded canonical identifier
  };
  subject: NpAgentSubject | null;
  actor: NpAgentActorProjection | null;
  causation: NpAgentEventCausationV1 | null;
  correlationId: string | null;
  deduplicationKey: string | null;
  privacy: "public" | "internal" | "sensitive";
  payload: NpAgentEventPayload;
}
```

```ts
export const NP_AGENT_CAUSAL_DEPTH_MAX = 4;

interface NpAgentEventCausationV1 {
  rootRunId: string;
  sourceRunId: string;
  sourceActionId: string;
  depth: number;
}
```

`NpAgentSubject` and every restrictable anonymous reference share one frozen
actor-bucket projection:

```ts
type NpAgentActorBucketPurposeV1 = "network-address" | "login-identifier";

interface NpAgentActorBucketRefV1 {
  purpose: NpAgentActorBucketPurposeV1;
  projectionVersion: number;
  projectionFingerprint: string;
  keyId: string;
  bucket: string;
}

type NpAgentSubject =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "comment"; commentId: string; collection: string; documentId: string }
  | { kind: "member"; memberId: string }
  | { kind: "staff"; userId: string }
  | { kind: "session"; actorKind: "staff" | "member"; sessionFamilyId: string }
  | ({ kind: "actor-bucket" } & NpAgentActorBucketRefV1)
  | { kind: "job"; jobName: string; jobId: string }
  | { kind: "plugin"; pluginId: string }
  | { kind: "connection"; connectionId: string }
  | { kind: "agent"; agentId: string; agentVersionId: string | null }
  | { kind: "site"; siteId: string };

type NpAgentActorProjection =
  | { kind: "staff"; userId: string }
  | { kind: "member"; memberId: string }
  | { kind: "agent-principal"; principalId: string }
  | { kind: "system"; component: string }
  | ({ kind: "anonymous" } & NpAgentActorBucketRefV1);
```

Every branch is exact. Canonical UUID/opaque ids are 1–128 characters,
collection/plugin/job/purpose identifiers use their live validated contract
with a 96-character ceiling. Actor-bucket `keyId` is a 1–128 character
canonical key identifier; `bucket` is exactly 43 unpadded base64url
characters encoding the 32-byte HMAC-SHA-256 result and rejects `=`, another
alphabet, or length.
The union contains no display name, email, address, token, URL, or content
body. `NpAgentActorProjection` records only the actor type and stable id where
policy permits; unauthenticated traffic uses the exact
site/purpose/projection-version/key-version-scoped HMAC actor bucket rather
than a raw IP.
Actor projection contains no display name, role, email, user agent, address,
token, or authorization claim.
The projection version/fingerprint is independent of the restriction adapter
and remains registered while any retained event, signal, incident, or
restriction references it. Only the two closed purposes above can be resolved
by `incident-subject`; a missing/mismatched projection or another subject kind
fails before proposing a restriction.

`causation` is server-owned and present exactly when the domain mutation ran
inside an admitted Agent action context. Its ids are same-site immutable
references and `depth` equals the source run's stored `causal_depth` in
`0..NP_AGENT_CAUSAL_DEPTH_MAX`; callers, model output, plugins, and event
payloads cannot set or clear it. Post-commit event publication copies the
context from the capability executor. A causation-bearing event can trigger a
child run only at `depth + 1`; at the maximum, deterministic detectors and
incident correlation still run but Agent-run admission is skipped with
`AGENT_CAUSAL_DEPTH_EXCEEDED`.

When present, `deduplicationKey` is a source-stable 1–128 character ASCII key
matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. A transactional producer uses
its immutable outbox/domain-event id; a schedule uses trigger id plus canonical
occurrence. It is never random per retry. The server hashes the canonical
event envelope excluding generated id/recorded/dispatch/retention fields.
Same site/source/kind/key plus the same hash returns the existing event;
different content under that key is a contract conflict and signal.

`NpAgentEventKind` and `NpAgentEventPayload` are one discriminated registry,
not a free-form `Record<string, unknown>`. The first implementation includes:

| Family               | Kinds                                                                                    | Required bounded payload                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Auth                 | `auth.login.failed`, `auth.login.succeeded`, `auth.session.revoked`                      | audience, outcome/reason code, session id when relevant, IP bucket, user-agent family |
| Authorization        | `authz.denied`, `authz.role.changed`                                                     | capability/resource code; old/new role for a persisted change                         |
| Community            | `community.content.created`, `community.content.reported`, `community.content.moderated` | target type/id, author id where allowed, adapter verdict code, canonical status       |
| Content              | `content.document.changed`, `content.document.published`                                 | collection, document id, transition, revision id                                      |
| Jobs                 | `jobs.handler.failed`, `jobs.worker.stale`, `jobs.backlog.threshold`                     | handler name, job id/count bucket, exact health timestamp                             |
| Operations           | `ops.check.changed`, `ops.backup.failed`, `ops.backup.stale`                             | stable check id, previous/current status, artifact id when safe                       |
| Security integration | `security.edge.signal`, `security.error.signal`                                          | adapter kind, external signal id, category, severity, bounded counters                |
| Agent                | `agent.run.changed`, `agent.action.changed`, `agent.policy.blocked`                      | agent/run/action ids, previous/current state, stable reason code                      |

The normative payload union is:

```ts
type NpAgentStableCode = string; // /^[A-Z][A-Z0-9_]{0,63}$/
type NpAgentIpBucketRef = NpAgentActorBucketRefV1 & {
  purpose: "network-address";
};

const npAgentRunStates = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_retry",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "policy_blocked",
  "budget_blocked",
] as const;
type NpAgentRunState = (typeof npAgentRunStates)[number];

const npAgentActionStates = [
  "proposed",
  "policy_blocked",
  "approval_pending",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "compensated",
] as const;
type NpAgentActionState = (typeof npAgentActionStates)[number];

type NpAgentEventPayload =
  | {
      kind: "auth.login.failed";
      audience: "staff" | "member";
      outcome: "failed";
      reasonCode: NpAgentStableCode;
      sessionFamilyId: string | null;
      ipBucket: NpAgentIpBucketRef;
      userAgentFamily: string | null;
    }
  | {
      kind: "auth.login.succeeded";
      audience: "staff" | "member";
      outcome: "succeeded";
      reasonCode: NpAgentStableCode;
      sessionFamilyId: string;
      ipBucket: NpAgentIpBucketRef;
      userAgentFamily: string | null;
    }
  | {
      kind: "auth.session.revoked";
      audience: "staff" | "member";
      sessionFamilyId: string;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "authz.denied";
      capabilityCode: string;
      resourceKind: string;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "authz.role.changed";
      actorKind: "staff" | "member";
      actorId: string;
      previousRole: string;
      currentRole: string;
    }
  | {
      kind:
        "community.content.created" | "community.content.reported" | "community.content.moderated";
      targetKind: "comment" | "document";
      targetId: string;
      collection: string;
      authorMemberId: string | null;
      verdictCode: NpAgentStableCode | null;
      status: "visible" | "quarantined" | "hidden" | "deleted";
    }
  | {
      kind: "content.document.changed" | "content.document.published";
      collection: string;
      documentId: string;
      transition: NpAgentStableCode;
      revisionId: string;
    }
  | {
      kind: "jobs.handler.failed";
      handlerName: string;
      jobId: string;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "jobs.worker.stale";
      workerId: string;
      lastHeartbeatAt: string;
    }
  | {
      kind: "jobs.backlog.threshold";
      handlerName: string;
      countBucket: number;
      threshold: number;
    }
  | {
      kind: "ops.check.changed";
      checkId: string;
      previousStatus: "pass" | "warn" | "fail" | "unknown";
      currentStatus: "pass" | "warn" | "fail" | "unknown";
    }
  | {
      kind: "ops.backup.failed" | "ops.backup.stale";
      artifactId: string | null;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "security.edge.signal" | "security.error.signal";
      adapterId: string;
      externalSignalId: string;
      category: NpAgentIncidentCategory;
      severity: "info" | "low" | "medium" | "high" | "critical";
      count: number;
    }
  | {
      kind: "agent.run.changed";
      agentId: string | null;
      runId: string;
      previousState: NpAgentRunState | null;
      currentState: NpAgentRunState;
      reasonCode: NpAgentStableCode | null;
    }
  | {
      kind: "agent.action.changed";
      runId: string | null;
      actionId: string;
      previousState: NpAgentActionState | null;
      currentState: NpAgentActionState;
      reasonCode: NpAgentStableCode | null;
    }
  | {
      kind: "agent.policy.blocked";
      agentId: string | null;
      runId: string | null;
      capabilityId: NpAgentCapabilityId | null;
      reasonCode: NpAgentStableCode;
    };

type NpAgentEventKind = NpAgentEventPayload["kind"];
```

The event analyzer requires `event.kind === payload.kind`. All ids and codes
use their live canonical grammar and a 128-character ceiling; component,
handler, resource, role, adapter, and user-agent-family strings are at most 96
characters. Counts are safe integers in `0..2_147_483_647`. The complete
payload is at most 16 KiB, depth 4, and 64 nodes. Unknown keys or a
kind/payload mismatch fail closed.

Content text, comment text, request paths, query strings, stack traces, headers,
and external log bodies do not belong in the event payload. When a detector
needs text, it reads the authorized current resource at analysis time, bounds
it, and records a digest plus a redacted excerpt as evidence. Access logs are
aggregated before event creation so a request flood does not create one
database row and one job per request.

Event producers must use `recordAgentEvent()` rather than inserting rows
directly. A framework mutation that must never lose its security or audit
projection writes the event in the same database transaction as the source
change. External adapters validate and persist before acknowledging input.
Best-effort evidence is permitted only for informational telemetry and must
increment a runtime diagnostic when dropped.

The existing `np_community_realtime_events` outbox is a PII-free UI
invalidation transport, not an Agent Runtime event source. Runtime recording
happens at the durable community write/moderation boundary and preserves the
exact spam/profanity verdict and target state needed by detectors. An SSE frame
must never be expanded into agent evidence or used as proof that a write
occurred.

### Signal

A signal is a deterministic detector result over one or more events or current
state. It is still evidence, not authorization to act.

```ts
export const npAgentIncidentCategories = [
  "spam",
  "abuse",
  "authentication",
  "authorization",
  "traffic",
  "integrity",
  "availability",
  "cost",
  "agent-abuse",
] as const;

export type NpAgentIncidentCategory = (typeof npAgentIncidentCategories)[number];

export const npAgentIncidentSeverities = ["info", "low", "medium", "high", "critical"] as const;
export type NpAgentIncidentSeverity = (typeof npAgentIncidentSeverities)[number];

export const npAgentIncidentSeverityRank: Record<NpAgentIncidentSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface NpAgentSignalV1 {
  version: "np.agent-signal.v1";
  id: string;
  siteId: string;
  detectorId: string;
  detectorVersion: number;
  category: NpAgentIncidentCategory;
  severity: NpAgentIncidentSeverity;
  confidenceBasis: "exact-rule" | "statistical" | "external";
  scoreBasisPoints: number | null; // 0..10_000, never a floating point value
  window: { startedAt: string; endedAt: string };
  subject: NpAgentSubject | null;
  fingerprint: string;
  evidence: NpAgentEvidenceRef[];
  status: "open" | "attached" | "suppressed" | "resolved";
  incidentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Evidence references identify immutable event rows, revision ids, job rows,
exact ops check ids, or external signal ids. A reference may carry a redacted
excerpt and SHA-256 digest, each bounded independently. It cannot embed raw
provider output or arbitrary JSON. The server computes `fingerprint` from the
detector version, category, normalized subject, and time bucket; clients never
supply it.

```ts
interface NpAgentEvidenceRefCommon {
  observedAt: string;
  digest: string;
  excerpt: string | null;
}

type NpAgentEvidenceRef = NpAgentEvidenceRefCommon &
  (
    | {
        kind: "event";
        eventId: string;
        eventKind: NpAgentEventKind;
      }
    | {
        kind: "revision";
        collection: string;
        documentId: string;
        revisionId: string;
      }
    | {
        kind: "job";
        jobName: string;
        jobId: string;
      }
    | {
        kind: "ops-check";
        checkId: string;
      }
    | {
        kind: "external-signal";
        adapterId: string;
        externalSignalId: string;
      }
  );
```

`observedAt` is the immutable source occurrence/check time in canonical UTC,
not signal-ingestion time. Each SHA-256 digest is canonical lowercase hex,
each excerpt is already redacted plain text of at most 1,000 characters, and
one signal carries at most 100 unique references. References never contain a
URL, header, raw address, secret, stack trace, or provider response.

Each detector declares:

- an exact input event-kind allowlist;
- the state queries it may perform;
- a fixed aggregation window and minimum sample count;
- severity and score rules;
- a suppression/cooldown policy;
- whether it is safe to evaluate synchronously;
- test vectors containing positive, negative, boundary, and cross-site cases.

Detector registration is source-owned and duplicate ids with different
definitions fail startup. Detectors return exact signals or `null`, resolve to
void after persistence, and cannot call a provider or a mutating capability.

### Incident

An incident is the serialized case that humans and runtime agents operate.
Signals with the same site-scoped incident fingerprint are merged under a
transaction-scoped advisory lock. A partial unique index prevents two open
incidents for the same fingerprint; closed incidents remain immutable history
and a later recurrence opens a new case.

```ts
export const npAgentIncidentStates = [
  "open",
  "investigating",
  "contained",
  "monitoring",
  "resolved",
  "dismissed",
] as const;
export type NpAgentIncidentState = (typeof npAgentIncidentStates)[number];

interface NpAgentIncidentV1 {
  version: "np.agent-incident.v1";
  id: string;
  siteId: string;
  fingerprint: string;
  category: NpAgentSignalV1["category"];
  severity: NpAgentSignalV1["severity"];
  status: NpAgentIncidentState;
  title: string; // server-generated, bounded
  summary: string; // bounded deterministic baseline; model assistance is labelled
  primarySubject: NpAgentSubject | null;
  assignedAgentId: string | null;
  signalIds: string[]; // bounded and ordered
  eventCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  containedAt: string | null;
  resolvedAt: string | null;
  resolutionCode: string | null;
  versionNumber: number; // compare-and-swap token
  createdAt: string;
  updatedAt: string;
}
```

Incident transitions use an exact state machine. `dismissed` and `resolved`
are terminal; a new signal after closure creates a new incident. Every
transition accepts `expectedVersionNumber`, serializes per site and incident,
and appends a separate timeline row. The initial summary is a deterministic
non-empty projection of signals. A model-assisted replacement records its
run/provider provenance in the timeline and Admin labels it as model-assisted.
An assigned agent must belong to the same site. A model cannot supply an
incident title, severity, status, subject, assignment, or resolution outside
the server's transition request and validation.

| Current         | Allowed next                                                        | Required server fact                                                      |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `open`          | `investigating`, `contained`, `monitoring`, `resolved`, `dismissed` | dismissal is staff-only; containment requires an active exact containment |
| `investigating` | `contained`, `monitoring`, `resolved`, `dismissed`                  | same dismissal/containment rules                                          |
| `contained`     | `monitoring`, `resolved`                                            | containment and restore/expiry posture must be recorded                   |
| `monitoring`    | `investigating`, `contained`, `resolved`, `dismissed`               | a new containment must be exact; dismissal is staff-only                  |
| `resolved`      | none                                                                | terminal; recurrence creates a new incident                               |
| `dismissed`     | none                                                                | terminal; recurrence creates a new incident                               |

`resolved` requires a server-allowlisted resolution code and no
`pending`/`restoring` containment. Automated rules may move to
`investigating`, `contained`, or `monitoring`; only an authenticated authorized
staff transition may dismiss or assert a manual resolution. Every transition
checks expected version, current evidence, actor kind, and site in one
transaction.

## Trigger model

An agent trigger is source-owned configuration with one exact discriminator:

```ts
type NpAgentTrigger =
  | {
      type: "event";
      id: string;
      eventKind: NpAgentEventKind;
      filter: NpAgentTriggerFilter;
      coalesceSeconds: number;
    }
  | {
      type: "schedule";
      id: string;
      cron: string; // validated five-field UTC cron
      catchUp: "skip" | "once";
    }
  | {
      type: "manual";
      id: string;
    };
```

There is no arbitrary code or prompt predicate. `NpAgentTriggerFilter` is a
small exact expression language over approved event fields: equality,
membership, integer threshold, and logical `all`/`any`, with bounded depth and
term count. It cannot read event prose, follow links, perform regex supplied by
an operator, or reference another site. An agent that subscribes to several
event kinds owns one trigger row per kind; this keeps dispatch indexes and
definition fingerprints exact.

```ts
type NpAgentTriggerField =
  | "privacy"
  | "source.kind"
  | "subject.kind"
  | "payload.outcome"
  | "payload.reasonCode"
  | "payload.status"
  | "payload.category"
  | "payload.severity"
  | "payload.count";

type NpAgentTriggerScalar = string | number | boolean;
type NpAgentTriggerFilter =
  | { op: "eq"; field: NpAgentTriggerField; value: NpAgentTriggerScalar }
  | {
      op: "in";
      field: NpAgentTriggerField;
      values: NpAgentTriggerScalar[];
    }
  | {
      op: "gte" | "lte";
      field: "payload.count";
      value: number;
    }
  | { op: "all" | "any"; terms: NpAgentTriggerFilter[] };
```

The filter is analyzed against its trigger's one event kind, so nonexistent
fields and wrong operand types fail activation. It is at most four levels, 32
total terms, and 20 unique `in` values; strings are at most 128 characters and
numbers are safe integers. Empty `all`/`any`, regex, negation, paths outside
the inventory, and caller-defined property access are invalid.

A manual trigger is not a free-form provider prompt. The authenticated Admin
`Run now` service resolves one active Agent/version and one enabled
`type=manual` trigger, accepts a bounded goal plus recipe-defined exact inputs
and a caller-stable idempotency key, then runs the same policy/budget/admission
path as event and schedule dispatch. It cannot add capabilities, scopes,
targets, model ids, or evidence sources outside that version. A paused/error/
archived Agent or a trigger from another version fails before a run row is
created.

Trigger dispatch is at-least-once:

1. record the event;
2. execute all deterministic detectors that subscribe to its kind;
3. match enabled site agents and policies;
4. derive/validate the same-site causal root/parent/depth, then create a run
   using a unique trigger fingerprint;
5. enqueue the run only after the row commits;
6. mark dispatch complete with compare-and-swap.

A causation-bearing event always uses `sourceRunId` as the candidate parent;
an event without causation starts a new root. The server does not search for a
different ancestor or reset depth because a trigger/agent changes. A malformed,
foreign, missing, cyclic, or over-depth lineage fails before a run row/job or
provider reservation is created and opens one integrity/loop signal keyed by
root/event/trigger.

A periodic reconciliation sweep finds committed event/run rows, queued
connection operations, queued/due notification outbox rows, and due
restriction/containment expiries that were not enqueued because a producer
stopped between commit and queue admission. It fans out only exact site-stamped
dispatch/run/connection/notification jobs. For each due containment it
compare-and-swaps the existing source action/containment into their declared
compensation path and enqueues `agent:actionVerify {siteId, actionId}` with
that source action; duplicate dispatch returns the existing
fingerprint/idempotency key. Schedules store `nextRunAt`; one global tick
claims due rows in fixed cursor batches, advances them before enqueue, and
fans out exact site-stamped runs. A missed schedule either skips or executes
once according to its source definition; it never replays an unbounded number
of historical ticks.

Manual Admin and internal API triggers create the same persisted run and audit
records. General inbound webhooks are not an MVP trigger. An integration must
authenticate, parse its vendor payload into an exact normalized event, and
discard unknown fields before runtime dispatch.

## Durable pg-boss jobs

The following proposed built-in handlers use the current jobs contract. Every
site job has an exact top-level canonical `siteId`, a deterministic parser, and
`resolveSiteId`. No handler reads request-local state.

| Job name                         | Exact payload                                                                   | Purpose                                                        | Site job quota                     |
| -------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `agent:eventDispatch`            | `{ siteId, eventId }`                                                           | deterministic detector, trigger, signal, and incident dispatch | exempt infrastructure continuation |
| `agent:eventReconcile`           | `{}`                                                                            | fixed-batch recovery that fans out site work                   | global maintenance                 |
| `agent:scheduleTick`             | `{}`                                                                            | fixed-batch claim and fan-out of due Agent schedules           | global maintenance                 |
| `agent:connectionOperate`        | `{ siteId, operationId }`                                                       | worker-only connection probe/OAuth exchange/refresh/activation | exempt setup continuation          |
| `agent:vaultOperate`             | `{ siteId, vaultOperationId }`                                                  | inspect/recover one persisted vault operation                  | exempt setup continuation          |
| `agent:runExecute`               | `{ siteId, runId }`                                                             | claim or resume one persisted run state machine                | participates on initial admission  |
| `agent:actionVerify`             | `{ siteId, actionId }`                                                          | verify, undo, or expire one already admitted direct mutation   | exempt convergence continuation    |
| `agent:notificationSend`         | `{ siteId, notificationId, expectedAttempt }`                                   | claim one deduplicated Admin/external delivery attempt         | exempt convergence continuation    |
| `agent:changesetValidate`        | `{ siteId, changeSetId, draftVersion, draftHash, generation }`                  | validate one immutable draft generation                        | participates                       |
| `agent:changesetPreview`         | `{ siteId, changeSetId, planHash, generation }`                                 | render/check one sealed preview generation                     | participates                       |
| `agent:changesetApply`           | `{ siteId, changeSetId, planHash, approvalId, scheduledFor, idempotencyKey }`   | claim approval and execute immediate/scheduled apply           | participates on initial admission  |
| `agent:changesetVerify`          | `{ siteId, changeSetId, executionId }`                                          | converge one committed apply/rollback execution                | exempt convergence continuation    |
| `agent:changesetRollbackPrepare` | `{ siteId, changeSetId, rollbackPlanId }`                                       | construct/validate one compensation generation                 | participates                       |
| `agent:changesetRollbackExecute` | `{ siteId, changeSetId, rollbackPlanId, planHash, approvalId, idempotencyKey }` | claim approval and execute one rollback plan                   | participates on initial admission  |
| `agent:retentionTick`            | `{}`                                                                            | fixed-batch site selection/fan-out                             | global maintenance                 |
| `agent:retentionPrune`           | `{ siteId }`                                                                    | apply exact site retention in cursor batches                   | exempt maintenance                 |
| `agent:siteDelete`               | `{ siteId, sagaId, planHash }`                                                  | resume external cleanup and final deletion saga                | exempt maintenance                 |
| `guardian:incidentAnalyze`       | `{ siteId, incidentId, expectedVersionNumber }`                                 | optional provider analysis of one current incident version     | participates                       |

`agent:eventReconcile`, `agent:scheduleTick`, and `agent:retentionTick` have
fixed framework schedules and serialize globally with Postgres advisory locks;
they only claim bounded rows and enqueue exact site-stamped work.
`agent:vaultOperate`, `agent:retentionPrune`, and every
ChangeSet/deletion/Guardian job are site jobs with `resolveSiteId`. Agent job
names are translated to the physical pg-boss namespace by the existing
adapter, just like all other jobs.

The `quota` column refers to the shipped rolling `site.quotas` job ceiling.
Agent-triggered provider work participates. Deterministic evidence persistence,
incident creation, and verification/undo of an already admitted write must
still converge if that ceiling is reached. Agent-specific token and money
budgets remain separate and do not add fields to the current exact
`site.quotas` object.

Handlers resolve to `undefined`. Throwing a transient error lets pg-boss retry;
a contract, authorization, budget, policy, or approval failure is persisted as
a terminal run state before the handler returns. A crash after a capability
call is recovered through its caller-stable idempotency key and persisted
action row, not by hoping that the provider will repeat the same answer.

## Run state machine

```text
queued
  -> running
       -> waiting_approval
            -> queued (only after a distinct execute_approved invocation)
            -> failed (reject, revoke, or expiry)
       -> waiting_retry    -> queued
       -> verifying        -> succeeded
       -> policy_blocked
       -> budget_blocked
       -> failed
  -> cancelled
```

Runs claim through compare-and-swap and a lease with a bounded expiry. A stale
lease can be reclaimed, but the next worker resumes from persisted steps:

- trigger snapshot and policy version;
- provider connection and credential version;
- provider-call request digest, result, usage, and status;
- capability id, validated arguments digest, idempotency key, and result;
- approval challenge id when required;
- verification and undo outcome.

The runtime never reconstructs state from model conversation alone. A provider
call is one immutable turn. The selected recipe fixes one exact task/output
schema before dispatch. Native tool calling is normalized to that same
structured output:

```ts
type NpAgentInteractiveDecisionV1 =
  | { kind: "complete"; summary: string }
  | {
      kind: "propose-capability";
      capabilityId: NpAgentCapabilityId;
      arguments: NpAgentJsonObject;
      rationale: string;
    }
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest };

export const npAgentModerationReasonCodes = [
  "duplicate-link-burst",
  "repeated-template",
  "malicious-destination",
  "account-velocity",
  "coordinated-pattern",
  "abusive-language",
  "policy-evasion",
  "insufficient-evidence",
] as const;
type NpAgentModerationReasonCode = (typeof npAgentModerationReasonCodes)[number];

type NpAgentModerationDecisionV1 =
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest }
  | {
      kind: "classification";
      label: "spam" | "abuse" | "benign" | "uncertain";
      confidenceBasisPoints: number;
      reasonCodes: NpAgentModerationReasonCode[];
      evidenceDigests: string[];
      summary: string;
    };

export const npAgentGuardianAssessmentCodes = [
  "credential-stuffing-pattern",
  "authorization-probing",
  "traffic-anomaly",
  "content-integrity-anomaly",
  "availability-degradation",
  "agent-policy-abuse",
  "inconclusive",
] as const;
type NpAgentGuardianAssessmentCode = (typeof npAgentGuardianAssessmentCodes)[number];

type NpAgentGuardianDecisionV1 =
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest }
  | {
      kind: "assessment";
      disposition: "consistent" | "inconclusive" | "unlikely";
      confidenceBasisPoints: number;
      assessmentCodes: NpAgentGuardianAssessmentCode[];
      evidenceDigests: string[];
      summary: string;
    };

type NpAgentProviderTaskOutputV1 =
  | {
      task: "interactive-capability";
      decision: NpAgentInteractiveDecisionV1;
    }
  | {
      task: "moderation-classification";
      decision: NpAgentModerationDecisionV1;
    }
  | {
      task: "guardian-assessment";
      decision: NpAgentGuardianDecisionV1;
    };

type NpAgentEvidenceRequest =
  | {
      kind: "document";
      collection: string;
      documentId: string;
      projection: "metadata" | "bounded-text" | "schema";
    }
  | {
      kind: "incident";
      incidentId: string;
      projection: "signals" | "timeline" | "subject-state";
    }
  | {
      kind: "run";
      runId: string;
      projection: "summary" | "actions" | "checks";
    }
  | {
      kind: "ops-check";
      checkId: string;
    };
```

The task discriminator is server-selected and must match the recipe and
response-schema digest. Moderation and Guardian branches cannot contain
`propose-capability`; they are read-only assessments. Their confidence values
are safe integers in `0..10_000`, code/digest arrays are sorted unique with at
most 20 entries, and summaries are untrusted plain text of at most 2,000
characters. A deterministic server policy may convert a validated
classification/assessment plus current server facts into a separate
capability proposal after the provider call. That proposal passes normal
scope, target, risk, approval, idempotency, and verification admission and is
never copied from provider arguments.

For the interactive branch, the runtime validates `capabilityId` against the
run's allowlist, reparses arguments with the capability schema, recomputes risk
and approval, and rejects model-supplied ids, scopes, site ids, idempotency
keys, risk labels, or approval claims. The model cannot directly produce an
approval.

Evidence requests are exact, same-site, read-authorized references. One run
may request at most 32 evidence items and 2 MiB of canonical redacted context;
ids are at most 128 characters and collection/check identifiers at most 96.
There is no URL, arbitrary query, raw log selector, SQL, file path, plugin
method, or user-supplied projection.

Default limits are eight provider turns, eight capability proposals, and one
write action per run. Role policy may lower but not exceed deployment maxima.
Loops that repeat an identical evidence or capability request terminate with
`policy_blocked`.

## Recipe registry contract

Provider instructions and runtime algorithms are code-owned versioned recipes,
not free-form Agent settings:

```ts
export const npAgentRecipeIds = [
  "publisher.stale-content",
  "moderator.repeated-link-spam",
  "operator.worker-not-draining",
  "guardian.credential-stuffing",
  "guardian.agent-abuse",
] as const;

type NpAgentRecipeId = (typeof npAgentRecipeIds)[number];

type NpAgentRecipeSettingsV1 =
  | {
      recipeId: "publisher.stale-content";
      recipeVersion: 1;
      collectionSlugs: string[];
      staleAfterDays: number;
      candidateLimit: number;
      batchSize: number;
    }
  | {
      recipeId: "moderator.repeated-link-spam";
      recipeVersion: 1;
      collectionSlugs: string[];
      windowSeconds: number;
      minIndependentAccounts: number;
      minItems: number;
      automaticConfidenceBasisPoints: number;
    }
  | {
      recipeId: "operator.worker-not-draining";
      recipeVersion: 1;
      staleAfterSeconds: number;
      minimumPendingJobs: number;
      checkIds: string[];
    }
  | {
      recipeId: "guardian.credential-stuffing";
      recipeVersion: 1;
      audiences: Array<"staff" | "member">;
      windowSeconds: number;
      minimumFailures: number;
      minimumDistinctAccountBuckets: number;
      actorLimitTtlSeconds: number;
    }
  | {
      recipeId: "guardian.agent-abuse";
      recipeVersion: 1;
      windowSeconds: number;
      deniedScopeThreshold: number;
      repeatedProposalThreshold: number;
      costVelocityMicros: number;
      actionThreshold: number;
    };

interface NpAgentRecipeDefinitionV1 {
  id: NpAgentRecipeId;
  version: 1;
  allowedTemplates: Array<"publisher" | "moderator" | "operator" | "guardian" | "custom">;
  task: "interactive-capability" | "moderation-classification" | "guardian-assessment";
  providerMode: "required" | "optional" | "forbidden";
  triggerKinds: Array<"manual" | "event" | "schedule">;
  capabilityIds: NpAgentCapabilityId[];
  settingsSchema: NpAgentJsonSchema;
  manualInputSchema: NpAgentJsonSchema | null;
  responseSchema: NpAgentJsonSchema;
  instruction: {
    templateId: string;
    templateVersion: number;
    digest: string;
    text: string;
  } | null;
  fingerprint: string;
}
```

The registry has exactly one definition for every id/version and validates at
bootstrap. `settingsSchema` accepts only its matching union branch;
`manualInputSchema:null` forbids manual structured input. Arrays are sorted,
unique, and bounded: 1–32 collection/check ids, 1–2 audiences, 1–3 trigger
kinds, and 1–21 capabilities. Durations are safe integers in `60..86_400`,
stale days `30..3_650`, candidates `1..50`, batch size `1..5`, count
thresholds `1..100_000`, confidence `0..10_000`, and cost micros
`0..Number.MAX_SAFE_INTEGER`; deployment/site policy may narrow them.
Instructions, schemas, task, capabilities, provider mode, and bounds are
framework-owned and cannot appear in persisted settings.

`instruction` is null exactly for `providerMode:"forbidden"` and non-null for
required/optional provider recipes.

The host computes a definition `fingerprint` with canonical purpose
`np.agent-recipe-registry.v1`, `projection:"definition"`, and exactly one
recipe after all arrays/schemas/instruction bytes pass their owner analyzers.
The complete non-empty installed set uses the same purpose with
`projection:"registry"` to compute only the recipe-registry fingerprint.
Neither projection accepts or includes either derived fingerprint, and a
definition digest cannot stand in for the registry digest.

An Agent version stores 1–8 sorted `NpAgentRecipeSettingsV1` branches and the
registry fingerprint. Activation resolves every branch to its exact current
definition, rejects a missing/version-changed/incompatible recipe, and hashes
settings plus definition fingerprints. One admitted run selects exactly one
configured recipe and freezes recipe id/version/fingerprint, instruction
template id/version/digest, response-schema digest, and manual-input digest
when present. A provider call repeats those values; the provider request's
instruction/schema bytes must hash to them. Registry hot reload cannot change
an admitted run, and an old definition remains installed/readable until no
active version/run needs it.

## Provider adapter contract and lifecycle

Provider adapters are server-only:

```ts
interface NpAgentProviderRequest {
  schemaVersion: "np.agent-provider-request.v1";
  runId: string;
  provider: string;
  model: string;
  recipe: {
    id: NpAgentRecipeId;
    version: number;
    fingerprint: string;
  };
  task: "interactive-capability" | "moderation-classification" | "guardian-assessment";
  instruction: {
    templateId: string;
    templateVersion: number;
    digest: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  };
  trustedContext: Array<{
    id: string;
    kind: "policy" | "schema" | "capability" | "server-fact";
    digest: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  }>;
  untrustedEvidence: Array<{
    id: string;
    kind: "content" | "event" | "signal" | "incident" | "ops-check";
    digest: string;
    observedAt: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  }>;
  responseSchema: NpAgentJsonSchema;
  responseSchemaDigest: string;
  responseSchemaClassification: NpAgentProviderContextClassificationV1;
  tools: Array<{
    capabilityId: NpAgentCapabilityId;
    descriptorFingerprint: string;
    classification: NpAgentProviderContextClassificationV1;
    inputSchema: NpAgentJsonSchema;
  }>;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    timeoutSeconds: number;
  };
  pricing: NpAgentModelPricingV1;
  dataClass: NpAgentProviderDataClass;
  dataClassCeiling: NpAgentProviderDataClass;
}

interface NpAgentProviderContextClassificationV1 {
  dataClass: NpAgentProviderDataClass;
  classifierId: string;
  classifierVersion: number;
  sourceDigest: string;
}

interface NpAgentProviderUsageV1 {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  tokenSource: "provider" | "adapter-estimate";
  costMicros: number;
  costSource: "provider" | "adapter-estimate";
}

type NpAgentProviderInvokeOutcomeV1 =
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "succeeded";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: NpAgentJsonValue;
      usage: NpAgentProviderUsageV1;
      finishReason: "stop" | "length" | "tool";
      latencyMs: number;
    }
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "failed";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: null;
      errorClass:
        | "authentication"
        | "rate-limited"
        | "transient"
        | "timeout"
        | "invalid-request"
        | "invalid-output"
        | "content-policy"
        | "cancelled"
        | "unknown";
      safeCode: string;
      retryable: boolean;
      dispatchState: "not-dispatched" | "dispatched";
      usage: NpAgentProviderUsageV1 | null;
      finishReason: "content-filter" | "cancelled" | null;
      latencyMs: number;
    }
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "ambiguous";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: null;
      errorClass: "timeout" | "unknown";
      safeCode: string;
      retryable: false;
      dispatchState: "unknown";
      usage: null;
      finishReason: null;
      latencyMs: number;
    };

interface NpAgentProviderHealth {
  schemaVersion: "np.agent-provider-health.v1";
  status: "ready" | "degraded" | "unavailable";
  checkedAt: string;
  safeCodes: string[];
}

interface NpAgentProviderAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly credentialEnvelopeVersions: readonly [1];
  invoke(
    request: NpAgentProviderRequest,
    context: {
      credentialLease: NpProviderCredentialLease;
      connection: NpAgentConnectionConfigSnapshotV1;
      signal: AbortSignal;
    },
  ): Promise<NpAgentProviderInvokeOutcomeV1>;
  healthCheck?(): Promise<NpAgentProviderHealth>;
  shutdown?(): void | Promise<void>;
}
```

The request is exact and bounded. It contains a configured provider/model id,
versioned server instruction template, separately labelled trusted context and
untrusted evidence, an exact response schema, approved tool descriptors, and
input/output token ceilings. `pricing` is the exact rule selected from the
immutable connection snapshot at reservation time. It is local adapter-control
data used only to normalize estimates; it is not provider-bound. The request
never contains the plaintext credential,
approval secret, MCP token, cookie, CSRF token, database URL, or unrelated site
data.

Trusted/untrusted arrays are unique by id, at most 64 items each, 2 MiB
combined after redaction, and every text item is length-bounded. The
task/response-schema digest must match the admitted recipe. Tools are empty for
moderation/Guardian tasks and contain only admitted capability descriptors for
interactive tasks.

Classification is server-derived from one closed source registry:

| Provider-bound component | Exact default/source rule                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| instruction              | fixed recipe-definition class; default `internal-redacted`                                  |
| `policy`                 | policy definition classification; default `internal-redacted`                               |
| schema/capability        | public discovery projection is `public-only`; any private projection is `internal-redacted` |
| `server-fact`            | fixed class on the registered fact definition                                               |
| `content`                | maximum of live audience and every selected field's provider-data classification            |
| `event`                  | `privacy:public/internal/sensitive` maps to the three classes in rank order                 |
| `signal`                 | maximum of its retained evidence/source classes                                             |
| `incident`               | maximum of linked evidence and at least `internal-redacted`                                 |
| `ops-check`              | fixed class on the registered check; default `internal-redacted`                            |

Public content is `public-only`; member/private content is at least
`internal-redacted`; an explicitly sensitive field/source is
`sensitive-approved`. Redaction does not lower a class in v1. Every item
records classifier id/version and authoritative source digest; callers,
plugins, model output, and recipe settings cannot provide them.
The instruction, response schema, and every tool input schema carry the same
classification contract even though they are not context-array items.
`request.dataClass` is the numeric maximum of the instruction, response
schema, tool schemas, and every included context/evidence item's class
(`public-only` only when every component is public). `dataClassCeiling` is the
frozen numeric minimum of deployment, connection, site, Agent, and policy
ceilings. The server recomputes both and requires
`rank(dataClass) <= rank(dataClassCeiling)` before opening a credential lease.
A required over-ceiling item blocks the call; an optional item may be omitted
only by the recipe's exact context-selection rule and is never relabelled.

Only `instruction.text`, classified context/evidence text, the response
schema, and admitted tool descriptors are provider-bound. `runId`, local
digests, classifier metadata, pricing, connection snapshot, and credential
lease are adapter control inputs and must not be copied into provider prompts,
metadata, headers, or tool descriptions.

The normalized result contains:

- provider and concrete model identifiers;
- one exact recipe-discriminated `NpAgentProviderTaskOutputV1`;
- integer input, cached-input, and output token counts;
- exact provider-reported or adapter-estimated token source;
- integer USD-micros cost plus provider-reported or adapter-estimated source;
- a bounded provider request id safe for support;
- finish reason and latency;
- no unknown provider response fields.

All counts/cost/latency are non-negative safe integers. A provider-backed call
is not admitted without an exact USD-micros pricing rule, so normalized
`costMicros` is never null. The host recomputes an
`adapter-estimate` from `request.pricing` using the canonical integer formula;
a different estimate is malformed. Provider-reported cost is retained as
reported even when it differs. The server validates successful `output`
against the request schema and selected `NpAgentProviderTaskOutputV1` branch
before persisting a decision.

The invoke outcome is total. `succeeded` always has output, complete usage,
and `stop|length|tool`. `failed/not-dispatched` has null usage/finish and
cannot expose a provider request id. `failed/dispatched` may carry either one
complete usage object or null; `content-policy` requires
`finishReason:"content-filter"`, `cancelled` requires
`finishReason:"cancelled"`, and every other error requires null finish reason.
`ambiguous` is the only unknown-dispatch branch and retains no claimed usage or
finish. `retryable:true` is permitted only for a returned
`rate-limited|transient|timeout` failure whose dispatch state and provider
contract prove replay safe; invalid output may use one separately bounded
repair attempt. Authentication opens the connection circuit immediately.

An adapter rejection/throw, abort race, malformed union, schema mismatch, or
timeout without an exact returned branch is normalized by the host to
`ambiguous` with `errorClass:"unknown"`, `safeCode:"PROVIDER_OUTCOME_UNKNOWN"`,
`retryable:false`, and the maximum reservation retained. Arbitrary exception
text is never used for classification or persisted. Thus an implementation
cannot infer before/after-dispatch or retry safety from an exception type.

Provider registration is transactional and source-owned. Duplicate ids with
different adapters, malformed adapters, non-void calls, and mismatched
environment intent fail bootstrap. An invocation receives an `AbortSignal` and
a hard wall-clock deadline; adapters must not install their own process signal
handlers. Shutdown prevents new calls, aborts after the drain deadline, awaits
all adapter shutdown hooks, zeroizes in-process credential buffers where the
runtime permits, and reports aggregate failures through the safe
observability facade.

## Admission budgets and circuit breakers

Budget admission occurs before building a provider prompt and again before
each additional turn. Counters use Postgres, site-scoped transaction locks,
integer units, and conservative reservations.

The exact dimensions, integer bounds, inheritance, rolling/calendar windows,
and composition rules are the single `NpAgentBudgetV1` contract in
[data-model.md](data-model.md#461-exact-capability-mode-budget-and-policy-rule-contracts).
It covers run/provider concurrency, hourly admission, per-run provider calls/
tokens/attempts/capability calls, daily/monthly tokens and cost micros,
incident analysis per fingerprint/cooldown, and direct action site/subject
frequency. Admin and admission do not maintain parallel inventories.

`null` means the next concrete outer ceiling, not unbounded. `0` disables the
activity. The deployment sets hard maxima that a site admin cannot raise.
Provider usage is reserved from the requested maximum before invocation and
reconciled to the validated result afterward. If usage or cost cannot be
measured exactly in USD micros, every provider-backed run fails admission in
v1, including human-triggered advisory work. An unpriced-provider exception
would require a new exact budget/policy mode and is not inferred from `null`.

Circuit breakers exist at four levels:

1. **Connection:** authentication failure, repeated provider 429/5xx, or
   malformed output pauses new calls for that provider connection.
2. **Agent:** repeated failed runs, repeated policy violations, or identical
   action loops disables its triggers.
3. **Site:** spend exhaustion, event backlog, action-rate threshold, or
   emergency pause blocks all new provider calls and automatic writes.
4. **Subject/fingerprint:** repeated signals or content churn enters cooldown
   instead of repeatedly calling a model.

Opening a breaker records `agent.policy.blocked`, produces an Admin alert, and
does not discard the originating event or signal. Half-open probes are
read-only and limited to one concurrent call. Only deterministic recovery
criteria or an authorized human can close an authentication or policy breaker.

Rate limits at the proxy and MCP boundary remain independent defense in depth.
An attacker must not be able to spend model budget merely by creating HTTP
requests; aggregation thresholds, deduplication, cooldowns, and site budgets
all precede provider admission.

## Deterministic detection before model reasoning

Guardian and Moderator always evaluate cheap exact controls first:

- current auth lockout and proxy rate-limit decisions;
- community profanity/spam adapter verdicts;
- duplicate content/link hashes and account-age/write-rate thresholds;
- failed-login counts by salted actor bucket, audience, and bounded time
  window;
- 401/403/404 aggregates by route family, never unbounded raw path;
- sensitive role, agent-policy, credential, or plugin state transitions;
- worker heartbeat, queue backlog, recent failure, backup, storage, quota,
  Doctor, and readiness contracts;
- content revision volume and actor diversity over a fixed window;
- edge/WAF or error-reporter signals already classified by their adapter.

Exact rules may open an incident, notify, or perform a separately authorized
reversible action without a model. A model may:

- summarize multiple bounded signals;
- classify ambiguous community content;
- propose a capability and explain evidence;
- draft a ChangeSet or an ops plan.

A model may not lower severity, suppress an exact critical rule, close an
incident, increase a budget, extend a temporary restriction, or bypass an
approval. Human feedback can tune a future detector version but never rewrites
the original signal.

## Capability action, verification, and rollback

Runtime recipes use the canonical capability inventory:

- `site.inspect`, `schema.get`, and `content.query`;
- `changeset.create`, `changeset.get`, `changeset.list`,
  `changeset.validate`, `changeset.preview`, `changeset.schedule`,
  `changeset.apply`, and `changeset.rollback`;
- `audit.run`;
- `ops.status`, `ops.plan`, and `ops.execute`;
- `incident.get` and `incident.list`;
- `moderation.quarantine` and `moderation.restore`;
- `security.limitActor`;
- `security.revokeSessions`.

`ops.execute` accepts only `cache.revalidate`, `agent.run.retry`, and
`agent.run.cancel` in v1. Retry creates a linked run and repeats all admission
checks; cancellation is cooperative before the target's database commit
boundary. Migration, restore, storage, plugin, and queue-global actions remain
plan-only local CLI handoffs.

ChangeSet capabilities require their own `changeset:read`, `changeset:write`,
or `changeset:apply` scope plus resource-derived `content`, `media`,
`navigation`, `theme`, and `settings` read/write/publish scopes. A role
template receives only the explicit resource families selected by its human
owner. Creating one ChangeSet never turns `content:draft` into authority over
navigation, theme tokens, settings, or media, and every validation, preview,
approval, apply, verification, and rollback rechecks the complete derived
scope set.

The action path is fixed:

1. load the current site, agent, connection, run-frozen policy refs, current
   hard policy, run, and subject;
2. validate agent status, scope, budget, breaker, expected row versions, and
   the intersection of frozen/current hard rules; a later expansion never
   widens an admitted run;
3. parse capability arguments and discard model-provided authority metadata;
4. compute risk and approval from the registered capability plus site policy;
5. create an immutable action record and caller-stable idempotency key;
6. stop at `waiting_approval`, or execute through the common facade;
7. persist the exact result before another provider turn;
8. enqueue capability-specific verification;
9. mark success only after verification;
10. invoke the registered undo/rollback path when verification fails and the
    action is reversible;
11. update incident containment and notify from server-computed outcomes.

An approval decision and its dependent state transition are one transaction.
Approve moves the action to `approved` and leaves its run
`waiting_approval` until a distinct `execute_approved` invocation is admitted.
Reject/revoke/expiry moves the action and a still-waiting run to `failed` with
the same exact `APPROVAL_REJECTED`, `APPROVAL_REVOKED`, or
`APPROVAL_EXPIRED` code. Bounded site retention reconciliation applies expiry
if no request touches the rows; dispatch checks it synchronously. Terminal
failed/cancelled/policy-blocked actions and runs are never resumed, and a new
attempt creates new lineage. The sole post-success action transition is the
frozen `succeeded -> compensated` convergence defined by the effect contract;
it does not resume the run or original invocation.

`moderation.quarantine` preserves the original visibility/status and returns a
bounded undo handle. `security.limitActor` is temporary, scope-specific, and
has an exact expiry. `security.revokeSessions` targets one server-resolved
principal and exact session family, is sensitive and non-reversible, and
requires human approval; it never means “revoke whatever the model
describes.” ChangeSet and ops actions retain their own approval, plan digest,
apply, audit, verification, and rollback contracts.

`security.limitActor` cannot mutate the existing process-local rate-limiter
singleton from a worker. It writes one durable, site-scoped, TTL-bound
restriction and dispatches through an exact restriction adapter that is also
installed in the proxy entrypoint. The proxy maps the current request to the
current plus every still-active frozen projection/key candidate (maximum
eight) and denies when any exact bucket matches; authenticated principal
namespaces use one exact candidate. It enforces the restriction before the
ordinary rate counter. Multi-node automatic limiting requires a shared adapter; with memory
mode or an unavailable enforcement adapter, the capability is unavailable and
Guardian creates a plan/incident instead. Expiry restores access without a
provider call, and early removal is an audited human action. The existing
`NpRateLimiterAdapter` contract remains unchanged.

The canonical adapter request/result/idempotency/verify/check/health contract
is defined once in [architecture.md](architecture.md#8-adapter-boundaries).
At expiry the source action's frozen compensator calls `remove` with the
original descriptor and a stable
`expire:<containmentId>:<version>:<expiresAt>` key, accepts only confirmed
`removed|already_absent`, persists the receipt/compensation fields, then
atomically marks the source action `compensated` and both restriction and
containment expired. This convergence is framework-owned and does not create
or reuse an invocation, principal, or provider call. Failure/`unknown` remains
retryable and visible; it does not leave an `active` database row forever or
release the uniqueness guard prematurely.

If execute succeeds but persistence of the result is ambiguous, the run stays
`verifying` and the action records an ambiguous verification outcome; the
runtime uses the same idempotency key and read-side verifier rather than
executing again with new arguments.

## Role templates

Templates are locked starting points. Enabling a role creates a site-owned
agent definition with explicit scopes, triggers, budgets, and autonomy; it
does not create a hidden super-agent.

| Template  | Default triggers                                                             | Read/proposal surface                                                                        | Automatic mutation ceiling                                                                                         |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Publisher | weekly schedule; content freshness audit                                     | `site.inspect`, `schema.get`, `content.query`, explicitly scoped ChangeSet create/validation | draft ChangeSet only; schedule/apply requires `changeset:apply`, derived resource scopes, and fresh human approval |
| Moderator | community create/report events; spam-burst signal                            | content query, incident read, quarantine proposal                                            | high-confidence spam quarantine only; restore or account action requires human/policy                              |
| Operator  | worker stale, job threshold, backup/storage/Doctor changes; daily status     | `ops.status`, `ops.plan`, `audit.run`, incident read                                         | read and plan only by default; `ops.execute` remains action-allowlist and approval bound                           |
| Guardian  | auth/authz aggregates, agent-policy changes, edge signals, integrity signals | site/audit/incident reads and security proposals                                             | short `security.limitActor` may be policy-allowed; `security.revokeSessions` always requires human approval        |

Publisher never changes collection code, schemas, migrations, or plugins.
Moderator never issues a permanent ban or deletes content. Operator never runs
arbitrary CLI arguments and cannot approve its own plan. Guardian never edits
WAF rules directly in the initial release; it may consume WAF evidence and
create a bounded connector action in a later separately reviewed capability.

## Notifications and escalation

Notifications are derived from persisted state transitions, not provider prose.
Channels are:

- Agent Studio activity for every run and action;
- approval inbox for approval-gated actions;
- Admin incident feed for open high/critical incidents;
- configured email or Slack/webhook connector for escalation;
- optional export adapter for a SIEM.

The exact notification payload contains site, incident/run/action ids,
server-computed severity/status, a local Admin path, and a redacted summary. It
does not contain content bodies, raw logs, credentials, cookies, IP addresses,
provider prompts, or approval tokens. Connector destinations are configured
out of band; a model cannot choose a URL or recipient.

Notifications deduplicate by site, channel, incident version, and transition.
Medium incidents notify on open and material escalation. High incidents notify
on open, failed containment, and resolution. Critical incidents notify
immediately once for that exact transition. V1 has no time-based repeat or
notification-only acknowledgement state; another delivery requires a new
server-sequenced incident transition/version such as escalation or failed
containment. Delivery failure follows the bounded adapter contract and never
rolls back a containment action.

## Retention and deletion

Proposed defaults are:

| Record                                            | Default retention after terminal/creation state |
| ------------------------------------------------- | ----------------------------------------------- |
| normalized events                                 | 14 days                                         |
| signals                                           | 90 days                                         |
| redacted provider request/result bodies           | 30 days                                         |
| completed run steps and detailed job context      | 90 days                                         |
| incidents, actions, approvals, and security audit | 365 days                                        |
| daily usage/cost aggregates                       | 400 days                                        |

Exact limits are deployment-owned. A site may choose a shorter policy but not
longer than the deployment maximum. V1 has no legal-hold feature; a deployment
that requires one must keep the affected feature disabled or implement the
separately reviewed exact hold contract before changing these maxima. Pruning
uses fixed cursor batches and records counts; it never scans or deletes another
site. Open incidents, waiting approvals, incomplete actions, active runs, and
the evidence they require are not pruned.

Provider prompt/result storage is off by default beyond the redacted exact
runtime decision and usage metadata. Enabling diagnostic body retention
requires an explicit site policy and still applies data classification,
redaction, encryption, bounds, and expiry.

Agent-enabled site deletion first commits a non-serving deletion marker, then
runs idempotent external cleanup for actor restrictions, vault/provider
credentials, and preview objects with persisted receipts. Only after every
receipt is exact does the existing serialized database deletion transaction
remove all `np_agent_*` rows and the site. Failure leaves the site unavailable
and retryable rather than restoring a partially cleaned tenant. The complete
saga and delete order are defined in [data-model.md](data-model.md#10-site-and-user-deletion).

Staff/member deletion removes direct profile data and replaces retained audit
actor references with a stable site-local tombstone when retention policy
requires history. External provider account/data-deletion guarantees beyond
credential revocation remain the provider connection owner's responsibility
and must be displayed in Agent Studio.

## Concrete MVP recipes

### 1. Stale-content improvement

1. Publisher runs every Monday at 02:00 UTC.
2. `content.query` finds published documents older than 180 days in configured
   collections, capped at 50 candidates.
3. Deterministic checks rank missing metadata, broken internal links, and
   stale referenced documents.
4. At most five documents enter one provider run.
5. The provider may call `changeset.create`, `changeset.validate`, and
   `changeset.preview`.
6. The run stops with a preview and approval. It never publishes by default.
7. After `changeset.apply`, verification checks the persisted revisions,
   public response, links, and preview digest. Failure calls
   `changeset.rollback`.

Acceptance: rerunning the same schedule before the cooldown expires does not
create another ChangeSet for the same document/revision pair.

### 2. Repeated-link spam campaign

1. Community writes continue through the shipped profanity and spam adapters.
2. A deterministic detector groups normalized link-domain hashes by site over
   ten minutes and requires minimum independent-account and content counts.
3. A high-confidence exact rule opens one spam incident and quarantines only
   the matching pending/public targets through `moderation.quarantine`.
4. Ambiguous evidence invokes Moderator only after budget admission; it may
   propose additional quarantines but not delete content or ban a member.
5. Admin can use `moderation.restore`; feedback records `confirmed-spam` or
   `false-positive` against the detector version.

Acceptance: an injected instruction in a comment does not alter the agent
prompt, scopes, action target, approval, or detector threshold.

### 3. Worker not draining

1. The existing worker heartbeat and queue health contract emits a signal only
   after the configured stale threshold and pending-job minimum are both met.
2. Operator calls `ops.status`, correlates recent failures, and creates an
   `ops.plan` using the shipped `worker-not-draining` runbook.
3. The plan is displayed with exact evidence. Worker restart, raw-job
   retry-all, and queue resume remain plan-only local CLI/runbook handoffs in
   v1; `ops.execute` cannot turn approval prose into those global mutations.
4. Verification requires a live heartbeat and a decreasing backlog over a
   bounded monitoring window.

Acceptance: a paused queue is reported as paused and is not misclassified as a
dead worker.

### 4. Credential-stuffing attempt

1. The proxy/auth boundary aggregates failed login events by site, audience,
   route family, salted IP bucket, and account-target bucket.
2. Deterministic thresholds open an authentication incident. No username,
   password, token, or raw IP enters the event or provider prompt.
3. Existing auth lockout and shared rate limiter remain the first enforcement.
4. When configured, Guardian may apply a short `security.limitActor` action to
   the resolved bucket; `security.revokeSessions` may revoke the selected
   principal's exact session family only after its default human approval.
5. A high/critical escalation notifies the operator and suggests WAF review.
6. Verification observes failure-rate decay and legitimate-login impact. The
   temporary limit expires automatically.

Acceptance: the recipe works without a provider connection; model analysis
only improves the incident summary.

### 5. Agent runaway or policy abuse

1. Repeated identical capability proposals, denied scope attempts, spend
   velocity, and action count produce `agent-abuse` signals.
2. The deterministic site/agent breaker disables new provider calls and
   automatic mutations.
3. Active provider results arriving after the breaker opens are retained as
   untrusted diagnostic output and cannot execute a capability.
4. Admin reviews activity, revokes the connection if necessary, and explicitly
   re-enables the agent.

Acceptance: disabling an agent does not remove its audit history and queued
verification/undo work can still converge.

## Diagnostics and operations

Agent Runtime adds exact Doctor/health checks:

- `agents.contract` — definitions, scopes, trigger schemas, policy versions,
  and persisted row projections;
- `agents.providers` — configured intent, adapter inventory, credential
  metadata, connection breaker, and redacted health;
- `agents.worker` — registered handlers, schedules, stranded events/runs,
  queue availability, and oldest runnable age;
- `agents.budgets` — measurement availability, current reservations, spend,
  and exhausted limits;
- `agents.retention` — pruning schedule, backlog, and records past policy;
- `guardian.signals` — detector registry, versions, invalid evidence, open
  critical incidents, and notification failures.

Malformed persisted state is blocking; Doctor never substitutes empty arrays,
epoch timestamps, unlimited budgets, or a healthy provider. Missing jobs
disable server-side agents but do not disable external read-only MCP. Missing
provider configuration leaves deterministic detectors, incidents, and
notifications operational.

Admin and `ops status` report queue state separately from provider, policy,
budget, and action state so an operator can distinguish “no trigger,” “no
worker,” “budget blocked,” “approval waiting,” and “provider unavailable.”

## Implementation order and acceptance

1. Land exact event, signal, incident, run, usage, and provider contracts plus
   migrations and site deletion.
2. Add event recording at auth, community, content, jobs, and ops boundaries;
   ship deterministic detectors without any provider call.
3. Add durable dispatch, reconciliation, schedules, state-machine leases,
   idempotency, Admin activity, and diagnostics.
4. Add vault-backed provider adapters, reservations, breakers, redacted
   request/result persistence, and advisory-only runs.
5. Add Publisher/Moderator recipes and capability verification.
6. Add Operator and Guardian direct reversible actions only after approval,
   adversarial, quota, and recovery gates pass.

No role is complete until it has exact contract tests, Postgres concurrency
tests, queue crash/retry tests, cross-site tests, budget and breaker tests,
prompt-injection fixtures, Admin visibility, Doctor coverage, scaffold
configuration, a live guide, and changesets for published packages.
