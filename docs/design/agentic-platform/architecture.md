# NexPress Agentic Platform — architecture

> Status: proposed implementation architecture. Nothing in this document is a
> shipped contract until the matching code, migration, live guide, and package
> changeset land.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
>
> Shared constraints: read
> [`README.md`](README.md) first. Exact capability and transport contracts live
> in [`capabilities-and-mcp.md`](capabilities-and-mcp.md); persisted rows,
> ChangeSet state, runtime behavior, credentials, and verification are defined
> by the other documents in this directory.

## 1. Architectural objective

NexPress should let an external coding agent build a normal NexPress
application and let a running site execute bounded agent operations without
turning either path into arbitrary production code execution.

The architecture therefore has two independent planes:

```text
Build plane                                         Runtime plane
───────────                                         ─────────────
Prompt / repository brief                          MCP client or server trigger
        │                                                     │
        ▼                                                     ▼
External coding agent                              Agent Gateway / Agent Runtime
        │                                                     │
        ▼                                                     ▼
Files, config, collections, migration              Shared capability + policy
        │                                                     │
        ▼                                                     ▼
Git diff → schema:gen → migration review            ChangeSet / direct safe action
        │                                                     │
        ▼                                                     ▼
build → typecheck → test → deploy                   validate → approve → apply
```

The planes share public schemas and product terminology, but not authority:

- the **Build Agent** may change collection definitions, application code,
  package manifests, and migrations because its output remains a repository
  change reviewed through Git and CI;
- a **Runtime Agent** cannot edit code, install a package, execute a migration,
  issue arbitrary SQL or shell commands, read secrets, or grant itself
  authority;
- deployment creates the runtime capability inventory. A model cannot expand
  that inventory from a prompt or a persisted site setting.

This boundary is a product invariant, not merely an initial UI choice.

## 2. Existing contracts that remain authoritative

The implementation extends the current runtime instead of building a parallel
CMS stack:

| Concern           | Existing owner reused by the agent platform                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Process lifecycle | `createBootstrap()` and `ensureFor("read" \| "plugins" \| "worker" \| "write")` in `@nexpress/next`          |
| Database          | the one `setDb()` / `getDb()` singleton created by bootstrap                                                 |
| Site scope        | `withCurrentSite()`, canonical site ids, and `canOnSite()` from `@nexpress/core/sites`                       |
| Content writes    | the collection pipeline, including ACL, validation, hooks, revisions, media refs, search, and follow-up jobs |
| Media and storage | `@nexpress/core/media` and validated `@nexpress/core/storage` operations                                     |
| Plugins           | process-global installation plus site-scoped activation from the current plugin host                         |
| Jobs              | exact `@nexpress/core/jobs-contract` payloads and the pg-boss worker                                         |
| Errors            | the closed `NpApiError` envelope and fixed known-code/status map                                             |
| Metadata          | live collection/block/plugin discovery and OpenAPI schemas                                                   |
| Operations        | the shipped status, doctor, plan/apply, audit, and runbook contracts                                         |
| Observability     | the failure-contained logger and error reporter facade                                                       |
| Rate limiting     | the independently bootstrapped proxy adapter                                                                 |

An agent operation must call the same domain service a human or framework route
would call. It must not create a second DB pool, issue direct collection-table
writes, call a storage adapter directly, duplicate plugin loading, or use a raw
pg-boss instance.

## 3. Logical components

```text
┌────────────────────────────────────────────────────────────────────┐
│ External clients                                                    │
│ Codex / Claude / IDE / automation      Admin Agent Studio          │
└───────────────┬──────────────────────────────┬─────────────────────┘
                │ MCP / agent HTTP             │ staff session + CSRF
                ▼                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ @nexpress/app                                                       │
│ Agent Gateway routes, Admin APIs, auth projection, response mapping │
└───────────────┬──────────────────────────────┬─────────────────────┘
                │ transport-neutral invoke     │ browser-safe wires
                ▼                              ▼
┌─────────────────────────────────────┐  ┌───────────────────────────┐
│ @nexpress/core/agents               │  │ @nexpress/admin/client    │
│ registry, authorize, policy, audit, │  │ Agent Studio views only   │
│ ChangeSets, runs, incidents, vault  │  └───────────────────────────┘
└───────────────┬─────────────────────┘
                │ exact domain calls
                ▼
┌────────────────────────────────────────────────────────────────────┐
│ Existing Core domains                                               │
│ collections · media · navigation · theme · settings · jobs · ops   │
└────────────────────────────────────────────────────────────────────┘

Dedicated worker process
┌────────────────────────────────────────────────────────────────────┐
│ bootstrap "worker" → install Agent Runtime → register handlers      │
│ → start pg-boss worker → provider/connection adapters on demand     │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 `agent-contract`

`@nexpress/core/agent-contract` is pure and client-safe. It owns:

- exact `NpAgentScope`, capability descriptor, invocation, run, approval,
  ChangeSet reference, incident reference, cursor, and error wire types;
- limits, analyzers, require helpers, and JSON Schema projections;
- no DB, Node-only library, model SDK, React, Next.js, MCP SDK, handler
  function, or secret-bearing type.

The Admin client, OpenAPI generator, `@nexpress/mcp`, and provider-independent
tests may import this subpath.

The AP-101 foundation currently registers these exact client-safe schemas:

```ts
export const npAgentWireContractSchemaVersionsV1 = [
  "np.agent-gateway-settings.v1",
  "np.agent-principal.v1",
  "np.agent-budget.v1",
  "np.agent-connection.v1",
  "np.agent-run-limits.v1",
  "np.agent-run.v1",
  "np.agent-action-projection.v1",
] as const;
```

`npAnalyzeAgentWireContractV1()` is the exhaustive dispatcher. It reuses the
existing Gateway-settings analyzer and the existing canonical run-limit
analyzer rather than defining parallel validators. The dedicated principal,
budget, connection, run, and action analyzers plus sorted scope/state helpers
and `npAnalyzeAgentCursorPageV1()` reject unknown fields, hostile object
graphs, out-of-order values, unsafe integers, noncanonical time/identity
values, and over-limit bodies without ambient DB or request context.

Public principal rows expose authority actor references but never credential,
grant, client, service-token, token-hash, or refresh-family ids. Public
connection rows expose only a stored/absent credential fact and safe adapter
configuration; secret-version/config-snapshot locators, account/destination
HMACs, vault locators, and credential bytes are absent. Action activity uses a
separate `np.agent-action-projection.v1` schema so it cannot be confused with
the server-rehydration `np.agent-action.v1` canonical body; canonical input,
capability-definition storage, undo references, and raw verification or
compensation evidence are not members. Per-body and aggregate registry SHA
fingerprints bind these boundaries without fingerprinting analyzer function
source.

### 3.2 `agents`

`@nexpress/core/agents` is server-only. It owns:

- the capability registry and invocation facade;
- agent-principal resolution after transport authentication;
- scope, site, policy, quota, approval, and idempotency enforcement;
- audit persistence;
- ChangeSet, run, signal, incident, credential-vault, and provider facades;
- registration and dispatch of agent job handlers;
- exact adapters that application or deployment code may inject.

It imports existing Core domains through relative domain paths. It does not
import `@nexpress/next`, `@nexpress/app`, `@nexpress/admin`, React, or an MCP
transport.

### 3.3 Agent Gateway

The Gateway is a transport boundary, not another authorization implementation.
It consists of:

- a transport-neutral adapter in `@nexpress/mcp`;
- shared Next route implementations in `@nexpress/app`;
- the NexPress-owned OAuth 2.1 Authorization Server, site/scope consent, and
  audience-bound Agent Gateway token issuer;
- thin route re-exports in `apps/web`;
- staff-session Admin APIs and bearer-authenticated machine surfaces.

MCP is local-first: stdio opens no network listener. Optional remote MCP is
mounted only as `/api/mcp` on the existing canonical HTTPS application origin;
NexPress has no MCP port setting, standalone public MCP listener, hosted relay,
or automatic tunnel. `disabled`, `read`, `propose`, and `approved-execute`
form ordered narrowing ceilings at deployment, site, and immutable
credential/grant layers. The highest explicit mode retains the complete
bounded Gateway inventory; none of the modes grants scopes or approval. A
mixed proposal/execution tool is listed from its least exposed effect profile,
then invocation resolves the exact input-selected profile and requires its
higher ceiling before approval consumption or execution.

Its responsibilities end after:

1. validating protocol/request syntax;
2. resolving an authenticated `NpAgentPrincipal`;
3. choosing the current site from that principal;
4. resolving the effective transport exposure and projecting only capabilities
   admitted by that mode, transport, principal scopes, and current site policy;
5. calling either the shared invocation facade for capability/run operations
   or the shared `NpAgentPreviewArtifactResourceService.read()` for the one
   registered preview-artifact resource;
6. translating that exact result/stream to MCP or REST.

The artifact service is also used by Admin and performs current site/scope or
staff-capability, every-target visibility, preview state/expiry, and
artifact-digest/MIME/size checks before reading private storage. Transport code
cannot call storage, collection, jobs, ops, or plugin handlers directly.
The machine REST projection is exactly
`GET /api/agent/v1/capabilities`,
`POST /api/agent/v1/invocations`,
`GET /api/agent/v1/runs/{runId}`, and
`GET /api/agent/v1/previews/{previewId}/artifacts/{artifactId}`. It accepts only an `agent-http`
service credential bound to the canonical
`https://<site-host>/api/agent/v1` resource audience; the host is the
deployment's normalized external site host. Agent HTTP uses the same
intersection under its own `agent-http` transport ceiling and cannot bypass a
capability or effect profile hidden from that effective projection by calling
the generic invocation route. A separately broader Agent HTTP site setting is
explicit, not inherited from MCP. MCP OAuth, MCP-bound service credentials,
provider credentials, staff cookies, and caller-supplied site ids fail before
either shared service.
An external OIDC provider may authenticate the staff user during the consent
flow, but it never issues Agent Gateway access/refresh tokens or agent scopes.
Non-interactive callers use a separately issued hash-only NexPress service
credential. OAuth grants and service tokens freeze their maximum exposure mode
alongside scopes and audience. Both relationships are distinct from
model-provider and downstream integration credentials.

### 3.4 Agent Runtime

The Runtime is a durable orchestration layer in the dedicated worker. It:

- consumes exact event and schedule jobs;
- runs deterministic prefilters before any model call;
- obtains a provider connection through the vault;
- sends bounded, redacted evidence to a provider adapter;
- validates the model result against a task-specific exact schema;
- invokes the same capability registry used by MCP;
- persists run steps and verification instead of relying on conversation
  memory.

“Always on” means that event collectors, schedules, pg-boss, and state
machines are available. It never means one permanently running model process
per site.

### 3.5 ChangeSet executor

The ChangeSet service is the default runtime write boundary for content,
navigation, theme settings, media references, and publishing. It is responsible
for immutable proposal versions, validation, preview, approval binding,
transaction boundaries, verification, and forward rollback. The executor calls
existing domain services; it does not reproduce their validation.

Only explicitly listed direct capabilities may bypass a ChangeSet:

- quarantine or restore one moderation target;
- apply a short-lived actor limit; expiry or the security-authorized internal/
  Admin compensation service removes it;
- revoke one exact actor/session family only after fresh human approval.

The first two families are reversible/expiring and may be policy-allowed
within exact bounds. Session revocation is the closed non-reversible exception
and is never unattended. V1 has no “other direct-safe” extension point; every
path remains idempotent, audited, validated, and verification-bound.

### 3.6 Agent Studio

Agent Studio is split at the existing server/client boundary:

- `@nexpress/app` server components resolve staff authorization and fetch
  client-safe wires;
- `@nexpress/admin/client` renders connections, agents, activity, approvals,
  incidents, policy, and budget UI;
- client components never import server-only Core, provider SDKs, or
  credential material.

## 4. Dependency direction

The intended workspace dependency graph is:

```text
@nexpress/admin/client ─┐
@nexpress/mcp ──────────┼──→ @nexpress/core/agent-contract
@nexpress/core/agents ──┘
          ↑
          │ imported by
@nexpress/next

@nexpress/app ──→ @nexpress/next
       ├────────→ @nexpress/core/agents
       ├────────→ @nexpress/core/agent-contract
       └────────→ @nexpress/mcp

apps/web ──→ @nexpress/app + @nexpress/next
```

Arrows point from consumer to dependency. The following rules prevent cycles:

1. `agent-contract` imports only pure contract utilities.
2. `agents` may import `agent-contract` and existing Core domains, never the
   Core root barrel from inside Core.
3. `@nexpress/mcp` receives an `NpAgentCapabilityInvoker` and auth context as
   constructor arguments. It does not import `@nexpress/app` or initialize
   Core.
4. `@nexpress/app` owns concrete route wiring and supplies the invoker to the
   MCP adapter.
5. provider-specific packages implement a Core adapter. Core never imports an
   OpenAI, Anthropic, Cloudflare, Sentry, Slack, or other vendor SDK.
6. jobs do not statically import collection/plugin implementations. Agent
   handlers use the same registration/context-indirection pattern as existing
   built-in handlers.

### 4.1 Canonical bytes, digests, and MACs

Every v1 security-authorizing or idempotency digest uses one shared
`np.agent-canonical-json.v1` implementation:

1. validate an exact plain-JSON value and reject duplicate raw JSON keys,
   accessors/prototypes, cycles/shared references, non-finite or unsafe
   numbers, lone UTF-16 surrogates, unknown fields, and values outside the
   contract bounds;
2. serialize with
   [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html):
   lexicographic property sorting and ECMAScript/JCS number/string escaping,
   with no whitespace;
3. preserve Unicode code points exactly—no NFC/NFD normalization—and encode
   the canonical string as UTF-8 without BOM;
4. prepend UTF-8 domain separation
   `np.agent-canonical-json.v1\0<contract-purpose>\0`;
5. emit `cj1:sha256:<base64url-no-padding>` or
   `cj1:hmac-sha256:<key-id>:<base64url-no-padding>`.

`contract-purpose` is never a caller string. The initial closed registry is:

```ts
export const npAgentCanonicalPurposes = [
  "np.agent-action.v1",
  "np.agent-approval-decision.v1",
  "np.agent-approval-revocation.v1",
  "np.agent-approval-statement.v1",
  "np.agent-artifact.v1",
  "np.agent-authorization-context.v1",
  "np.agent-budget-snapshot.v1",
  "np.agent-capability-registry.v1",
  "np.agent-changeset-plan.v1",
  "np.agent-changeset-proposal.v1",
  "np.agent-changeset-snapshot.v1",
  "np.agent-connection-config.v1",
  "np.agent-connection-destination.v1",
  "np.agent-connection-operation.v1",
  "np.agent-effect-profile.v1",
  "np.agent-event.v1",
  "np.agent-idempotency-request.v1",
  "np.agent-mcp-task-result.v1",
  "np.agent-notification-delivery.v1",
  "np.agent-policy.v1",
  "np.agent-preview-contract.v1",
  "np.agent-preview-routes.v1",
  "np.agent-provider-request.v1",
  "np.agent-provider-response.v1",
  "np.agent-recipe-registry.v1",
  "np.agent-restriction.v1",
  "np.agent-run-admission.v1",
  "np.agent-run-limits.v1",
  "np.agent-signal-evidence.v1",
  "np.agent-site-deletion-plan.v1",
  "np.agent-staff-site-authorization.v1",
  "np.agent-vault-aad.v1",
] as const;
```

The owning contract chooses exactly one registry member: a field named
`request_hash` uses the operation-specific request purpose
(`idempotency-request` for invocations, `connection-operation` for connection
workers, or `provider-request` for provider calls); ChangeSet plan/proposal/
snapshot, connection config/destination, run admission/limits/budget, and
approval statement/decision/revocation use their same-named purposes. A
purpose addition or reassignment is a contract-version change with golden
vectors and migration, not an implementation detail.

R0 must export one exhaustive `NpAgentCanonicalPurposeBodyMapV1`. The
normative [canonical contract appendix](canonical-contracts.md) expands all 32
rows into complete exact plain-JSON interfaces/aliases, analyzers, literal
included/excluded field fixtures, owner mappings, ordering/null rules, size
bounds, and golden-vector gates. The table below is a navigation summary of
those bodies and their self/output exclusions; the appendix controls when a
summary phrase is broader. Every interface rejects unknown fields.
“Excluded” is a constraint on that definition, not permission to build a
partial ad hoc object.

| Purpose                                | Complete canonical body contract                                     | Self-excluded output fields                             |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `np.agent-action.v1`                   | `NpAgentActionCanonicalV1` in the data/runtime contract              | `proposalHash`, `resultDigest`, integrity MAC fields    |
| `np.agent-approval-decision.v1`        | `NpAgentApprovalDecisionCanonicalV1`                                 | `decisionHash`, `decisionMac`                           |
| `np.agent-approval-revocation.v1`      | `NpAgentApprovalRevocationCanonicalV1`                               | `revocationHash`, `revocationMac`                       |
| `np.agent-approval-statement.v1`       | `NpAgentApprovalStatementCanonicalV1`                                | `statementHash`, `statementMac`                         |
| `np.agent-artifact.v1`                 | `NpAgentPreviewArtifactManifestV1` in §4.2                           | manifest `digest`; private storage/delete fields        |
| `np.agent-authorization-context.v1`    | `NpAgentAuthorizationContextCanonicalV1`                             | `authorizationContextFingerprint`                       |
| `np.agent-budget-snapshot.v1`          | `NpAgentBudgetSnapshotCanonicalV1`                                   | `snapshotDigest`                                        |
| `np.agent-capability-registry.v1`      | `NpAgentCapabilityRegistryCanonicalV1`                               | `registryFingerprint`                                   |
| `np.agent-changeset-plan.v1`           | `NpAgentChangeSetPlanCanonicalV1`                                    | `planHash`, execution/result fields                     |
| `np.agent-changeset-proposal.v1`       | `NpAgentChangeSetProposalCanonicalV1`                                | `draftHash`, validation/preview/execution fields        |
| `np.agent-changeset-snapshot.v1`       | `NpAgentChangeSetSnapshotCanonicalV1`                                | `snapshotHash`                                          |
| `np.agent-connection-config.v1`        | `NpAgentConnectionConfigCanonicalV1`                                 | `configHash`, destination fingerprint/HMAC              |
| `np.agent-connection-destination.v1`   | `NpAgentConnectionDestinationCanonicalV1`                            | `destinationFingerprint`, `destinationFingerprintKeyId` |
| `np.agent-connection-operation.v1`     | `NpAgentConnectionOperationRequestCanonicalV1`                       | `requestHash`, result/receipt fields                    |
| `np.agent-effect-profile.v1`           | `NpAgentEffectProfileCanonicalV1`                                    | `effectFingerprint`                                     |
| `np.agent-event.v1`                    | `NpAgentEventCanonicalV1`                                            | `eventDigest`, persistence timestamps                   |
| `np.agent-idempotency-request.v1`      | `NpAgentInvocationRequestCanonicalV1`                                | `requestHash`, invocation/result metadata               |
| `np.agent-mcp-task-result.v1`          | `NpAgentMcpStoredTerminalResultV1`                                   | `terminalResultDigest`                                  |
| `np.agent-notification-delivery.v1`    | `NpAgentNotificationDeliveryCanonicalV1`                             | `deliveryResultDigest`, provider receipt                |
| `np.agent-policy.v1`                   | `NpAgentPolicyCanonicalV1`                                           | `policyHash`, persistence timestamps                    |
| `np.agent-preview-contract.v1`         | `NpAgentPreviewContractCanonicalV1` in the ChangeSet contract        | `previewContractFingerprint`                            |
| `np.agent-preview-routes.v1`           | `NpAgentPreviewRoutesCanonicalV1` in the ChangeSet contract          | `allowedRoutesDigest`                                   |
| `np.agent-provider-request.v1`         | `NpAgentProviderRequestCanonicalV1`                                  | `requestHash`, admission/result metadata                |
| `np.agent-provider-response.v1`        | `NpAgentProviderResponseCanonicalV1`                                 | `responseHash`, reconciliation fields                   |
| `np.agent-recipe-registry.v1`          | `NpAgentRecipeRegistryCanonicalV1`                                   | `registryFingerprint`                                   |
| `np.agent-restriction.v1`              | `NpAgentRestrictionCanonicalV1`                                      | `restrictionHash`, adapter receipt/removal fields       |
| `np.agent-run-admission.v1`            | `NpAgentRunAdmissionCanonicalV1`                                     | `admissionHash`, mutable run state/result               |
| `np.agent-run-limits.v1`               | `NpAgentRunLimitsCanonicalV1`                                        | `limitsHash`                                            |
| `np.agent-signal-evidence.v1`          | `NpAgentSignalEvidenceCanonicalV1`                                   | `evidenceDigest`, aggregation/reconciliation fields     |
| `np.agent-site-deletion-plan.v1`       | `NpAgentSiteDeletionPlanCanonicalV1`                                 | `planHash`, mutable saga cursor/outcomes                |
| `np.agent-staff-site-authorization.v1` | `NpAgentStaffSiteAuthorizationCanonicalV1` in the ChangeSet contract | `siteAuthorizationDigest`                               |
| `np.agent-vault-aad.v1`                | `NpAgentVaultAadCanonicalV1` in the credential contract              | AAD digest/ciphertext/tag/adapter receipt fields        |

The owning implementation must export the named body validator from
`@nexpress/core/agent-contract`; a purpose cannot be registered without that
validator, explicit field-membership fixture, body-size bounds, golden vector,
and the single allowed owning field. No R1+ schema, digest column, approval,
idempotency, or migration work may start with a body-map row that is missing
or diverges from the normative appendix. A CI exhaustiveness test compares all
five inventories—purpose strings, body-map
keys, validator-map keys, field-membership fixture keys, and golden-vector
keys—byte-for-byte.

Control-plane versions/counts/costs/times that enter these bytes are safe
integers. A schema-declared domain decimal must be a finite I-JSON/IEEE-754
number and uses the exact JCS serialization; non-finite or out-of-range values
fail before hashing. Arrays retain order unless their contract first requires
sorted-unique canonicalization. A hash/MAC field is excluded from its own
input; each named contract lists the complete included object and purpose
string. Plan, config, request, event, effect, approval statement, decision,
revocation, artifact, policy, registry, and authorization-context digests all
use this helper. No call site may hash `JSON.stringify()` output directly.

The version prefix travels in every stored digest/MAC, so an algorithm change
requires a new explicit canonicalization version plus dual-read migration; it
cannot silently reinterpret old approvals or idempotency rows. Core ships
golden objects/canonical bytes/digests/MACs covering key order, nested arrays,
Unicode, escapes, integer boundaries, duplicate keys, and every approval
envelope. TypeScript, SQL fixtures, MCP/OpenAPI tests, and any external
verifier consume the same vectors.

### 4.2 Preview artifact content and manifest digests

Stored artifact bytes do not use the JSON helper. The one exact raw-content
builder is:

```text
ac1:sha256:<43-character-unpadded-base64url>
  = encode(SHA-256(
      utf8("np.agent-artifact-content.v1\0")
      || u64be(rawByteLength)
      || rawBytes
    ))
```

`encode` adds the literal `ac1:sha256:` prefix. The byte length is unsigned
big-endian and canonical image normalization happens before this function.
The database/wire name is `contentDigest`; it is verified after every private
storage read and is suitable for a strong HTTP ETag. It is not a `cj1:*` value
and content digests are not unique identifiers—two artifacts may legitimately
have identical bytes.

`NpAgentPreviewSummary.digest` is instead the `cj1:sha256` digest, using
`np.agent-artifact.v1`, of this complete manifest:

```ts
interface NpAgentPreviewArtifactManifestV1 {
  schemaVersion: "np.agent-preview-artifact-manifest.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  artifacts: Array<{
    ordinal: number;
    artifactId: string;
    kind: "screenshot" | "report";
    route: string | null;
    locale: string | null;
    viewport: {
      name: "desktop" | "mobile";
      width: number;
      height: number;
      deviceScaleFactor: 1 | 2;
    } | null;
    reportPart: number | null;
    reportTotalParts: number | null;
    contentDigest: string;
    mime: "image/png" | "image/webp" | "application/json";
    bytes: number;
    createdAt: string;
    expiresAt: string;
  }>;
}
```

Artifacts are sorted by positive unique `ordinal`. Screenshot rows require
route/viewport and an image MIME with both report-part fields null. Report
rows require all three route/locale/viewport fields null,
`application/json`, and positive contiguous `reportPart` values with one
byte-equal `reportTotalParts` no greater than four. The manifest excludes
private storage keys and its own digest, but includes all metadata exposed
through preview-detail/resource projections except `resourceUri`, which is a
pure canonical derivation of the manifest's site/preview/artifact ids and
contains no independent state. Serialization recomputes and verifies that URI
from those ids; it is never accepted as hash input. The host recomputes both
raw-content and manifest digests on persistence read, artifact read,
Admin/MCP serialization, approval evidence checks, and Doctor. Golden vectors
separately cover JSON manifests and empty/binary/PNG/WebP/JSON raw content; no
implementation may call a generic SHA-256 helper without the raw-content
domain and length frame.

Artifact upload admission has one exact private request body:

```ts
interface NpAgentPreviewArtifactUploadRequestV1 {
  schemaVersion: "np.agent-preview-artifact-upload-request.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  artifactId: string;
  ordinal: number;
  kind: "screenshot" | "report";
  route: string | null;
  locale: string | null;
  viewport: {
    name: "desktop" | "mobile";
    width: number;
    height: number;
    deviceScaleFactor: 1 | 2;
  } | null;
  reportPart: number | null;
  reportTotalParts: number | null;
  contentDigest: string;
  mime: "image/png" | "image/webp" | "application/json";
  bytes: number;
  storageAdapterId: string;
  storageAdapterContractVersion: number;
  storageAdapterFingerprint: string;
  storageKey: string;
}
```

The row-first upload journal stores
`aur1:sha256:<43-character-unpadded-base64url>`, computed as SHA-256 over
`utf8("np.agent-artifact-upload-request.v1\0") ||
u64be(canonicalRequestByteLength) || canonicalRequestBytes`, where
`canonicalRequestBytes` is the RFC 8785 UTF-8 encoding of that complete
object. The private storage key never reaches an Admin/MCP/API projection.
The digest is an immutable operation precondition, not authority; same
artifact id/key/digest is one upload identity and any changed field
conflicts.

The stable adapter idempotency key is
`npau1_<43-character-unpadded-base64url>`, where the suffix is
`SHA-256(utf8("np.agent-artifact-upload-idempotency.v1\0") ||
utf8(uploadRequestDigest))`. It is generated only after the exact request
digest, persisted before dispatch, and reused byte-for-byte for every
inspection/reconciliation. It is neither authority nor a storage key.

Before the first object-store dispatch, the host freezes the complete upload
set:

```ts
interface NpAgentPreviewArtifactUploadSetV1 {
  schemaVersion: "np.agent-preview-artifact-upload-set.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  uploads: Array<{
    ordinal: number;
    artifactId: string;
    uploadRequestDigest: string;
  }>;
}
```

`uploads` contains the whole `0..24`-entry server-derived set, sorted by
positive unique ordinal. Its `aus1:sha256:<43-character-unpadded-base64url>`
digest is SHA-256 over
`utf8("np.agent-artifact-upload-set.v1\0") ||
u64be(canonicalSetByteLength) || canonicalSetBytes`, where
`canonicalSetBytes` is the RFC 8785 UTF-8 encoding of the complete object.
The preview row stores this digest and exact count in the same transaction
that inserts every artifact/upload row. A digest/count mismatch or a
missing/extra row can therefore never finalize.

An elapsed client deadline is not proof that a remote write has stopped. The
frozen artifact-storage adapter facet must expose authoritative operation
resolution for the exact `(storageKey,idempotencyKey)` identity:

```ts
type NpAgentPreviewArtifactUploadOperationResolutionV1 =
  | {
      status: "not_started" | "committed";
      resolvedAt: string;
      safeCode: null;
    }
  | {
      status: "failed_no_effect";
      resolvedAt: string;
      safeCode: string;
    }
  | {
      status: "pending" | "unknown";
      resolvedAt: null;
      safeCode: string | null;
    };
```

`not_started` and `failed_no_effect` are terminal promises that the operation
has no current object and can never materialize one later. `committed` is a
terminal promise that the operation will perform no later mutation and the
host may now verify/delete the resulting key. `pending|unknown` is
non-terminal forever regardless of elapsed wall time. The adapter may satisfy
this contract through operation inspection or a provider-enforced generation
fence; an adapter that can only issue PUT plus HEAD cannot enable preview
artifact generation.

Each terminal resolution persists this exact receipt body:

```ts
interface NpAgentPreviewArtifactUploadOperationReceiptV1 {
  schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1";
  siteId: string;
  previewId: string;
  artifactId: string;
  uploadRequestDigest: string;
  idempotencyKey: string;
  storageAdapterId: string;
  storageAdapterContractVersion: number;
  storageAdapterFingerprint: string;
  status: "not_started" | "committed" | "failed_no_effect";
  safeCode: string | null;
  resolvedAt: string;
}
```

Its non-authorizing `auo1:sha256:<43-character-unpadded-base64url>` digest is
SHA-256 over
`utf8("np.agent-artifact-upload-operation-receipt.v1\0") ||
u64be(canonicalReceiptByteLength) || canonicalReceiptBytes`, using RFC 8785
UTF-8 bytes. The `safeCode` nullability is byte-exact with the resolution
union. A bounded non-secret adapter operation reference may persist only in
the private upload row; raw provider handles/locators never enter this body,
logs, Doctor output, or Admin/MCP/API projections.

Artifact object deletion receipts use another non-authorizing digest:

```text
adr1:sha256:<43-character-unpadded-base64url>
  = encode(SHA-256(
      utf8("np.agent-artifact-delete-receipt.v1\0")
      || u64be(canonicalReceiptByteLength)
      || canonicalReceiptBytes
    ))
```

`canonicalReceiptBytes` is RFC 8785 UTF-8 for the exact
`{schemaVersion:"np.agent-artifact-delete-receipt.v1",siteId,previewId,
artifactId,contentDigest,storageAdapterId,storageAdapterContractVersion,
storageAdapterFingerprint,deleteAttempt,status,deletedAt}` object, where
`status` is `deleted|already_absent`. The row persists every body field, so
cleanup, Doctor, and deletion can recompute the digest. This receipt proves
which bounded adapter result NexPress recorded; it is not authority and does
not expose the private storage key.

## 5. Bootstrap and process lifecycle

### 5.1 Keep the four existing intents

The first implementation must not add a fifth bootstrap intent. Existing
intents are sufficient:

| Call site                              | Required intent | Reason                                                                 |
| -------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| Capability/resource discovery          | `plugins`       | schema/resources include the resolved active plugin catalog            |
| Deterministic read capability          | `plugins`       | DB, site scope, collections, and active plugins are ready              |
| Gateway mutation or ChangeSet creation | `write`         | normal writes and their producer-side follow-up jobs must be available |
| Dedicated Agent Runtime                | `worker`        | plugins and email are ready without a competing web producer           |

The Gateway chooses the intent from a static capability descriptor before
invocation. A caller cannot ask for a weaker intent. A definition whose
declared intent is weaker than its handler dependencies fails registry
validation.

### 5.2 Runtime startup

Provider initialization is not added to `ensureFor("write")`. A web mutation
must not initialize a model SDK merely because `write` currently builds on the
`worker` intent.

The dedicated worker sequence is:

```text
createBootstrap(...)
  → ensureFor("worker")
  → register application capability definitions
  → install Agent Runtime adapters
  → register exact agent job handlers
  → startWorker(...)
  → heartbeat + schedule reconciliation
```

The stock `@nexpress/app` worker runner should expose one host hook for the
middle three steps. A generated application supplies provider adapters and its
credential-encryption adapter through app-local configuration. Repeated
registration with the same source and fingerprint is idempotent; a conflicting
registration fails before the worker starts.

### 5.3 Gateway startup

A remote MCP or Agent Studio request runs:

```text
authenticate transport
  → determine descriptor
  → ensureFor(descriptor.bootstrapIntent)
  → register app contributions once
  → withCurrentSite(principal.siteId)
  → invoke capability
```

No agent route calls `getDb()` or any singleton before `ensureFor()` returns.
Construction remains lazy and race-safe through the existing bootstrap.

### 5.4 Shutdown

Agent-specific shutdown occurs before the existing DB and observability
shutdown:

1. stop accepting new Runtime runs;
2. stop trigger polling and drain in-flight provider calls to a deadline;
3. close provider and integration adapters;
4. let the worker stop heartbeat and pg-boss;
5. call the normal terminal bootstrap shutdown.

Web processes do not own provider adapters and therefore have no provider
shutdown work. Connection create/callback routes may call the write-only vault
seal API, but test/enable/rotate/provider-OAuth exchange is persisted as an
exact `np_agent_connection_operations` row and executed by
`agent:connectionOperate` in the worker. The browser receives/polls only the
redacted operation resource.

## 6. Durable jobs

Agent work uses the existing pg-boss queue and exact job registration API.
There is no second broker or in-memory scheduler.

Every site-owned payload must:

- be an exact bounded plain JSON object;
- contain top-level canonical `siteId`;
- register `resolveSiteId: data => data.siteId`;
- opt into `quota: "site"` when the job represents optional model work;
- be validated both before enqueue and before dispatch;
- resolve its handler to `void`.

The exact built-in inventory is shared with
[`agent-runtime-and-guardian.md`](agent-runtime-and-guardian.md):

| Job name                         | Exact payload                                                                   | Scope                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `agent:eventDispatch`            | `{ siteId, eventId }`                                                           | site detector/trigger/signal dispatch                     |
| `agent:eventReconcile`           | `{}`                                                                            | global recovery and site fan-out                          |
| `agent:scheduleTick`             | `{}`                                                                            | global Agent schedule claim and site fan-out              |
| `agent:connectionOperate`        | `{ siteId, operationId }`                                                       | one worker-only probe/exchange/refresh/rotation operation |
| `agent:vaultOperate`             | `{ siteId, vaultOperationId }`                                                  | inspect/recover one persisted vault operation             |
| `agent:runExecute`               | `{ siteId, runId }`                                                             | one Gateway/Runtime run state machine                     |
| `agent:actionVerify`             | `{ siteId, actionId }`                                                          | direct mutation verification/undo/expiry                  |
| `agent:notificationSend`         | `{ siteId, notificationId, expectedAttempt }`                                   | one deduplicated Admin/external delivery attempt          |
| `agent:changesetValidate`        | `{ siteId, changeSetId, draftVersion, draftHash, generation }`                  | one immutable draft-generation validation                 |
| `agent:changesetPreview`         | `{ siteId, changeSetId, planHash, generation }`                                 | one sealed preview/check generation                       |
| `agent:changesetApply`           | `{ siteId, changeSetId, planHash, approvalId, scheduledFor, idempotencyKey }`   | approved immediate/scheduled apply                        |
| `agent:changesetVerify`          | `{ siteId, changeSetId, executionId }`                                          | committed apply/rollback convergence                      |
| `agent:changesetRollbackPrepare` | `{ siteId, changeSetId, rollbackPlanId }`                                       | compensation generation/validation                        |
| `agent:changesetRollbackExecute` | `{ siteId, changeSetId, rollbackPlanId, planHash, approvalId, idempotencyKey }` | approved compensation execution                           |
| `agent:retentionTick`            | `{}`                                                                            | global bounded site selection/fan-out                     |
| `agent:retentionPrune`           | `{ siteId }`                                                                    | site-scoped bounded retention sweep                       |
| `agent:siteDelete`               | `{ siteId, sagaId, planHash }`                                                  | external cleanup/final deletion saga                      |
| `guardian:incidentAnalyze`       | `{ siteId, incidentId, expectedVersionNumber }`                                 | one optional incident provider analysis                   |

Only `agent:eventReconcile`, `agent:scheduleTick`, and
`agent:retentionTick` are global. They never execute tenant work in
ambient/default scope; they enqueue exact site jobs. Every other row carries
`siteId`, validates before enqueue/dispatch, and registers `resolveSiteId`. A
job id is an implementation detail: MCP tasks and public run ids never expose
a raw pg-boss payload or authorize access by knowing that id.

`agent:eventReconcile` is the fixed-batch lost-enqueue/state reconciler for
committed events, admitted runs, queued connection operations, non-terminal
vault operations, working MCP tasks whose immutable invocation/run outcome is
already terminal, non-terminal preview generations/artifact-upload journals,
queued/due notification outboxes, and due restriction/containment expiries.
It compare-and-swaps the source action into its frozen expiry compensator,
then only selects canonical site ids and enqueues exact site-stamped jobs;
preview recovery re-enqueues the same immutable
`agent:changesetPreview` generation, connection/provider work runs in
`agent:connectionOperate`, vault inspection/recovery in `agent:vaultOperate`,
notification delivery in `agent:notificationSend`, and expiry/undo
convergence in `agent:actionVerify`. Task reconciliation does not enqueue
another execution: it validates the stored invocation/result, constructs the
exact id-less task terminal payload, and CAS-terminalizes the existing task.
A preview recovery may inspect an already-admitted upload operation but never
dispatches a second PUT; `pending|unknown` remains non-terminal and
operator-visible until the frozen adapter resolves or fences it.
A working task whose invocation/run became terminal more than 60 seconds ago
is a Doctor error until this convergence succeeds.

### 6.1 Admission

Before enqueue, the runtime atomically checks:

- agent enabled state;
- site, agent, provider, and model allowance;
- immutable same-site causal root/parent/action/event lineage and the shared
  maximum depth of four;
- concurrency and rolling job quota;
- token/cost budget;
- event deduplication or caller idempotency;
- required infrastructure availability.

When jobs are disabled, existing `enqueueJob()` returns an empty id after
validation. Agent code must not interpret that as accepted work. Any operation
that requires durable execution checks queue support first and returns
`SERVICE_UNAVAILABLE`; deterministic reads may remain available.

### 6.2 Retry semantics

Handlers are retry-safe:

- provider requests use a persisted run/step key;
- capability mutations use the original caller-stable idempotency key;
- completed steps are not repeated;
- model output is validated again before action;
- a terminal failed run is not silently converted to success by a later queue
  retry.

Throwing retains the existing pg-boss retry behavior. Permanent policy,
approval, schema, or budget failures are recorded as terminal run outcomes
rather than retried as infrastructure failures.

## 7. Site and authorization boundary

Agent execution is stricter than normal hostname fallback:

1. Every external credential and configured Runtime agent is bound to exactly
   one canonical site in v1.
2. Gateway code derives the site from the verified principal, not from
   `Host`, `x-np-admin-site`, a cookie, model output, or tool input.
3. Missing or malformed agent site context is an error; it never falls back to
   `default`.
4. Invocation wraps authorization, policy, handler execution, audit, and
   result validation in `withCurrentSite(siteId, ...)`.
5. `siteId: "*"` and the collection cross-site sentinel are forbidden on all
   agent contracts.
6. Durable payloads repeat the same site id and resolve it at dispatch.

A delegated-user grant still re-resolves the subject's current membership with
`canOnSite()` on every call. `NpAgentScope` is a second, narrower limit; it
never promotes a user or replaces `NpCapability`.

Global identities and process-global plugin code require special care:

- plugin installation, code reload, and site activation are all outside v1
  agent authority;
- global database migration, production restore, arbitrary queue pause/drain,
  package installation, and storage cutover remain outside v1 remote agent
  capabilities;
- an action with unavoidable cross-site effect, such as revoking an exact
  global session family, is marked sensitive, shows that effect, and requires
  human approval.

`ops.execute` has a closed v1 action inventory:

```ts
export const npAgentExecutableOpsActionIds = [
  "cache.revalidate",
  "agent.run.retry",
  "agent.run.cancel",
] as const;
```

Every input is exact and site-local. `cache.revalidate` accepts only a target
within the authenticated current site. `agent.run.retry` names one failed run
from that site and creates a new linked run; it repeats admission, scope,
policy, budget, approval, and idempotency checks instead of replaying the old
queue job. `agent.run.cancel` is cooperative and can succeed only before the
target run crosses its database commit boundary. After that boundary it
returns `CONFLICT` and may offer a rollback plan.

Migration, restore, storage cutover, plugin changes, and queue-global
operations may appear only as evidence-backed `ops.plan` results with a local
CLI handoff. The Agent Gateway rejects them at execution even if approval text
mentions the operation.

## 8. Adapter boundaries

All vendor or deployment dependencies enter through these exact server-only
interfaces. The first implementation keeps both names and responsibilities
separated:

```ts
export interface NpAgentConnectionConfigSnapshotV1 {
  schemaVersion: "np.agent-connection-config-snapshot.v1";
  connectionId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  configVersion: number;
  configHash: string;
  config: NpAgentJsonObject;
  pricingCatalog: NpAgentModelPricingV1[];
  pricingCatalogFingerprint: string;
  accountSubjectKeyId: string;
  accountSubjectDigest: string;
  destinationFingerprintKeyId: string | null;
  destinationFingerprint: string | null;
}

export interface NpAgentProviderAdapter {
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

export interface NpAgentNotificationAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly credentialEnvelopeVersions: readonly [1];
  readonly idempotency: "enforced" | "none";
  send(
    notification: {
      schemaVersion: "np.agent-notification-delivery.v1";
      notificationId: string;
      channel: "email" | "slack" | "webhook" | "siem";
      deduplicationKey: string;
      payloadRedacted: NpAgentJsonObject;
    },
    context: {
      credentialLease: NpProviderCredentialLease;
      connection: NpAgentConnectionConfigSnapshotV1;
      signal: AbortSignal;
    },
  ): Promise<NpAgentNotificationDeliveryResult>;
  shutdown?(): Promise<void>;
}

interface NpAgentRestrictionDescriptorV1 {
  schemaVersion: "np.agent-restriction.v1";
  restrictionId: string;
  siteId: string;
  subject:
    | {
        kind: "authenticated_principal";
        principalKind: "staff" | "member" | "agent-gateway";
        principalId: string;
      }
    | {
        kind: "opaque_actor_bucket";
        purpose: NpAgentActorBucketPurposeV1;
        projectionVersion: number;
        projectionFingerprint: string;
        keyId: string;
        bucket: string;
      };
  actionScopes: NpAgentActorRestrictionScope[];
  startsAt: string;
  expiresAt: string;
  reasonCode: string;
  targetVersionDigest: string;
}

interface NpAgentRestrictionMutationContext {
  idempotencyKey: string;
  expectedRowVersion: number;
  signal: AbortSignal;
}

interface NpAgentRestrictionMutationResultV1 {
  schemaVersion: "np.agent-restriction-mutation-result.v1";
  status: "installed" | "already_installed" | "removed" | "already_absent";
  restrictionId: string;
  enforcementRef: string | null;
  effectiveExpiresAt: string | null;
  resultDigest: string;
}

interface NpAgentRestrictionVerifyResultV1 {
  schemaVersion: "np.agent-restriction-verify-result.v1";
  state: "installed" | "absent" | "expired" | "unknown";
  restrictionId: string;
  effectiveExpiresAt: string | null;
  resultDigest: string;
}

interface NpAgentRestrictionCheckV1 {
  schemaVersion: "np.agent-restriction-check.v1";
  siteId: string;
  subjects: NpAgentRestrictionDescriptorV1["subject"][];
  actionScope: NpAgentActorRestrictionScope;
  observedAt: string;
}

interface NpAgentRestrictionDecisionV1 {
  schemaVersion: "np.agent-restriction-decision.v1";
  decision: "allow" | "deny";
  restrictionId: string | null;
  matchedSubjectKey: string | null;
  expiresAt: string | null;
  resultDigest: string;
}

interface NpAgentRestrictionHealthV1 {
  schemaVersion: "np.agent-restriction-health.v1";
  status: "ready" | "degraded" | "unavailable";
  sharedAcrossReplicas: boolean;
  checkedAt: string;
  safeCodes: string[];
}

export interface NpAgentRestrictionAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly sharedAcrossReplicas: boolean;
  install(
    restriction: NpAgentRestrictionDescriptorV1,
    context: NpAgentRestrictionMutationContext,
  ): Promise<NpAgentRestrictionMutationResultV1>;
  remove(
    restriction: NpAgentRestrictionDescriptorV1,
    context: NpAgentRestrictionMutationContext,
  ): Promise<NpAgentRestrictionMutationResultV1>;
  verify(
    restriction: NpAgentRestrictionDescriptorV1,
    context: { signal: AbortSignal },
  ): Promise<NpAgentRestrictionVerifyResultV1>;
  check(
    request: NpAgentRestrictionCheckV1,
    context: { signal: AbortSignal },
  ): Promise<NpAgentRestrictionDecisionV1>;
  healthCheck(): Promise<NpAgentRestrictionHealthV1>;
  shutdown?(): void | Promise<void>;
}
```

`NpAgentActorBucketPurposeV1` is the closed union
`"network-address" | "login-identifier"` in v1. An authenticated subject is
canonically keyed as
`principal:v1:<principalKind>:<principalId>`. An opaque subject is keyed as
`bucket:v1:<purpose>:<projectionVersion>:<keyId>:<base64url-hmac>`. The final
component is unpadded base64url of the 32-byte HMAC-SHA-256 output. Its input
is `u32be(length) || bytes` framing, in order, for the UTF-8 domain label
`np-agent-actor-bucket/v1`, canonical site id, ASCII purpose, decimal
projection version, ASCII projection fingerprint, and the projection's raw
normalized subject bytes. Normalization is purpose-specific and owned by an
independent, server-registered actor-bucket projection whose positive version
and fingerprint are frozen into every event, signal, incident, restriction,
and adapter request that carries the bucket. It never accepts a model-provided
bucket. The projection implementation and keyring retain every referenced
version/fingerprint/key id until no retained subject or active restriction
needs it. Principal kind, bucket purpose, projection version/fingerprint, and
key id are therefore persisted—not inferred from UUID shape or current
configuration. An incident subject with another purpose or a missing
projection implementation is not restrictable and fails
`security.limitActor` closed.

`NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX` is 8. An authenticated check carries
exactly one authenticated subject. An opaque check carries a sorted-unique
non-empty list for one purpose, containing the current actor-bucket projection
plus every distinct projection-version/fingerprint/key id still referenced by
an active same-site restriction. The proxy derives all candidates from the
same raw request fact inside the trusted boundary; raw bytes never enter the
adapter or persistence. `deny` must name one input's canonical
`matchedSubjectKey`; `allow` requires null. Key/projection rotation that would
require a ninth active candidate is blocked until TTL expiry/removal, and
Doctor reports the pressure. Thus a one-hour restriction survives rotation
without persisting or recovering the raw actor value.

One installed connection-adapter registration owns a single
`id`/`contractVersion`/`fingerprint` triple covering its config schema,
authentication lifecycle, probe, provider invocation, and/or notification
delivery behavior. Every implemented facet must expose the same triple;
partial registration or mismatched triples fail bootstrap/Doctor. A run or
delivery uses that exact triple from its immutable connection snapshot and
fails closed if the installed registration has changed.

Restriction adapters use the same versioned-registry rule independently of
connections. Admission freezes their id/version/fingerprint on the action,
containment, and restriction row. The registry retains that exact
implementation for verify/remove until no active row references it; a missing
or mismatched version blocks new containment and reports cleanup-blocking
Doctor evidence instead of invoking a newer implementation under old
semantics.

The provider interface above is canonicalized in
[`agent-runtime-and-guardian.md`](agent-runtime-and-guardian.md); cancellation
is expressed through the invocation `AbortSignal`, not a provider-specific
public token. Notification results/idempotency/ambiguity use the exact
contract and retry bounds in [data-model.md](data-model.md); `confirmed` alone
may persist `sent`.

Credential encryption uses the single canonical `NpAgentVaultAdapter` from
[`security-and-credentials.md`](security-and-credentials.md), with
`seal`, `open`, `rewrap`, `destroy`, `healthCheck`, and `shutdown`. `open`
returns a bounded plaintext lease with mandatory disposal; no second
`CredentialCipher` interface or unowned plaintext byte result is introduced.

The restriction types above are the one worker/proxy contract and import the
closed scope inventory from `agent-contract`. Objects are exact and bounded;
all ids/digests use the shared canonical grammars, scope arrays are sorted
unique and non-empty, times are canonical UTC, and expiry is within the frozen
60–3,600 second limit. Install accepts only
`installed|already_installed`, remove only `removed|already_absent`; mismatched
ids, expiry, result digests, or an `unknown` verification never claim
containment. Mutation idempotency is stable per restriction/operation/version.
Only an adapter reporting `ready` and `sharedAcrossReplicas:true` may enable
automatic limiting in a multi-node deployment. Proxy `check` trusts only an
exact `deny`; timeout/malformed/unavailable falls back to existing auth/rate
limits, emits a degraded security signal, and prevents new/verified
restrictions from being labelled active.

Interface inputs and outputs are exact, bounded contracts. Optional adapter
shutdown must resolve to `void`. Adapter failures are contained, recorded, and
classified; malformed adapter results fail closed.

The connection snapshot is produced only by the server from the referenced
immutable `np_agent_connection_config_versions` row after its adapter-owned
schema/hash is revalidated. It contains no secret and its snapshot id is
frozen on the run/provider-call or notification row; adapters perform no
hidden DB lookup and are not instantiated per connection. Provider snapshots
require both destination fields null. External notification snapshots require
the exact non-null host HMAC key id/fingerprint derived from the
recipient/channel/endpoint descriptor plus provider-account-subject digest;
Admin-local notification has no adapter call. Adapter id/version/fingerprint
and config version/hash must match the persisted admission snapshot before a
credential lease opens.

Provider credentials, inbound MCP tokens, and downstream integration tokens
are three different relationships:

- the provider adapter receives only a vault-released provider secret;
- a Cloudflare/Sentry/Slack adapter receives only its own connection secret;
- no adapter receives the raw MCP `Authorization` header or service
  token.

## 9. Proposed package and file placement

This is an implementation ownership map, not a requirement to create every
file in one pull request.

```text
packages/core/src/
├── agent-contract/
│   ├── types.ts                 # pure exact wire types and inventories
│   ├── contract.ts              # analyze/require/normalize helpers
│   ├── schemas.ts               # JSON Schema/OpenAPI projections
│   ├── scopes.ts                # exact NpAgentScope inventory
│   └── index.ts
├── agents/
│   ├── registry.ts              # capability definition registry
│   ├── invoke.ts                # shared authorization/policy/audit facade
│   ├── policy.ts                # deterministic policy evaluation
│   ├── idempotency.ts
│   ├── principals.ts
│   ├── changesets/
│   ├── runs/
│   ├── incidents/
│   ├── credentials/
│   ├── oauth/                   # built-in AS grants, codes, tokens, keyring
│   ├── providers/
│   ├── jobs/
│   ├── diagnostics.ts
│   └── index.ts
├── db/schema/agents.ts          # np_agent_* system tables
└── bootstrap/                   # host-only registry/runtime wiring

packages/mcp/src/
├── server.ts                    # protocol-independent MCP projection
├── tools.ts
├── resources.ts
├── prompts.ts
├── tasks.ts
├── stdio.ts
├── streamable-http.ts
└── index.ts

packages/next/src/
├── bootstrap.ts                 # make resolved plugin discovery available
└── agent-auth.ts                # Next request adapter, no policy decisions

packages/app/src/
├── api/mcp/route.ts
├── api/agent/v1/
│   ├── capabilities/route.ts
│   ├── invocations/route.ts
│   └── runs/[runId]/route.ts
├── api/agents/provider-oauth/callback/[adapterId]/route.ts
├── api/agent-oauth/{authorize,token,revoke,jwks}/route.ts
├── well-known/
│   ├── oauth-protected-resource/{root,mcp}.ts
│   └── oauth-authorization-server/route.ts
├── api/admin/agents/**/route.ts
├── admin/protected/agents/**
├── lib/agents/
│   ├── register-capabilities.ts
│   ├── gateway-auth.ts
│   └── openapi.ts
└── scripts/
    ├── worker.ts                # calls Agent Runtime host hook
    └── agent-mcp-stdio.ts

packages/admin/src/agents/
packages/cli-nexpress/src/agent-runtime-command.ts # local status/pause/resume recovery
apps/web/src/app/api/mcp/route.ts # thin re-export
apps/web/src/app/api/agent/v1/**/route.ts # thin machine-Agent HTTP re-exports
apps/web/src/app/api/agents/provider-oauth/callback/[adapterId]/route.ts # thin re-export
apps/web/src/app/api/agent-oauth/**/route.ts # thin re-exports
apps/web/src/app/.well-known/**/route.ts # thin metadata re-exports
apps/web/src/app/(admin)/admin/agents/** # thin re-exports
```

Required packaging changes:

- add `agent-contract` and `agents` entries to Core `tsup.config.ts` and
  `package.json` exports;
- mark `agent-contract` client-safe in the existing bundle safety tests;
- keep `agents` server-external with Core;
- add `@nexpress/mcp` as a separate optional package so sites that do not
  expose MCP do not ship its protocol dependency into browser code;
- add matching scaffold wrappers and scripts instead of copying the shared app
  implementation into generated projects.

## 10. Main sequences

### 10.1 External MCP read

```text
Client
  → POST /api/mcp with audience-bound bearer token
  → Agent Gateway validates HTTP, OAuth, protocol, and request
  → resolve principal + exact site
  → intersect deployment/site/grant exposure + scopes + policy
  → ensureFor("plugins")
  → registry resolves capability descriptor
  → scope + current membership + site policy + quota checks
  → handler reads through existing domain service
  → output parser validates exact result
  → append audit event
  → MCP structuredContent + matching text fallback
```

An authorization failure stops before a capability handler. A malformed
handler result becomes an opaque internal error and reaches observability.

### 10.2 ChangeSet write

```text
Client / Runtime agent
  → changeset.create(idempotencyKey, operations)
  → authorize every operation, normalize, hash, persist immutable version
  → enqueue validation / preview with exact siteId
  → validator + renderer produce diff, checks, preview artifacts
  → request fresh human approval for every v1 schedule/apply
  → Admin approval binds proposal hash + preview hash + expiry
  → changeset.apply(idempotencyKey, approved version)
  → executor calls collection/media/navigation/theme services
  → verify persisted state and public projection
  → ChangeSet state verified or verification_failed
  → when eligible, expose a separate rollback plan whose execution drives the
    parent's exact rolling_back / rolled_back / rollback_failed states
```

Changing any operation after approval creates a new version and invalidates the
old approval. Rollback is another audited forward operation, not a database
rewind.

### 10.3 Event-driven Runtime agent

```text
Framework event
  → normalize and redact bounded event
  → deterministic rule/deduplication
  → enqueue site-scoped trigger job
  → worker restores site scope and checks agent/budget/policy
  → optional provider reasoning over untrusted evidence
  → validate provider result
  → invoke shared capability registry
  → direct reversible action, human-approved session revocation, ChangeSet,
    or approval request
  → verify → incident timeline → notification
```

Public content and logs remain evidence fields. They never become system
instructions or authority.

### 10.4 Build Agent

```text
Brief
  → external coding agent edits repository
  → define collections / blocks / patterns / theme / app code
  → schema:gen
  → review generated migration
  → format + lint + typecheck + tests + build
  → preview deployment
  → Git review / merge / production deployment
  → runtime discovery exposes only the newly deployed contracts
```

The Build Agent may use local NexPress docs, CLI plans, and generated metadata.
It does not call a runtime “change schema” capability.

## 11. Availability and failure behavior

Agent features are optional to serving a NexPress site. Enabling them must not
turn a model provider into a site-rendering dependency.

| Failure                                      | Required behavior                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent platform or remote transport disabled  | normal site/Admin behavior remains; remote Gateway route and authorization discovery return the same deliberate `404`; Doctor reports the internal disabled reason |
| Database unavailable                         | existing bootstrap fails; no capability executes                                                                                                                   |
| Audit persistence unavailable                | capability execution fails closed; no unaudited mutation is allowed                                                                                                |
| Jobs disabled                                | deterministic inline reads work; durable preview/apply/runtime calls return `SERVICE_UNAVAILABLE` before claiming acceptance                                       |
| Worker absent/stale                          | queued work remains durable; Agent Studio and health report stale worker; no synchronous web fallback executes it                                                  |
| Provider unavailable/timeout                 | bounded retry according to run policy; no unvalidated proposal or action                                                                                           |
| Provider credential unavailable              | only that connection/agent is blocked; deterministic external MCP capabilities continue                                                                            |
| Vault/KMS unavailable                        | secret-free reads may continue; every secret-requiring provider/integration action fails closed                                                                    |
| Agent OAuth keyring unavailable              | interactive token issue/rotation and unverifiable bearer calls fail closed; staff/site traffic remains independent                                                 |
| Approval integrity keyring unavailable       | approval decision/consumption and dependent mutation fail closed; read-only inspection and normal CMS traffic continue                                             |
| Preview renderer unavailable                 | ChangeSet stays unapprovable when policy requires preview                                                                                                          |
| Integration adapter malformed                | reject result, record diagnostic, and do not execute a compensating guess                                                                                          |
| Plugin discovery/host contribution malformed | preserve the existing fail-closed plugin diagnostics; v1 never converts it into an agent tool                                                                      |
| MCP transport unavailable                    | site, Admin, worker, and internal Runtime continue                                                                                                                 |
| Notification adapter unavailable             | action outcome remains persisted; notification retries independently and cannot change action status                                                               |
| Verification fails after apply               | state is `verification_failed`; surface rollback plan and never report success                                                                                     |

Rate limiting remains a separate proxy lifecycle. Agent Gateway admission also
enforces per-principal, per-site, per-capability, token, cost, and concurrency
budgets because an attacker may generate valid but expensive work below an IP
bucket.

`security.limitActor` cannot mutate a worker-local/in-memory limiter. Its
executor writes an exact durable site-scoped restriction with a bounded expiry;
the independently bootstrapped proxy reads that shared contract through an
enforcement adapter on every node. When the shared adapter is absent or
unhealthy, the direct capability is unavailable and the agent may only create
a response plan. Doctor, proxy health, Agent Studio, expiry cleanup, and the
worker must agree on the same persisted restriction contract.

## 12. Deployment shapes

### 12.1 Local development

Recommended processes:

```text
pnpm dev                    # Next web/API
pnpm worker                 # pg-boss + Agent Runtime
pnpm agent:mcp              # optional local stdio adapter
```

The stdio adapter initializes the same project bootstrap and capability
facade. Credentials come from its environment, never command-line arguments.
It does not bind a TCP port. Its credential carries an explicit exposure
ceiling and defaults to `read` when created.

### 12.2 Single host

Web and worker may run under one supervisor, but they remain distinct
lifecycles. Only the worker starts provider adapters and event processing.
A crash or deploy of the web process must not abandon an active worker claim.

### 12.3 Containers and multi-node

The recommended production shape is:

```text
N web replicas  ─┐
                 ├── Postgres (application + pg-boss + agent rows)
M worker replicas┘
```

All capability state, idempotency, approvals, tasks, and runs are durable.
Workers scale through pg-boss claims. Remote MCP v1 is stateless/pollable and
requires no sticky sessions. When explicitly enabled it shares the web
replicas' existing HTTPS listener and edge policy; it is not another container
port or public service. Process-global registries are rebuilt identically
from deployed code; site activation is resolved at call time.

### 12.4 Serverless web

The MCP POST endpoint may run in a Node.js serverless route if request duration
and body limits support it. Long operations return durable run/task references.
The dedicated worker must run on a long-lived worker platform connected to the
same Postgres database. Agent Runtime must never be started inside a request or
an Edge runtime.

### 12.5 Hard tenant isolation

Logical `site_id` isolation has the same limits as the rest of NexPress.
Deployments requiring physical tenant isolation should run one NexPress
deployment/database per tenant; the Agent Platform does not introduce a
cross-database control plane.

## 13. Security boundary summary

The architecture assumes:

- model output is untrusted data;
- MCP clients, plugin metadata, content, comments, remote pages, and logs may
  contain prompt injection;
- plugins remain trusted in-process Node code as in current NexPress v1, not a
  sandbox;
- capability descriptors and policy are code/server-owned;
- approval UI renders server-calculated targets, hashes, risks, and diffs;
- the executor accepts structured operations, never shell strings or SQL;
- inbound authorization tokens are stripped before provider or integration
  calls;
- every mutation is idempotent, audited, site-scoped, and either reversible or
  explicitly approval-gated.

Guardian correlates application-level signals and coordinates reversible
responses. It complements rather than replaces a WAF, IDS, malware scanner,
cloud audit log, or SIEM.

## 14. Implementation invariants

Code review should reject an implementation that violates any of these:

1. A Runtime model can invoke a domain write without the shared capability
   facade.
2. An MCP route and Runtime handler implement different authorization rules.
3. A durable payload omits its exact site id or relies on request-local state.
4. A model/provider SDK is initialized by an ordinary web write.
5. A successful response crosses a boundary without exact output validation.
6. A mutation is accepted when jobs are disabled or audit persistence failed.
7. A credential, raw authorization header, unredacted log body, or provider
   secret enters a prompt, run log, or tool result.
8. A plugin creates an unbounded new MCP tool namespace.
9. Runtime code changes schema, migrations, package installation, or deployed
   source.
10. A client component imports server-only Core or a provider SDK.
