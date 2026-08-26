# Agent canonical contract appendix

> Status: normative R0/AP-000 contract; the client-safe exact analyzer gate is
> implemented for all 32 v1 purposes.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).

This document specifies the complete contract. The exact body types,
context-free analyzers, field-membership inventories, size registry, and typed
canonical-byte/SHA dispatch are exported by `@nexpress/core/agent-contract`.
It does not claim that the corresponding runtime, tables, or migrations
already exist.

This appendix closes the 32-purpose registry in
[architecture.md](architecture.md#41-canonical-bytes-digests-and-macs). It is
the source for the first implementation of:

- `NpAgentCanonicalPurposeBodyMapV1`;
- one exact analyzer per body;
- the literal included-key and excluded-key fixtures;
- purpose-to-owner wiring;
- ordering and nullability fixtures; and
- one positive and negative golden-vector family per purpose.

If another design document uses a broader logical type, its canonical builder
must project that type into the exact body below. It must not hash the broader
object. Where this appendix resolves a naming or field mismatch, the
resolution is an AP-000/R0 implementation requirement and not a statement
about current code.

## 1. Shared canonical rules

Every body is a closed, plain I-JSON object. The analyzer rejects unknown
keys, duplicate raw JSON keys, omitted required keys, class instances,
accessors, prototypes other than the ordinary JSON object/array prototypes,
shared references, cycles, non-finite or unsafe numbers, and lone UTF-16
surrogates. Canonical UTC strings, ids, digests, scopes, capabilities, JSON
Schema, resource keys, operation inputs, subjects, payloads, policy rules, and
provider decisions use the exact analyzers and limits owned by their linked
contracts. A value typed as `NpAgentJsonObject` below is accepted only after
the selected capability, adapter, collection, setting, or recipe analyzer has
returned its exact normalized object.

The digest input is:

```text
utf8("np.agent-canonical-json.v1\0")
|| utf8(<exact purpose>)
|| 0x00
|| utf8(RFC8785(body))
```

SHA-256 emits `cj1:sha256:<base64url-no-padding>`. HMAC-SHA-256 emits
`cj1:hmac-sha256:<key-id>:<base64url-no-padding>`. Hash and MAC owners that
name the same purpose consume byte-identical canonical input. A digest/MAC
field never appears in its own body.

The following aliases refer to the exact existing contracts, not open
substitutes:

```ts
type NpAgentCanonicalJsonValueV1 = NpAgentJsonValue;
type NpAgentCanonicalJsonObjectV1 = NpAgentJsonObject;
type NpAgentCanonicalJsonSchemaV1 = NpAgentJsonSchema;
type NpAgentCanonicalUtcV1 = string;
type NpAgentCanonicalDigestV1 = string;
type NpAgentCanonicalIdV1 = string;

type NpAgentCanonicalAuthorityRefV1 = NpAgentInvocationAuthorityRefV1;
type NpAgentCanonicalSubjectV1 = NpAgentSubject;
type NpAgentCanonicalActorProjectionV1 = NpAgentActorProjection;
type NpAgentCanonicalTargetRefV1 = NpAgentTargetRef;
type NpAgentCanonicalResourceKeyV1 = NpAgentChangeSetResourceKeyV1;
type NpAgentCanonicalChangeSetOperationV1 = NpAgentChangeSetOperationInput;
type NpAgentCanonicalPolicyRulesV1 = NpAgentPolicyRulesV1;
type NpAgentCanonicalRunLimitsValueV1 = NpAgentRunLimitsV1;
type NpAgentCanonicalEvidenceRefV1 = NpAgentEvidenceRef;
type NpAgentCanonicalProviderDataClassV1 = NpAgentProviderDataClass;
```

Canonical ids and UTC/digest strings retain the exact grammar documented by
their owner. The aliases above do not authorize a caller to supply generated
site, actor, policy, risk, classification, target, or authority facts.

## 2. Exact body contracts

### 2.1 Action and approvals

`NpAgentActionCanonicalV1` is the immutable action proposal. The storage name
`np_agent_actions.input_hash` and the public name `proposalHash` are two
projections of this one digest.

```ts
interface NpAgentActionCanonicalV1 {
  schemaVersion: "np.agent-action.v1";
  siteId: string;
  actionId: string;
  invocationFingerprint: string;
  runFingerprint: string | null;
  sequence: number;
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  effectProfile: {
    id: string;
    contractVersion: number;
  };
  risk: NpAgentCapabilityRisk;
  requiredScopes: NpAgentScope[];
  targetRefs: NpAgentTargetRef[];
  targetVersionFacts: Array<{
    targetRef: NpAgentTargetRef;
    versionDigest: string;
  }>;
  input: NpAgentJsonObject;
}
```

The action analyzer reparses `input` with the selected capability input
analyzer. `requiredScopes` is sorted unique. `targetRefs` is sorted unique by
RFC 8785 bytes. `targetVersionFacts` has exactly one entry for every
`targetRefs` member, in the same order, after the server resolves the
resource-owner's current canonical version digest. `runFingerprint` is null
only for an inline action.

The approval statement includes the live-preview identity introduced by the
ChangeSet contract. This canonical body supersedes the older logical snippet
that carried only `previewDigest`; AP-000 makes the public/server statement
analyzers converge on this complete shape.

```ts
interface NpAgentApprovalStatementCanonicalV1 {
  version: "np.agent-approval-statement.v1";
  siteId: string;
  approvalId: string;
  requester:
    | { kind: "principal"; principalId: string; fingerprint: string }
    | { kind: "staff"; userId: string | null; fingerprint: string };
  target:
    | { kind: "changeset"; changeSetId: string; planHash: string }
    | {
        kind: "changeset_rollback";
        changeSetId: string;
        rollbackPlanId: string;
        planHash: string;
      }
    | {
        kind: "action";
        actionId: string;
        runId: string | null;
        agentId: string | null;
        proposalHash: string;
      };
  capabilityId: string;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  policyHashes: string[];
  requiresLivePreview: boolean;
  previewId: string | null;
  previewDigest: string | null;
  risk: "reversible" | "sensitive" | "destructive";
  reauthentication:
    | { mode: "none" }
    | {
        mode: "recent";
        maxAgeSeconds: number;
        assurance: "staff-primary";
      };
  createdAt: string;
  expiresAt: string;
}

interface NpAgentApprovalDecisionCanonicalV1 {
  schemaVersion: "np.agent-approval-decision.v1";
  siteId: string;
  approvalId: string;
  approvalGeneration: number;
  statementHash: string;
  decision: "approve" | "reject";
  deciderFingerprint: string;
  currentHumanCapabilities: NpCapability[];
  reason: string | null;
  reauthentication:
    | { mode: "none" }
    | {
        mode: "recent";
        assurance: "staff-primary";
        maxAgeSeconds: number;
        reauthenticatedAt: string;
        sessionFactFingerprint: string;
      };
  decidedAt: string;
}

interface NpAgentApprovalRevocationCanonicalV1 {
  schemaVersion: "np.agent-approval-revocation.v1";
  siteId: string;
  approvalId: string;
  approvalGeneration: number;
  statementHash: string;
  decisionHash: string | null;
  revocationKind:
    "human" | "authority_loss" | "site_deleting" | "integrity_key_retired" | "target_invalidated";
  revokerFingerprint: string;
  revocationCode: string;
  revocationReason: string | null;
  revokedAt: string;
}
```

Scope, human capability, predicate, and policy-hash arrays are sorted unique.
`requiresLivePreview=false` requires both preview fields null; `true` requires
both non-null. A rejected decision always uses
`reauthentication:{mode:"none"}`. For an approved decision, reauthentication
mode, assurance, and `maxAgeSeconds` equal the statement requirement; the
decision additionally binds the actual `reauthenticatedAt` and combined
session/primary-method `sessionFactFingerprint`. Current human capabilities
are sorted unique, and an approval requires them to contain every
statement-required human capability. The target union's `planHash` or
`proposalHash` has branch-specific ownership: a ChangeSet `planHash` binds its
sealed operations, risk, scopes, human requirements, policy hashes, and
validation generation, while an action `proposalHash` binds its exact input,
capability/effect definition, risk, scopes, targets, and target-version facts.
For an action, policy hashes, human predicates, live-preview identity, and
reauthentication requirements are instead direct members of this immutable
approval statement and are therefore covered by its statement hash and MAC.
V1 forbids parallel undefined subset digests for either branch. Non-human revocations require
`revocationReason:null`; a human revocation may use bounded text.
`decisionHash` is non-null only when a prior immutable approve/reject decision
exists.

`@nexpress/core/agent-contract` implements these three bodies through the named
`npAnalyzeAgentApproval*Canonical()` and `npRequireAgentApproval*Canonical()`
surfaces. Statement bytes can be built directly after exact analysis. Decision
builders additionally accept one statement body/hash/generation binding and
recompute the statement hash before checking site, approval, generation,
capability, lifetime, and reauthentication facts. Revocation builders perform
the same statement check and, when `decisionHash` is non-null, reparse and
rehash the exact prior decision. Their named digest and approval-integrity MAC
helpers therefore cannot silently bind structurally valid bodies from another
approval. MAC verification uses Web Crypto HMAC verification over the same
domain-separated bytes; the bounded key id remains output metadata and is not
inserted into any body. The analyzers enforce the 256 KiB statement and 64 KiB
decision/revocation ceilings. Persistence, challenge issuance, key rotation,
and approval state transitions remain the AP-401 service layer rather than
canonical-body behavior.

### 2.2 Preview artifact

This is the complete manifest already owned by the preview contract:

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

Artifacts are sorted by unique positive `ordinal`. Screenshot rows require a
route, locale (which may be null), viewport, image MIME, and null report-part
fields. Report rows require null route/locale/viewport, JSON MIME, and
positive contiguous part numbers with one byte-equal total no greater than
four.

`@nexpress/core/agent-contract` implements this body through the named
`npAnalyzeAgentPreviewArtifactManifestCanonical()` and
`npRequireAgentPreviewArtifactManifestCanonical()` surfaces. The analyzer
rebuilds an independent exact manifest, validates canonical site/UUID/digest
and route/locale values, enforces the `20` screenshot, `4` report, and `24`
total limits plus the `2 MiB`/`512 KiB` branch byte ceilings, and requires all
rows for the same preview to carry one byte-equal expiry after their creation
times. Report parts are contiguous in artifact order and their common total
equals the complete report-row count. The named byte/digest helpers use the
`np.agent-artifact.v1` domain and 256 KiB canonical-body ceiling. They validate
but never synthesize the independent raw-byte `ac1:*` content digest; raw
content framing and storage verification remain owned by the preview service.

### 2.3 Authorization, budget, and registries

```ts
interface NpAgentAuthorizationContextCanonicalV1 {
  schemaVersion: "np.agent-authorization-context.v1";
  siteId: string;
  actor:
    | {
        kind: "principal";
        principalId: string;
        actorFingerprint: string;
      }
    | {
        kind: "staff";
        userId: string;
        actorFingerprint: string;
      };
  transport: "mcp-oauth" | "mcp-service" | "stdio" | "agent-api" | "runtime" | "admin";
  gatewayExposure: "read" | "propose" | "approved-execute" | null;
  authorityRef: NpAgentInvocationAuthorityRefV1;
}

interface NpAgentBudgetSnapshotCanonicalV1 {
  schemaVersion: "np.agent-budget-snapshot.v1";
  siteId: string;
  principalId: string;
  agentId: string | null;
  recipe: {
    id: NpAgentRecipeId;
    version: number;
    fingerprint: string;
  } | null;
  capturedAt: string;
  sourceRefs: Array<{
    kind: "deployment" | "site" | "agent" | "policy" | "recipe";
    id: string | null;
    version: number;
    digest: string;
  }>;
  limits: NpAgentRunLimitsV1;
  counters: {
    concurrentRuns: number;
    concurrentProviderCalls: number;
    runsRollingHour: number;
    providerCallsRollingHour: number;
    inputTokensUtcDay: number;
    outputTokensUtcDay: number;
    inputTokensUtcMonth: number;
    outputTokensUtcMonth: number;
    costMicrosUtcDay: number;
    costMicrosUtcMonth: number;
    incidentAnalysesFingerprintUtcDay: number;
    directActionsRollingHour: number;
    directActionsSubjectRollingHour: number;
  };
  windows: {
    rollingHourStartedAt: string;
    utcDay: string;
    utcMonth: string;
  };
  reservation: {
    runs: number;
    providerCalls: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
  };
}

interface NpAgentEffectProfileCanonicalV1 {
  schemaVersion: "np.agent-effect-profile.v1";
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  implementationVersion: number;
  profileId: string;
  kind: "read" | "mutation";
  reversibility: "none" | "compensatable";
  minimumGatewayExposure: "read" | "propose" | "approved-execute" | null;
  effectContractVersion: number;
  verifierId: string | null;
  compensatorId: string | null;
}

interface NpAgentCapabilityRegistryEntryCanonicalV1 {
  descriptor: NpAgentCapabilityDescriptor;
  implementationVersion: number;
  effectProfiles: NpAgentEffectProfileCanonicalV1[];
}

interface NpAgentCapabilityRegistryCanonicalV1 {
  schemaVersion: "np.agent-capability-registry.v1";
  projection: "definition" | "registry";
  capabilities: NpAgentCapabilityRegistryEntryCanonicalV1[];
}

interface NpAgentRecipeDefinitionCanonicalV1 {
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
}

interface NpAgentRecipeRegistryCanonicalV1 {
  schemaVersion: "np.agent-recipe-registry.v1";
  projection: "definition" | "registry";
  recipes: NpAgentRecipeDefinitionCanonicalV1[];
}
```

The authorization actor id and branch must byte-equal `authorityRef`. A staff
actor uses only `staff-session`, `transport:"admin"`, and null exposure. A
principal `service-family` uses the audience-selected transport:
`urn:nexpress:agent-gateway:stdio` selects `stdio`, canonical queryless HTTPS
`/api/mcp` selects `mcp-service`, and canonical queryless HTTPS
`/api/agent/v1` selects `agent-api`. A principal `oauth-grant` uses only
`transport:"mcp-oauth"` and a canonical queryless HTTPS `/api/mcp` audience. A
principal `runtime-run` uses only `transport:"runtime"` and null exposure.
Service/OAuth `gatewayExposure` is non-null and byte-equal to the authority's
`exposureMode`; it is the already narrowed effective ceiling, never a caller
request. Actor fingerprints, OAuth client ids, and audiences are bounded
visible ASCII. Authority ids are canonical lowercase UUIDs, authority versions
are positive integers except that the staff user token version may be zero,
and the Runtime deadline is canonical millisecond UTC. Budget source refs
sort by `(kind,id-or-empty,version,digest)` and are unique. The recipe is null
for Gateway/deterministic admission without a recipe.

`@nexpress/core/agent-contract` implements the budget body through the named
`npAnalyzeAgentBudgetSnapshotCanonical()` and
`npRequireAgentBudgetSnapshotCanonical()` surfaces. The analyzer rebuilds an
independent exact snapshot, validates canonical site/principal/Agent/recipe
identities and source digests, reuses the one exact run-limits parser, and
checks rolling-hour UTC instants plus canonical UTC day/month labels. Counts,
tokens, and reservations are non-negative signed 32-bit integers; cost micros
are non-negative safe integers. A recipe is accepted only with a non-null
Agent, source refs remain sorted unique, and the named byte/digest helpers
enforce the 256 KiB body ceiling under the
`np.agent-budget-snapshot.v1` domain. Effective inheritance, transactional
counter measurement, reservation admission, and retained-row agreement remain
the owning Runtime service and persistence responsibilities.

Capabilities sort by descriptor id. `projection:"definition"` requires
exactly one capability and produces that definition's
`capabilityFingerprint`; `projection:"registry"` requires the complete
non-empty installed set and produces `registryFingerprint`. Their
`requiredScopes` and all descriptor-owned unordered arrays are sorted unique.
Effect profiles sort by `profileId`. A read profile is
`kind:"read",reversibility:"none",verifierId:null,compensatorId:null`; a
mutation requires a verifier, and only a compensatable mutation has a
non-null compensator. A descriptor `gateway:null` requires every effect's
`minimumGatewayExposure:null`; a projected descriptor has a sorted unique
non-empty transport set and at least one effect with a non-null exposure.
Changing an effect's exposure changes both its effect fingerprint and the
enclosing capability fingerprint.

Recipes sort by `(id,version)`. `projection:"definition"` requires exactly one
recipe and produces its definition `fingerprint`; `projection:"registry"`
requires the complete non-empty installed recipe set and produces the registry
fingerprint. `allowedTemplates`, `triggerKinds`, and `capabilityIds` are sorted
unique. `instruction` is null exactly when provider mode is `forbidden`.
Derived fingerprints are not members of their own bodies.

For both registry contracts, the context-free exact body analyzer enforces the
definition cardinality, non-empty registry cardinality, item shape, and
ordering. Completeness against the installed code-owned set belongs to the
named capability/recipe domain builder, which compares the candidate to its
validated bootstrap snapshot before hashing. A one-item installed set is a
valid registry; a one-item projection drawn from a larger installed set is
not.

The capability purpose exposes this boundary literally. The context-free
`npAnalyzeAgentCapabilityRegistryCanonical()` and
`npRequireAgentCapabilityRegistryCanonical()` validate exact bodies without
claiming installation completeness. The contextual
`npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities()` reparses
the supplied installed-capability array as a complete registry snapshot. It
requires a definition to be one byte-exact member and a registry to equal the
whole sorted snapshot. `npBuildAgentCapabilityRegistryCanonicalBytes()` and
`npDigestAgentCapabilityRegistryCanonical()` always require that snapshot and
perform the same comparison before producing bytes. A structurally valid but
incomplete candidate fails with
`AGENT_CANONICAL_INCOMPLETE_REGISTRY`; malformed snapshots remain ordinary
contract failures. Descriptor and canonical-effect versions/exposure/verifier/
compensator facts are cross-checked, while function references, timestamps,
and derived fingerprints never enter the body.

The recipe purpose exposes the paired boundary through
`npAnalyzeAgentRecipeRegistryCanonical()` and
`npRequireAgentRecipeRegistryCanonical()`. It accepts only the five closed
recipe ids at version 1, validates the closed template/task/provider/trigger
inventories, reparses all three JSON Schemas with their owner analyzer, and
enforces the provider-mode/instruction null matrix. Definition and registry
entries retain only their canonical data fields; parser and executor
functions, registration time, and both derived fingerprint fields are
excluded. The contextual
`npRequireAgentRecipeRegistryCanonicalForInstalledRecipes()` reparses the
installed array as a complete registry snapshot, and the named byte/digest
builders require the same snapshot before producing output. Both registry
purposes share `NpAgentCanonicalIncompleteRegistryError` and exact canonical
member/whole-snapshot comparison. The recipe body has an 8 MiB ceiling;
instruction text remains an exact I-JSON string under that ceiling and is not
trimmed, normalized, or assigned a narrower undocumented bound.

### 2.4 ChangeSet proposal, plan, and snapshot

```ts
interface NpAgentChangeSetProposalCanonicalV1 {
  schemaVersion: "np.agent-changeset-proposal.v1";
  siteId: string;
  changeSetId: string;
  draftVersion: number;
  title: string;
  summary: string | null;
  operations: Array<{
    ordinal: number;
    operation: NpAgentChangeSetOperationInput;
    canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  }>;
}

interface NpAgentChangeSetSnapshotCanonicalV1 {
  schemaVersion: "np.agent-changeset-snapshot.v1";
  siteId: string;
  changeSetId: string;
  operationOrdinal: number;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  presence: "present" | "absent";
  base: {
    version: string;
    digest: string;
  } | null;
  value: NpAgentJsonValue | null;
}

interface NpAgentInitialChangeSetPlanBodyV1 {
  draftVersion: number;
  draftHash: string;
  validationGeneration: number;
  baseFingerprint: string;
  operations: Array<{
    ordinal: number;
    operation: NpAgentChangeSetOperationInput;
    canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
    beforeHash: string | null;
    proposedAfterHash: string;
    snapshotHash: string;
    rollbackClass: "full" | "residual";
    residualCodes: string[];
  }>;
  risk: NpAgentRiskSummary;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  policyHashes: string[];
  expiresAt: string;
  rollbackWindowSeconds: number;
}

interface NpAgentRollbackChangeSetPlanBodyV1 {
  rollbackPlanId: string;
  generation: number;
  compensatesExecutionId: string;
  originalPlanHash: string;
  appliedResultDigest: string;
  baseFingerprint: string;
  operations: Array<{
    ordinal: number;
    originalOperationOrdinal: number;
    canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
    originalSnapshotHash: string;
    expectedCurrentHash: string;
    expectedCurrentVersion: string;
    compensationOperation: NpAgentChangeSetOperationInput;
    proposedAfterHash: string;
    rollbackClass: "full" | "residual";
    residualCodes: string[];
  }>;
  risk: NpAgentRiskSummary;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  policyHashes: string[];
  expiresAt: string;
}

type NpAgentChangeSetPlanCanonicalV1 =
  | {
      schemaVersion: "np.agent-changeset-plan.v1";
      planKind: "changeset";
      siteId: string;
      changeSetId: string;
      body: NpAgentInitialChangeSetPlanBodyV1;
    }
  | {
      schemaVersion: "np.agent-changeset-plan.v1";
      planKind: "rollback";
      siteId: string;
      changeSetId: string;
      body: NpAgentRollbackChangeSetPlanBodyV1;
    };
```

Both operation arrays sort by unique positive `ordinal`; original operation
ordinals in a rollback body are also unique. The canonical resource-lock order
is a separate execution projection and cannot reorder either array.
`presence:"absent"` requires both `base` and `value` null.
`presence:"present"` requires both non-null. Proposal `summary` is explicitly
null when absent.

Core exposes the context-free boundary as
`npAnalyzeAgentChangeSetOperationInput()`/
`npRequireAgentChangeSetOperationInput()` and
`npAnalyzeAgentChangeSetResourceKey()`/
`npRequireAgentChangeSetResourceKey()`. The operation analyzer owns the closed
nine shape groups and five tagged resource kinds, reuses the existing
client-safe navigation, theme-token-overlay, and SEO setting analyzers, and
accepts document JSON only as the already-canonical bounded transport value;
draft admission still reparses it against the selected live collection
schema. `npAnalyzeAgentChangeSetProposalCanonical()` and
`npAnalyzeAgentChangeSetSnapshotCanonical()` provide the exact body boundary,
paired with named `npRequire*`, `npBuild*CanonicalBytes`, and
`npDigest*Canonical` functions. The builders enforce the 4 MiB proposal and
256 KiB snapshot ceilings before domain separation; proposal operations are
not reordered on the caller's behalf.
`npAnalyzeAgentChangeSetPlanCanonical()` provides the same context-free exact
boundary for both discriminated plan branches, paired with
`npRequireAgentChangeSetPlanCanonical()`,
`npBuildAgentChangeSetPlanCanonicalBytes()`, and
`npDigestAgentChangeSetPlanCanonical()`. It reparses every embedded operation
and canonical resource key through the owner analyzers, enforces the exact
branch/nested inventories, sorted set arrays, create-only null before hash,
rollback source-ordinal uniqueness, residual-risk floor, sealed rollback
duration, and the 4 MiB body ceiling. Neither plan operation array is reordered
on the caller's behalf, and the resulting SHA-256 digest is the owning
`planHash`.

Both plan branches sort scope/capability/predicate/policy/residual-code arrays
unique. In the initial branch, `beforeHash:null` is permitted only for a
server-reserved create target. `snapshotHash`/`originalSnapshotHash` owns or
copies the exact before-snapshot digest above; the dedicated `snapshot_hash`
column is never replaced by the resource-state `before_hash`.
`rollbackWindowSeconds` is the sealed policy-resolved duration. Apply derives
`rollback_eligible_until = committed_at + rollbackWindowSeconds`; the future
timestamp is not part of the pre-apply plan body. The rollback branch instead
uses its independently known absolute `expiresAt`, bounded by that derived
deadline and snapshot availability.
An `unavailable` classification is a blocking validation issue and therefore
never enters a sealed canonical plan.

### 2.5 Connection contracts

```ts
interface NpAgentConnectionConfigCanonicalV1 {
  schemaVersion: "np.agent-connection-config.v1";
  siteId: string;
  connectionId: string;
  kind: NpAgentConnectionKind;
  provider: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  authKind: "api_key" | "oauth";
  configVersion: number;
  config: NpAgentJsonObject;
  pricingCatalog: NpAgentModelPricingV1[];
  dataProcessingCeiling: NpAgentProviderDataClass;
}

interface NpAgentConnectionDestinationCanonicalV1 {
  schemaVersion: "np.agent-connection-destination.v1";
  siteId: string;
  connectionId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  accountSubjectKeyId: string;
  accountSubjectDigest: string;
  destinationDescriptor: NpAgentConnectionDestinationDescriptorV1;
}

type NpAgentConnectionOperationAuthorityCanonicalV1 =
  | { kind: "admin-invocation"; invocationId: string }
  | { kind: "oauth-setup"; authRequestId: string }
  | { kind: "runtime-refresh"; runId: string };

interface NpAgentConnectionOperationRequestCanonicalV1 {
  schemaVersion: "np.agent-connection-operation.v1";
  siteId: string;
  operationId: string;
  connectionId: string;
  authority: NpAgentConnectionOperationAuthorityCanonicalV1;
  kind:
    | "probe"
    | "activate-secret"
    | "activate-config"
    | "oauth-exchange"
    | "oauth-refresh"
    | "destroy-secret";
  expectedConfigVersion: number;
  expectedConfigHash: string;
  configSnapshotId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  inputSecretVersionIds: string[];
  expectedSecretVersionId: string | null;
  expectedCredentialVersion: number | null;
  expectedRefreshGeneration: number | null;
  idempotencyKey: string;
}
```

`config` is reparsed by the frozen adapter schema. Pricing entries sort by
`(modelId,effectiveFrom,pricingId,version)`. Connection kind, provider,
adapter, auth kind, config version, catalog, and data ceiling are all bound by
`configHash`; account and destination projections are deliberately separate.

The destination descriptor is an exact adapter-schema result. The destination
MAC uses the dedicated destination keyring and the same body for every
connection, config snapshot, and notification projection.

Exactly one connection-operation authority branch is present and must match
the persisted `source`. `inputSecretVersionIds` is unique and uses semantic
purpose order: active credential when required, provider OAuth code when
required, then provider OAuth PKCE verifier when required. The two expected
secret/version fields are both null or both non-null; refresh generation is
non-null only for OAuth refresh. The state-dependent `deadlineAt` is not
request input: the row may set it when an awaiting-secret exchange becomes
queued without changing `requestHash`.

### 2.6 Event and signal evidence

The event body intentionally omits the generated event id and persistence
times. It is the exact deduplication identity described by the Runtime
contract.

```ts
interface NpAgentEventCanonicalV1 {
  version: "np.agent-event.v1";
  siteId: string;
  kind: NpAgentEventKind;
  occurredAt: string;
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
    component: string;
  };
  subject: NpAgentSubject | null;
  actor: NpAgentActorProjection | null;
  causation: NpAgentEventCausationV1 | null;
  correlationId: string | null;
  deduplicationKey: string | null;
  privacy: "public" | "internal" | "sensitive";
  payload: NpAgentEventPayload;
}

interface NpAgentSignalEvidenceCanonicalV1 {
  schemaVersion: "np.agent-signal-evidence.v1";
  siteId: string;
  detectorId: string;
  detectorVersion: number;
  category: NpAgentIncidentCategory;
  window: {
    startedAt: string;
    endedAt: string;
  };
  subject: NpAgentSubject | null;
  evidence: NpAgentEvidenceRef[];
}
```

`kind` must equal `payload.kind`. Event and evidence unions retain their
declared field order only for human readability; RFC 8785 determines object
key order. Signal evidence sorts by
`(observedAt,kind,canonical-source-id,digest)` and is unique by the complete
reference body. A signal with no evidence is invalid. The signal's severity,
score, lifecycle, incident attachment, fingerprint, and ingestion timestamps
do not alter the immutable evidence digest.

### 2.7 Invocation idempotency and MCP task result

```ts
interface NpAgentInvocationRequestCanonicalCommonV1 {
  schemaVersion: "np.agent-idempotency-request.v1";
  siteId: string;
  actorKind: "principal" | "staff";
  actorFingerprint: string;
  authorizationContextFingerprint: string;
  contractVersion: number;
  contractFingerprint: string;
  input: NpAgentJsonObject;
}

type NpAgentInvocationRequestCanonicalV1 =
  | (NpAgentInvocationRequestCanonicalCommonV1 & {
      operationKind: "capability";
      operationId: NpAgentCapabilityId;
      effectProfile: {
        id: string;
        contractVersion: number;
      };
    })
  | (NpAgentInvocationRequestCanonicalCommonV1 & {
      operationKind: "admin";
      operationId: string;
      effectProfile: null;
    });

type NpAgentMcpStoredTerminalResultV1 =
  | {
      schemaVersion: "np.agent-mcp-stored-task-result.v1";
      kind: "tool_result";
      result: NpAgentJsonObject;
    }
  | {
      schemaVersion: "np.agent-mcp-stored-task-result.v1";
      kind: "jsonrpc_error";
      error: {
        code: number;
        message: string;
        data?: NpAgentJsonValue;
      };
    };
```

Capability/Admin input is reparsed by the frozen operation analyzer before
the idempotency body is built. The context-free canonical analyzer then
descriptor-safely copies one object-root I-JSON input with the invocation
limits: depth 32, 20,000 nodes, 5,000 array items, 512 object properties,
262,144 UTF-16 code units per string, and 4 MiB canonical input/body bytes. It rejects accessors,
cycles, shared references, sparse or exotic arrays, exotic objects, lone
surrogates, and non-finite numbers without coercion. Capability operations
require one closed core `NpAgentCapabilityId` and a non-null effect profile;
the domain builder binds that profile to the frozen registry. Admin operations
require a canonical Agent identifier plus `null`, and the domain builder binds
that identifier, version, and fingerprint to the closed route-operation
registry. Every present contract version is a positive signed 32-bit integer. Actor fingerprints
are non-empty visible ASCII of at most 256 characters; authorization and
contract fingerprints are exact `cj1:sha256:` digests. For a schema-declared
write-only Admin secret, the route-owned builder replaces the raw leaf with the exact
non-secret vault commitment
`{kind:"vault-request",vaultOperationId,secretVersionId,requestDigest}` before
assigning `input`; the dedicated vault request HMAC binds the secret bytes.
The raw secret is never a canonical JSON member. The complete resulting body
is retained as `np_agent_invocations.request_body`, whose analyzer must
reproduce `request_hash`. `idempotencyKey` is an owner-tuple field and is
deliberately not duplicated in the body. MCP execution mode, requested task
TTL, JSON-RPC id, transport request id, and task id are also outside the
domain request hash.

The MCP tool-result branch descriptor-safely validates the MCP `2025-11-25`
`CallToolResult`: `content` is required; `structuredContent`, `isError`, and
`_meta` are optional; and text, image, audio, resource-link, and embedded-
resource content blocks retain their protocol-defined fields and safe I-JSON
extensions. Byte-bearing fields use canonical padded RFC 4648 base64. JSON-RPC
envelope/request members are forbidden inside the result.
The raw result is bounded by the 5 MiB MCP frame ceiling; the retained result
uses the invocation depth/node/container/string limits, the complete canonical
body is at most 4 MiB, and `structuredContent` is independently at most 3 MiB.
Before persistence, the analyzer removes only
`_meta["io.modelcontextprotocol/related-task"]`; if that leaves `_meta` empty,
it removes `_meta` too. Other safe MCP extension metadata remains byte-
significant. Consequently transport task identity never changes the retained
digest.

The id-less JSON-RPC error uses one safe-integer code and a non-empty, trimmed
safe message of at most 2,000 characters. Optional `data` uses the shared API
error-detail bounds (depth 8, 1,000 nodes, 200 array entries, 200 object keys,
128 characters per key, and 8,000 characters per string). An omitted `data`
key and explicit `data:null` are distinct valid canonical objects; the analyzer
never adds one form for the other.

### 2.8 Notification delivery and policy

```ts
type NpAgentNotificationDeliveryCanonicalV1 =
  | {
      schemaVersion: "np.agent-notification-delivery.v1";
      siteId: string;
      notificationId: string;
      channel: "admin";
      source: {
        incidentId: string | null;
        runId: string | null;
        actionId: string | null;
        transitionVersion: number;
      };
      deduplicationKey: string;
      payloadRedacted: NpAgentJsonObject;
      attempt: 0;
      result: { state: "confirmed_local" };
      observedAt: string;
    }
  | {
      schemaVersion: "np.agent-notification-delivery.v1";
      siteId: string;
      notificationId: string;
      channel: "email" | "slack" | "webhook" | "siem";
      source: {
        incidentId: string | null;
        runId: string | null;
        actionId: string | null;
        transitionVersion: number;
      };
      deduplicationKey: string;
      payloadRedacted: NpAgentJsonObject;
      attempt: number;
      adapter: {
        id: string;
        contractVersion: number;
        fingerprint: string;
        idempotency: "enforced" | "none";
      };
      connection: {
        id: string;
        configSnapshotId: string;
        configVersion: number;
        configHash: string;
        accountSubjectKeyId: string;
        accountSubjectDigest: string;
        destinationKeyId: string;
        destinationFingerprint: string;
      };
      result:
        | { state: "confirmed" }
        | { state: "retryable_not_sent"; errorCode: string }
        | { state: "permanent_failure"; errorCode: string }
        | { state: "ambiguous"; errorCode: string };
      observedAt: string;
    };

interface NpAgentPolicyCanonicalV1 {
  schemaVersion: "np.agent-policy.v1";
  instructions: string;
  rules: NpAgentPolicyRulesV1;
}
```

At least one notification source id is non-null. The provider message id is a
support receipt and is not digest input. An external result binds the frozen
adapter/config/account/destination tuple and the exact attempt. The Admin
branch has no adapter/connection keys. `payloadRedacted` is first reparsed by
the notification payload analyzer.

Policy site/id/agent/version association, status, display name,
activation/persistence times, and staff attribution are lifecycle metadata.
`content_hash` is the storage name for this exact instructions-plus-rules
digest, matching the data-model contract.

### 2.9 Preview contract, routes, and staff authorization

```ts
interface NpAgentPreviewContractCanonicalV1 {
  schemaVersion: "np.agent-preview-contract.v1";
  overlayResolverVersion: number;
  rendererId: string;
  rendererVersion: number;
  rendererFingerprint: string;
  screenshotAdapterId: string | null;
  screenshotAdapterVersion: number | null;
  screenshotAdapterFingerprint: string | null;
  routeParserVersion: number;
  checkRegistryVersion: number;
  linkAllowlistVersion: number;
  linkAllowlistOrigins: string[];
  networkPolicyVersion: number;
  artifactLimitsVersion: number;
  reportSchemaVersion: number;
  responseHeaderBuilderVersion: number;
  cspBuilderVersion: number;
}

interface NpAgentPreviewRoutesCanonicalV1 {
  schemaVersion: "np.agent-preview-routes.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  routes: Array<{
    route: string;
    locale: string | null;
    audience: "public";
  }>;
}

interface NpAgentStaffSiteAuthorizationCanonicalV1 {
  schemaVersion: "np.agent-staff-site-authorization.v1";
  siteId: string;
  userId: string;
  userTokenVersion: number;
  authority:
    | {
        kind: "super-admin";
        capabilities: NpCapability[];
      }
    | {
        kind: "site-role";
        source: "membership" | "default-site-fallback";
        role: string;
        capabilities: NpCapability[];
      };
}
```

All three screenshot-adapter fields are null or all are non-null. Origins are
canonical queryless HTTPS origins, sorted unique. Routes sort by
`(route,locale-or-empty,audience)` and are unique. Capabilities sort by the
shipped `NpCapability` string. A route is an absolute site-relative path with
no origin, query, fragment, or dot segment.

`@nexpress/core/agent-contract` implements the two preview bodies through the
named `npAnalyzeAgentPreviewContractCanonical()` and
`npAnalyzeAgentPreviewRoutesCanonical()` surfaces, paired require, byte, and
digest helpers. The contract analyzer rebuilds an independent exact body,
requires positive implementation versions and bounded canonical identifiers
and fingerprints, enforces the all-null/all-non-null screenshot-adapter
triple, sorts no caller data, and accepts only already sorted unique canonical
queryless HTTPS origins under the 64 KiB body ceiling. The routes analyzer
validates canonical site/UUID/generation/plan identity, explicit public route
tuples, canonical locale values, and Unicode-code-point tuple order under the
256 KiB ceiling. Its route/locale parser is the same implementation used by
the preview-artifact manifest. Installed renderer/adapter/registry lookup,
route-audience derivation, token/session issuance, and retained fingerprint
checks remain contextual AP-306 service responsibilities rather than generic
canonical-body behavior.

### 2.10 Provider request and response

The request body extends the provider adapter's logical request with the
server-owned call, connection, credential-version, classification, and
idempotency bindings required to make the persisted request digest
unambiguous.

```ts
interface NpAgentProviderRequestCanonicalV1 {
  schemaVersion: "np.agent-provider-request.v1";
  siteId: string;
  providerCallId: string;
  runId: string;
  sequence: number;
  retryOfId: string | null;
  idempotencyKey: string;
  connection: {
    id: string;
    configSnapshotId: string;
    configVersion: number;
    configHash: string;
    secretVersionId: string;
    credentialVersion: number;
    adapterId: string;
    adapterContractVersion: number;
    adapterFingerprint: string;
  };
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
  classificationManifestDigest: string;
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

interface NpAgentProviderResponseCanonicalV1 {
  schemaVersion: "np.agent-provider-response.v1";
  siteId: string;
  providerCallId: string;
  runId: string;
  requestDigest: string;
  dispatchState: "not-dispatched" | "dispatched" | "unknown";
  outcome: NpAgentProviderInvokeOutcomeV1;
  decision: NpAgentProviderTaskOutputV1 | null;
  observedAt: string;
}
```

Trusted context sorts by `(kind,id,digest)`; untrusted evidence sorts by
`(kind,id,observedAt,digest)`; tools sort by capability id. Each array is
unique by its sort tuple. The request analyzer recomputes every classification
entry and the manifest digest before hashing. Request text remains part of
the request digest even when optional diagnostic body retention is disabled.

`dispatchState` and the outcome branch must match: success is `dispatched`;
ambiguous is `unknown`; a failed outcome repeats its own dispatch state.
`decision` is non-null only for a successful outcome whose output parses as
the frozen recipe response. A pre-dispatch failure has no provider request id,
usage, cost, or finish reason under the exact invoke-outcome analyzer.

### 2.11 Restriction, run admission, and run limits

The canonical restriction body is the exact adapter descriptor:

```ts
interface NpAgentRestrictionCanonicalV1 {
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

interface NpAgentRunAdmissionCanonicalV1 {
  schemaVersion: "np.agent-run-admission.v1";
  siteId: string;
  origin: "gateway" | "runtime";
  principalId: string;
  invocationId: string | null;
  triggerId: string | null;
  agent: {
    id: string;
    versionId: string;
    configHash: string;
  } | null;
  lineage: {
    rootRunId: string;
    parentRunId: string | null;
    causalDepth: number;
    causalEventId: string | null;
    causalActionId: string | null;
  };
  recipe: {
    id: NpAgentRecipeId;
    version: number;
    fingerprint: string;
    instructionTemplateId: string | null;
    instructionTemplateVersion: number | null;
    instructionDigest: string | null;
    responseSchemaDigest: string;
    manualInputSchemaDigest: string | null;
  } | null;
  goal: string;
  eventRef: NpAgentJsonObject | null;
  policyRefs: Array<{
    kind: "framework" | "feature-setting" | "site-policy" | "agent-policy";
    id: string | null;
    version: number;
    digest: string;
  }>;
  runLimitsHash: string;
  budgetSnapshotHash: string;
  idempotencyKey: string;
  connection: {
    id: string;
    configSnapshotId: string;
    configVersion: number;
    configHash: string;
    dataClassCeiling: NpAgentProviderDataClass;
    pricingId: string;
    pricingVersion: number;
    pricingFingerprint: string;
    pricingEffectiveAt: string;
  } | null;
  admittedAt: string;
  deadlineAt: string;
}

type NpAgentRunLimitsCanonicalV1 = NpAgentRunLimitsV1;
```

`@nexpress/core/agent-contract` implements the restriction body through
`npAnalyzeAgentRestrictionCanonical()` and
`npRequireAgentRestrictionCanonical()`, with
`NpAgentRestrictionDescriptorV1` as an alias of the canonical type. The
public contract owns the closed actor-bucket purpose, principal-kind, and
restriction-scope inventories plus the 60/900/3,600-second TTL constants.
The analyzer requires exactly one authenticated-principal or opaque-bucket
subject branch, a canonical UUID principal or an exact 43-character
base64url HMAC bucket, a positive projection version, a visible-ASCII
projection fingerprint of at most 256 characters, a canonical key id, and a
sorted unique non-empty scope set. Start/expiry instants are canonical UTC and
must be 60–3,600 seconds apart; the reason is an exact 1–64 character uppercase
`NpAgentStableCode` and `targetVersionDigest` is an exact canonical SHA-256
digest. Named byte/digest helpers enforce the 64 KiB purpose ceiling.
Projection registration/fingerprint agreement, key retention, raw-subject
normalization and bucket derivation, same-site source action/incident lookup,
and exact adapter install/verify/remove confirmation remain R7 service,
persistence, and adapter checks.

Restriction scopes are sorted unique and non-empty. The subject is exactly one
branch. AP-000 adds `np_agent_actor_restrictions.restriction_hash`; it must not
reuse `target_version_digest`, which names the protected target version and
has different semantics.

Gateway admission requires null trigger/agent/recipe/connection. Runtime
admission requires a non-null Agent and recipe; a deterministic recipe has
null connection. Instruction fields are all null only for a provider-forbidden
recipe and otherwise all non-null. Policy refs sort by
`(kind,id-or-empty,version,digest)`. The context-free canonical analyzer
rebuilds `eventRef`, when non-null, as one bounded independent I-JSON object;
before AP-503 constructs that body, the owning Runtime service additionally
reparses it through the selected recipe's exact event-reference analyzer and
passes only that normalized result.
`admittedAt` is always the canonical ISO projection of the owning run's
immutable `queued_at`, and `deadlineAt` is the projection of its
`deadline_at`; rehydration may not select `created_at`, `started_at`, or the
current clock.

The `runLimitsHash` is computed independently from the exact
`NpAgentRunLimitsV1` value stored beside the admission body. The run-admission
body owns `admission_fingerprint`; neither body contains the other's derived
digest. Root lineage uses a server-reserved run id before hashing; a root has
that id as `rootRunId`, null parent/causal ids, and depth zero.

`@nexpress/core/agent-contract` implements the context-free body through
`npAnalyzeAgentRunAdmissionCanonical()` and
`npRequireAgentRunAdmissionCanonical()`. It rebuilds an independent exact
body, applies the Gateway/Runtime null matrix, bounds lineage to causal depth
four, pairs causal event/action ids and the recipe instruction triple, checks
the closed provider data-class and policy-kind inventories, and validates the
complete immutable connection/pricing tuple. Goals and caller-stable
idempotency keys are bounded, admission/deadline instants are canonical and at
most 24 hours apart, and named byte/digest helpers enforce the 512 KiB purpose
ceiling. Same-site parent/event/action lookup, root-id equality, selected
recipe/event-reference agreement, policy completeness, stored run-limit and
budget hash agreement, exact queued/deadline column projection, and connection
catalog selection remain AP-503/AP-504 service and persistence checks.

### 2.12 Site deletion plan and vault AAD

```ts
type NpAgentSiteDeletionExternalTargetCanonicalV1 =
  | {
      kind: "restriction";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "vault-operation";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "connection-operation";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "preview-artifact-upload";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "preview-artifact-delete";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    };

interface NpAgentSiteDeletionPlanCanonicalV1 {
  schemaVersion: "np.agent-site-deletion-plan.v1";
  inventoryVersion: 1;
  sagaId: string;
  siteId: string;
  siteVersionDigest: string;
  preparedAt: string;
  rowInventory: Array<{
    table: string;
    count: number;
    identityDigest: string;
  }>;
  externalTargets: NpAgentSiteDeletionExternalTargetCanonicalV1[];
}

interface NpAgentVaultAadCanonicalV1 {
  schemaVersion: "np.agent-vault-aad.v1";
  siteId: string;
  connectionId: string;
  connectionKind: NpAgentConnectionKind;
  purpose: NpAgentConnectionSecretPurpose;
  secretVersionId: string;
  secretVersion: number;
  vaultAdapterId: string;
  vaultAdapterContractVersion: number;
  vaultAdapterFingerprint: string;
  credentialEnvelopeVersion: 1;
  algorithm: NpAgentVaultAlgorithm;
}
```

`rowInventory` contains every exact site-owned Agent table from the deletion
inventory except `np_agent_site_deletion_sagas`, sorted by table name. The
marker table is deliberately excluded because the prepare transaction inserts
the row only after freezing the inventory. The plan's `sagaId` is its reserved
identity; every later check separately requires exactly one marker row for the
site whose id, plan body/hash, site-version digest, and prepared time match the
plan. Each inventory identity digest covers the sorted primary ids selected
after the site-deletion admission fence; counts and digests must agree.
External targets sort by `(kind,targetId)` and are unique. An existing target
row contributes its existing request digest, adapter triple, and idempotency
key. A newly saga-owned cleanup target derives those values once before the
plan is sealed.

The row `identityDigest` has one exact streaming frame so large sites do not
place every id in the JSON body:

```text
sdri1:sha256:<base64url-no-padding>
  = SHA-256(
      utf8("np.agent-site-deletion-row-inventory.v1\0")
      || u32be(tableNameUtf8Length)
      || utf8(tableName)
      || u64be(idCount)
      || for each lexicographically sorted canonical primary-id UTF-8 value:
           u32be(idUtf8Length) || utf8(id)
    )
```

Composite primary ids first use RFC 8785 bytes of the table-owned exact key
object as the framed value. Duplicate, unsorted, malformed, cross-site, or
count-mismatched ids fail plan construction. `sdri1:*` is a nested inventory
digest, not another `cj1` registry purpose.

The plan excludes the mutable saga cursor, attempts, receipts, errors, lease,
and cleanup outcomes. The final transaction recomputes the frozen inventory
under the deletion lock, applies the exact one-marker-row check above, and
rejects an unknown or changed identity.

`@nexpress/core/agent-contract` implements the context-free plan body through
`npAnalyzeAgentSiteDeletionPlanCanonical()` and
`npRequireAgentSiteDeletionPlanCanonical()`. It rebuilds an independent exact
body, fixes `inventoryVersion` to one, validates the canonical saga/site/time
facts and exact `sdsv1`/`sdri1` digest syntax, excludes the marker table, and
requires rows by table and external targets by `(kind,targetId)` to be sorted
unique. The five target branches always carry a canonical UUID, bounded request
digest, adapter id/version/fingerprint, and idempotency key; named byte/digest
helpers enforce the 16 MiB purpose ceiling. Complete table inventory, frozen
row counts and streamed identities, target-source reparsing, site-version
recomputation, marker/body/hash equality, the deletion fence, and final
convergence remain AP-103 service and persistence checks.

The vault AAD body is byte-identical to `NpAgentVaultAadV1`; no second
credential AAD vocabulary exists.

## 3. Exhaustive purpose/body map

The R0 export is exactly:

```ts
export interface NpAgentCanonicalPurposeBodyMapV1 {
  "np.agent-action.v1": NpAgentActionCanonicalV1;
  "np.agent-approval-decision.v1": NpAgentApprovalDecisionCanonicalV1;
  "np.agent-approval-revocation.v1": NpAgentApprovalRevocationCanonicalV1;
  "np.agent-approval-statement.v1": NpAgentApprovalStatementCanonicalV1;
  "np.agent-artifact.v1": NpAgentPreviewArtifactManifestV1;
  "np.agent-authorization-context.v1": NpAgentAuthorizationContextCanonicalV1;
  "np.agent-budget-snapshot.v1": NpAgentBudgetSnapshotCanonicalV1;
  "np.agent-capability-registry.v1": NpAgentCapabilityRegistryCanonicalV1;
  "np.agent-changeset-plan.v1": NpAgentChangeSetPlanCanonicalV1;
  "np.agent-changeset-proposal.v1": NpAgentChangeSetProposalCanonicalV1;
  "np.agent-changeset-snapshot.v1": NpAgentChangeSetSnapshotCanonicalV1;
  "np.agent-connection-config.v1": NpAgentConnectionConfigCanonicalV1;
  "np.agent-connection-destination.v1": NpAgentConnectionDestinationCanonicalV1;
  "np.agent-connection-operation.v1": NpAgentConnectionOperationRequestCanonicalV1;
  "np.agent-effect-profile.v1": NpAgentEffectProfileCanonicalV1;
  "np.agent-event.v1": NpAgentEventCanonicalV1;
  "np.agent-idempotency-request.v1": NpAgentInvocationRequestCanonicalV1;
  "np.agent-mcp-task-result.v1": NpAgentMcpStoredTerminalResultV1;
  "np.agent-notification-delivery.v1": NpAgentNotificationDeliveryCanonicalV1;
  "np.agent-policy.v1": NpAgentPolicyCanonicalV1;
  "np.agent-preview-contract.v1": NpAgentPreviewContractCanonicalV1;
  "np.agent-preview-routes.v1": NpAgentPreviewRoutesCanonicalV1;
  "np.agent-provider-request.v1": NpAgentProviderRequestCanonicalV1;
  "np.agent-provider-response.v1": NpAgentProviderResponseCanonicalV1;
  "np.agent-recipe-registry.v1": NpAgentRecipeRegistryCanonicalV1;
  "np.agent-restriction.v1": NpAgentRestrictionCanonicalV1;
  "np.agent-run-admission.v1": NpAgentRunAdmissionCanonicalV1;
  "np.agent-run-limits.v1": NpAgentRunLimitsCanonicalV1;
  "np.agent-signal-evidence.v1": NpAgentSignalEvidenceCanonicalV1;
  "np.agent-site-deletion-plan.v1": NpAgentSiteDeletionPlanCanonicalV1;
  "np.agent-staff-site-authorization.v1": NpAgentStaffSiteAuthorizationCanonicalV1;
  "np.agent-vault-aad.v1": NpAgentVaultAadCanonicalV1;
}
```

The purpose registry, this map, analyzer map, included-key map, excluded-key
map, and golden-vector map must have byte-identical sorted keys.

## 4. Literal field-membership fixtures

### 4.1 Included top-level keys

These arrays are normative analyzer fixtures, not documentation shorthand.
They list every top-level key in each body. The analyzer additionally enforces
the exact nested interfaces in §2.

```ts
export const npAgentCanonicalPurposeIncludedKeysV1 = {
  "np.agent-action.v1": [
    "schemaVersion",
    "siteId",
    "actionId",
    "invocationFingerprint",
    "runFingerprint",
    "sequence",
    "capabilityId",
    "capabilityContractVersion",
    "capabilityFingerprint",
    "effectProfile",
    "risk",
    "requiredScopes",
    "targetRefs",
    "targetVersionFacts",
    "input",
  ],
  "np.agent-approval-decision.v1": [
    "schemaVersion",
    "siteId",
    "approvalId",
    "approvalGeneration",
    "statementHash",
    "decision",
    "deciderFingerprint",
    "currentHumanCapabilities",
    "reason",
    "reauthentication",
    "decidedAt",
  ],
  "np.agent-approval-revocation.v1": [
    "schemaVersion",
    "siteId",
    "approvalId",
    "approvalGeneration",
    "statementHash",
    "decisionHash",
    "revocationKind",
    "revokerFingerprint",
    "revocationCode",
    "revocationReason",
    "revokedAt",
  ],
  "np.agent-approval-statement.v1": [
    "version",
    "siteId",
    "approvalId",
    "requester",
    "target",
    "capabilityId",
    "capabilityContractVersion",
    "capabilityFingerprint",
    "requiredScopes",
    "requiredHumanCapabilities",
    "requiredHumanPredicates",
    "policyHashes",
    "requiresLivePreview",
    "previewId",
    "previewDigest",
    "risk",
    "reauthentication",
    "createdAt",
    "expiresAt",
  ],
  "np.agent-artifact.v1": [
    "schemaVersion",
    "siteId",
    "changeSetId",
    "previewId",
    "generation",
    "planHash",
    "previewContractFingerprint",
    "artifacts",
  ],
  "np.agent-authorization-context.v1": [
    "schemaVersion",
    "siteId",
    "actor",
    "transport",
    "gatewayExposure",
    "authorityRef",
  ],
  "np.agent-budget-snapshot.v1": [
    "schemaVersion",
    "siteId",
    "principalId",
    "agentId",
    "recipe",
    "capturedAt",
    "sourceRefs",
    "limits",
    "counters",
    "windows",
    "reservation",
  ],
  "np.agent-capability-registry.v1": ["schemaVersion", "projection", "capabilities"],
  "np.agent-changeset-plan.v1": ["schemaVersion", "planKind", "siteId", "changeSetId", "body"],
  "np.agent-changeset-proposal.v1": [
    "schemaVersion",
    "siteId",
    "changeSetId",
    "draftVersion",
    "title",
    "summary",
    "operations",
  ],
  "np.agent-changeset-snapshot.v1": [
    "schemaVersion",
    "siteId",
    "changeSetId",
    "operationOrdinal",
    "canonicalResourceKey",
    "presence",
    "base",
    "value",
  ],
  "np.agent-connection-config.v1": [
    "schemaVersion",
    "siteId",
    "connectionId",
    "kind",
    "provider",
    "adapterId",
    "adapterContractVersion",
    "adapterFingerprint",
    "authKind",
    "configVersion",
    "config",
    "pricingCatalog",
    "dataProcessingCeiling",
  ],
  "np.agent-connection-destination.v1": [
    "schemaVersion",
    "siteId",
    "connectionId",
    "adapterId",
    "adapterContractVersion",
    "adapterFingerprint",
    "accountSubjectKeyId",
    "accountSubjectDigest",
    "destinationDescriptor",
  ],
  "np.agent-connection-operation.v1": [
    "schemaVersion",
    "siteId",
    "operationId",
    "connectionId",
    "authority",
    "kind",
    "expectedConfigVersion",
    "expectedConfigHash",
    "configSnapshotId",
    "adapterContractVersion",
    "adapterFingerprint",
    "inputSecretVersionIds",
    "expectedSecretVersionId",
    "expectedCredentialVersion",
    "expectedRefreshGeneration",
    "idempotencyKey",
  ],
  "np.agent-effect-profile.v1": [
    "schemaVersion",
    "capabilityId",
    "capabilityContractVersion",
    "implementationVersion",
    "profileId",
    "kind",
    "reversibility",
    "minimumGatewayExposure",
    "effectContractVersion",
    "verifierId",
    "compensatorId",
  ],
  "np.agent-event.v1": [
    "version",
    "siteId",
    "kind",
    "occurredAt",
    "source",
    "subject",
    "actor",
    "causation",
    "correlationId",
    "deduplicationKey",
    "privacy",
    "payload",
  ],
  "np.agent-idempotency-request.v1": [
    "schemaVersion",
    "siteId",
    "actorKind",
    "actorFingerprint",
    "authorizationContextFingerprint",
    "operationKind",
    "operationId",
    "contractVersion",
    "contractFingerprint",
    "effectProfile",
    "input",
  ],
  "np.agent-mcp-task-result.v1": ["schemaVersion", "kind", "result", "error"],
  "np.agent-notification-delivery.v1": [
    "schemaVersion",
    "siteId",
    "notificationId",
    "channel",
    "source",
    "deduplicationKey",
    "payloadRedacted",
    "attempt",
    "adapter",
    "connection",
    "result",
    "observedAt",
  ],
  "np.agent-policy.v1": ["schemaVersion", "instructions", "rules"],
  "np.agent-preview-contract.v1": [
    "schemaVersion",
    "overlayResolverVersion",
    "rendererId",
    "rendererVersion",
    "rendererFingerprint",
    "screenshotAdapterId",
    "screenshotAdapterVersion",
    "screenshotAdapterFingerprint",
    "routeParserVersion",
    "checkRegistryVersion",
    "linkAllowlistVersion",
    "linkAllowlistOrigins",
    "networkPolicyVersion",
    "artifactLimitsVersion",
    "reportSchemaVersion",
    "responseHeaderBuilderVersion",
    "cspBuilderVersion",
  ],
  "np.agent-preview-routes.v1": [
    "schemaVersion",
    "siteId",
    "changeSetId",
    "previewId",
    "generation",
    "planHash",
    "routes",
  ],
  "np.agent-provider-request.v1": [
    "schemaVersion",
    "siteId",
    "providerCallId",
    "runId",
    "sequence",
    "retryOfId",
    "idempotencyKey",
    "connection",
    "provider",
    "model",
    "recipe",
    "task",
    "instruction",
    "trustedContext",
    "untrustedEvidence",
    "classificationManifestDigest",
    "responseSchema",
    "responseSchemaDigest",
    "responseSchemaClassification",
    "tools",
    "limits",
    "pricing",
    "dataClass",
    "dataClassCeiling",
  ],
  "np.agent-provider-response.v1": [
    "schemaVersion",
    "siteId",
    "providerCallId",
    "runId",
    "requestDigest",
    "dispatchState",
    "outcome",
    "decision",
    "observedAt",
  ],
  "np.agent-recipe-registry.v1": ["schemaVersion", "projection", "recipes"],
  "np.agent-restriction.v1": [
    "schemaVersion",
    "restrictionId",
    "siteId",
    "subject",
    "actionScopes",
    "startsAt",
    "expiresAt",
    "reasonCode",
    "targetVersionDigest",
  ],
  "np.agent-run-admission.v1": [
    "schemaVersion",
    "siteId",
    "origin",
    "principalId",
    "invocationId",
    "triggerId",
    "agent",
    "lineage",
    "recipe",
    "goal",
    "eventRef",
    "policyRefs",
    "runLimitsHash",
    "budgetSnapshotHash",
    "idempotencyKey",
    "connection",
    "admittedAt",
    "deadlineAt",
  ],
  "np.agent-run-limits.v1": [
    "schemaVersion",
    "maxAttempts",
    "maxProviderCalls",
    "maxCapabilityCalls",
    "maxInputTokens",
    "maxOutputTokens",
    "maxCostMicros",
    "maxWallClockSeconds",
  ],
  "np.agent-signal-evidence.v1": [
    "schemaVersion",
    "siteId",
    "detectorId",
    "detectorVersion",
    "category",
    "window",
    "subject",
    "evidence",
  ],
  "np.agent-site-deletion-plan.v1": [
    "schemaVersion",
    "inventoryVersion",
    "sagaId",
    "siteId",
    "siteVersionDigest",
    "preparedAt",
    "rowInventory",
    "externalTargets",
  ],
  "np.agent-staff-site-authorization.v1": [
    "schemaVersion",
    "siteId",
    "userId",
    "userTokenVersion",
    "authority",
  ],
  "np.agent-vault-aad.v1": [
    "schemaVersion",
    "siteId",
    "connectionId",
    "connectionKind",
    "purpose",
    "secretVersionId",
    "secretVersion",
    "vaultAdapterId",
    "vaultAdapterContractVersion",
    "vaultAdapterFingerprint",
    "credentialEnvelopeVersion",
    "algorithm",
  ],
} as const satisfies {
  [P in keyof NpAgentCanonicalPurposeBodyMapV1]: readonly string[];
};
```

For discriminated unions, the fixture is the union of possible top-level
keys. A branch analyzer still rejects keys from another branch:

- MCP `tool_result` requires `result` and forbids `error`; `jsonrpc_error`
  requires `error` and forbids `result`.
- Admin notification requires neither `adapter` nor `connection`; an external
  notification requires both.

### 4.2 Excluded known keys

The following lists are also fixtures. They enumerate every known
self-digest, MAC, mutable lifecycle, persistence, result, receipt, or private
field that an owner might otherwise accidentally spread into the canonical
body. Unknown keys not listed here are still rejected by the exact analyzer;
these lists are not wildcard permissions.

```ts
export const npAgentCanonicalPurposeExcludedKeysV1 = {
  "np.agent-action.v1": [
    "proposalHash",
    "inputHash",
    "resultDigest",
    "outputRedacted",
    "outputHash",
    "effectDigest",
    "targetVersionDigest",
    "verificationState",
    "verificationResultDigest",
    "verificationEvidence",
    "verifiedAt",
    "undoRef",
    "compensationResultDigest",
    "compensationEvidence",
    "compensatedAt",
    "state",
    "errorCode",
    "approvalId",
    "containmentId",
    "auditEventId",
    "startedAt",
    "finishedAt",
    "createdAt",
    "integrityKeyId",
    "integrityMac",
  ],
  "np.agent-approval-decision.v1": [
    "currentHumanCapabilitiesDigest",
    "decisionHash",
    "decisionMac",
    "integrityKeyId",
    "approvalVersion",
    "challengeGeneration",
    "challenge",
    "challengeHash",
    "challengeHashKeyId",
    "challengeSessionFingerprint",
    "challengeExpiresAt",
    "challengeConsumedAt",
    "decidedByUserId",
    "state",
  ],
  "np.agent-approval-revocation.v1": [
    "revocationHash",
    "revocationMac",
    "revocationIntegrityKeyId",
    "revokedByUserId",
    "approvalVersion",
    "challengeGeneration",
    "challenge",
    "challengeHash",
    "challengeHashKeyId",
    "state",
  ],
  "np.agent-approval-statement.v1": [
    "requiredScopesDigest",
    "requiredHumanCapabilitiesDigest",
    "requiredHumanPredicatesDigest",
    "argumentsDigest",
    "targetVersionDigest",
    "validationDigest",
    "statementHash",
    "statementMac",
    "integrityKeyId",
    "generation",
    "approvalVersion",
    "challengeGeneration",
    "challengePurpose",
    "challengeHash",
    "challengeHashKeyId",
    "state",
    "decidedAt",
    "consumedAt",
    "revokedAt",
  ],
  "np.agent-artifact.v1": [
    "digest",
    "resourceUri",
    "interactiveLaunch",
    "objectState",
    "storageKey",
    "storageAdapterId",
    "storageAdapterContractVersion",
    "storageAdapterFingerprint",
    "objectExpiresAt",
    "metadataPruneAt",
    "deleteAttempt",
    "deleteStatus",
    "deleteReceipt",
    "deleteReceiptDigest",
    "deleteErrorCode",
    "deletedAt",
    "rowVersion",
    "uploadRequestDigest",
    "uploadState",
    "uploadLeaseUntil",
    "uploadCallDeadlineAt",
  ],
  "np.agent-authorization-context.v1": [
    "authorizationContextFingerprint",
    "requestHash",
    "invocationId",
    "idempotencyKey",
    "state",
    "runId",
    "resultKind",
    "resultId",
    "outputRedacted",
    "outputHash",
    "auditEventId",
    "errorCode",
    "requestedAt",
    "completedAt",
    "expiresAt",
  ],
  "np.agent-budget-snapshot.v1": [
    "snapshotDigest",
    "budgetSnapshotHash",
    "runId",
    "runState",
    "attempt",
    "usage",
    "result",
    "errorCode",
    "leaseUntil",
    "finishedAt",
  ],
  "np.agent-capability-registry.v1": [
    "registryFingerprint",
    "capabilityFingerprint",
    "effectFingerprint",
    "registeredAt",
    "sourceFunction",
    "parseInput",
    "parseOutput",
    "deriveRequirements",
    "resolveEffectProfile",
    "execute",
    "verify",
    "deriveUndo",
    "compensate",
  ],
  "np.agent-changeset-plan.v1": [
    "planHash",
    "validationDigest",
    "title",
    "summary",
    "state",
    "preview",
    "previewDigest",
    "approval",
    "approvalId",
    "scheduledFor",
    "execution",
    "executionId",
    "executionResultDigest",
    "verification",
    "verificationDigest",
    "rollback",
    "rollbackEligibleUntil",
    "appliedAt",
    "verifiedAt",
    "rolledBackAt",
    "updatedAt",
  ],
  "np.agent-changeset-proposal.v1": [
    "draftHash",
    "planHash",
    "baseFingerprint",
    "risk",
    "validation",
    "validationDigest",
    "preview",
    "approval",
    "schedule",
    "execution",
    "verification",
    "rollback",
    "state",
    "createdAt",
    "updatedAt",
    "expiresAt",
  ],
  "np.agent-changeset-snapshot.v1": [
    "snapshotHash",
    "capturedAt",
    "beforeHash",
    "afterHash",
    "applyResult",
    "verificationResult",
    "state",
    "errorCode",
    "expiresAt",
    "deletedAt",
  ],
  "np.agent-connection-config.v1": [
    "configHash",
    "pricingCatalogFingerprint",
    "activeSecretVersionId",
    "credentialVersion",
    "accountSubjectKeyId",
    "accountSubjectDigest",
    "destinationFingerprintKeyId",
    "destinationFingerprint",
    "status",
    "lastVerifiedAt",
    "lastProbeResultDigest",
    "lastErrorCode",
    "createdAt",
    "updatedAt",
  ],
  "np.agent-connection-destination.v1": [
    "destinationHmac",
    "destinationHmacKeyId",
    "destinationFingerprint",
    "destinationFingerprintKeyId",
    "credential",
    "accessToken",
    "refreshToken",
    "apiKey",
    "providerMessageId",
  ],
  "np.agent-connection-operation.v1": [
    "requestHash",
    "source",
    "invocationId",
    "authRequestId",
    "runId",
    "state",
    "attempt",
    "resultRedacted",
    "resultDigest",
    "lastErrorCode",
    "deadlineAt",
    "leaseUntil",
    "createdByUserId",
    "createdAt",
    "startedAt",
    "finishedAt",
  ],
  "np.agent-effect-profile.v1": [
    "effectFingerprint",
    "capabilityFingerprint",
    "registeredAt",
    "sourceFunction",
    "verify",
    "deriveUndo",
    "compensate",
  ],
  "np.agent-event.v1": [
    "id",
    "eventHash",
    "recordedAt",
    "dispatchedAt",
    "expiresAt",
    "dispatchState",
    "retentionState",
  ],
  "np.agent-idempotency-request.v1": [
    "requestHash",
    "idempotencyKey",
    "transport",
    "mcpExecutionMode",
    "mcpRequestedTaskTtlMs",
    "jsonRpcId",
    "requestId",
    "taskId",
    "invocationId",
    "state",
    "runId",
    "resultKind",
    "resultId",
    "outputRedacted",
    "outputHash",
    "auditEventId",
    "errorCode",
    "requestedAt",
    "completedAt",
    "expiresAt",
  ],
  "np.agent-mcp-task-result.v1": [
    "terminalResultDigest",
    "taskId",
    "status",
    "statusMessage",
    "jsonrpc",
    "id",
    "relatedTask",
    "createdAt",
    "lastUpdatedAt",
    "expiresAt",
  ],
  "np.agent-notification-delivery.v1": [
    "deliveryResultDigest",
    "providerMessageId",
    "state",
    "attempts",
    "lastErrorCode",
    "nextAttemptAt",
    "sentAt",
    "createdAt",
    "updatedAt",
    "credential",
    "secretVersionId",
  ],
  "np.agent-policy.v1": [
    "policyHash",
    "contentHash",
    "siteId",
    "policyId",
    "agentId",
    "version",
    "status",
    "name",
    "createdBy",
    "createdAt",
    "activatedAt",
    "retiredAt",
  ],
  "np.agent-preview-contract.v1": [
    "previewContractFingerprint",
    "registeredAt",
    "rendererImplementation",
    "screenshotAdapterImplementation",
    "routeParserImplementation",
    "checkRegistryImplementation",
  ],
  "np.agent-preview-routes.v1": [
    "allowedRoutesDigest",
    "resourceUri",
    "viewerToken",
    "renderToken",
    "launchId",
    "launchGeneration",
    "createdAt",
    "expiresAt",
  ],
  "np.agent-provider-request.v1": [
    "requestHash",
    "requestDigest",
    "requestRedacted",
    "state",
    "dispatchState",
    "usageReservationId",
    "responseDigest",
    "responseRedacted",
    "decision",
    "providerRequestId",
    "errorClass",
    "retryable",
    "usage",
    "finishReason",
    "latencyMs",
    "startedAt",
    "finishedAt",
    "diagnosticExpiresAt",
    "createdAt",
  ],
  "np.agent-provider-response.v1": [
    "responseHash",
    "responseDigest",
    "responseRedacted",
    "requestRedacted",
    "usageReservationId",
    "state",
    "retryAttempt",
    "reconciledAt",
    "diagnosticExpiresAt",
    "createdAt",
    "finishedAt",
  ],
  "np.agent-recipe-registry.v1": [
    "registryFingerprint",
    "fingerprint",
    "registeredAt",
    "settingsParser",
    "manualInputParser",
    "responseParser",
    "execute",
  ],
  "np.agent-restriction.v1": [
    "restrictionHash",
    "status",
    "containmentId",
    "actionId",
    "incidentId",
    "enforcementAdapter",
    "enforcementAdapterContractVersion",
    "enforcementAdapterFingerprint",
    "enforcementRef",
    "installReceipt",
    "removalReceipt",
    "lastErrorCode",
    "rowVersion",
    "createdAt",
    "updatedAt",
    "revokedAt",
  ],
  "np.agent-run-admission.v1": [
    "admissionHash",
    "admissionFingerprint",
    "runId",
    "state",
    "attempt",
    "providerRequestId",
    "usage",
    "result",
    "errorCode",
    "errorMessage",
    "queuedAt",
    "startedAt",
    "leaseUntil",
    "finishedAt",
  ],
  "np.agent-run-limits.v1": ["limitsHash", "runLimitsHash", "resolvedAt", "sourceRefs"],
  "np.agent-signal-evidence.v1": [
    "evidenceDigest",
    "signalId",
    "severity",
    "confidenceBasis",
    "scoreBasisPoints",
    "fingerprint",
    "status",
    "incidentId",
    "createdAt",
    "updatedAt",
    "expiresAt",
  ],
  "np.agent-site-deletion-plan.v1": [
    "planHash",
    "state",
    "cursor",
    "requestedByUserId",
    "requesterFingerprint",
    "lastErrorCode",
    "leaseUntil",
    "updatedAt",
    "cleanupCompletedAt",
    "attempt",
    "result",
    "receipt",
  ],
  "np.agent-staff-site-authorization.v1": [
    "siteAuthorizationDigest",
    "sessionId",
    "sessionFingerprint",
    "issuedAt",
    "expiresAt",
    "viewerToken",
  ],
  "np.agent-vault-aad.v1": [
    "aadDigest",
    "nonce",
    "ciphertext",
    "authenticationTag",
    "wrappedDek",
    "keyId",
    "keyVersion",
    "secretRef",
    "idempotencyKey",
    "requestDigest",
    "resultDigest",
    "adapterReceipt",
    "createdAt",
    "updatedAt",
  ],
} as const satisfies {
  [P in keyof NpAgentCanonicalPurposeBodyMapV1]: readonly string[];
};
```

Security-sensitive nested exclusions are literal too:

```ts
export const npAgentCanonicalNestedExcludedKeysV1 = {
  "np.agent-artifact.v1.artifacts[]": [
    "resourceUri",
    "digest",
    "objectState",
    "storageKey",
    "storageAdapterId",
    "storageAdapterContractVersion",
    "storageAdapterFingerprint",
    "deleteReceipt",
    "deleteReceiptDigest",
    "deletedAt",
  ],
  "np.agent-notification-delivery.v1.result": ["providerMessageId", "providerResponse"],
  "np.agent-mcp-task-result.v1.error": ["jsonrpc", "id", "taskId", "relatedTask"],
  "np.agent-provider-response.v1.outcome": [
    "responseHash",
    "responseDigest",
    "reconciledAt",
    "diagnosticExpiresAt",
  ],
  "np.agent-connection-destination.v1.destinationDescriptor": [
    "credential",
    "apiKey",
    "accessToken",
    "refreshToken",
    "authorizationHeader",
    "cookie",
    "signedUrl",
  ],
  "np.agent-vault-aad.v1": [
    "plaintext",
    "nonce",
    "ciphertext",
    "authenticationTag",
    "wrappedDek",
    "secretRef",
  ],
} as const;
```

Security- and plan-sensitive nested inclusions are literal too:

```ts
export const npAgentCanonicalNestedIncludedKeysV1 = {
  "np.agent-action.v1.targetVersionFacts[]": ["targetRef", "versionDigest"],
  "np.agent-idempotency-request.v1.effectProfile": ["id", "contractVersion"],
  "np.agent-mcp-task-result.v1.error": ["code", "message", "data"],
  "np.agent-changeset-plan.v1.body.changeset.operations[]": [
    "ordinal",
    "operation",
    "canonicalResourceKey",
    "beforeHash",
    "proposedAfterHash",
    "snapshotHash",
    "rollbackClass",
    "residualCodes",
  ],
  "np.agent-changeset-plan.v1.body.rollback.operations[]": [
    "ordinal",
    "originalOperationOrdinal",
    "canonicalResourceKey",
    "originalSnapshotHash",
    "expectedCurrentHash",
    "expectedCurrentVersion",
    "compensationOperation",
    "proposedAfterHash",
    "rollbackClass",
    "residualCodes",
  ],
} as const;
```

Discriminated branch fixtures remove any ambiguity from union-key inventories:

```ts
export const npAgentCanonicalBranchIncludedKeysV1 = {
  "np.agent-approval-statement.v1.requester.principal": ["kind", "principalId", "fingerprint"],
  "np.agent-approval-statement.v1.requester.staff": ["kind", "userId", "fingerprint"],
  "np.agent-approval-statement.v1.target.changeset": ["kind", "changeSetId", "planHash"],
  "np.agent-approval-statement.v1.target.changeset_rollback": [
    "kind",
    "changeSetId",
    "rollbackPlanId",
    "planHash",
  ],
  "np.agent-approval-statement.v1.target.action": [
    "kind",
    "actionId",
    "runId",
    "agentId",
    "proposalHash",
  ],
  "np.agent-approval-statement.v1.reauthentication.none": ["mode"],
  "np.agent-approval-statement.v1.reauthentication.recent": ["mode", "maxAgeSeconds", "assurance"],
  "np.agent-artifact.v1.artifacts[].screenshot": [
    "ordinal",
    "artifactId",
    "kind",
    "route",
    "locale",
    "viewport",
    "reportPart",
    "reportTotalParts",
    "contentDigest",
    "mime",
    "bytes",
    "createdAt",
    "expiresAt",
  ],
  "np.agent-artifact.v1.artifacts[].report": [
    "ordinal",
    "artifactId",
    "kind",
    "route",
    "locale",
    "viewport",
    "reportPart",
    "reportTotalParts",
    "contentDigest",
    "mime",
    "bytes",
    "createdAt",
    "expiresAt",
  ],
  "np.agent-authorization-context.v1.actor.principal": ["kind", "principalId", "actorFingerprint"],
  "np.agent-authorization-context.v1.actor.staff": ["kind", "userId", "actorFingerprint"],
  "np.agent-authorization-context.v1.authorityRef.staff-session": [
    "kind",
    "userId",
    "sessionId",
    "userTokenVersion",
    "siteAuthorizationDigest",
  ],
  "np.agent-authorization-context.v1.authorityRef.service-family": [
    "kind",
    "principalId",
    "rotationFamilyId",
    "familyAuthorityVersion",
    "principalTokenVersion",
    "exposureMode",
    "audience",
  ],
  "np.agent-authorization-context.v1.authorityRef.oauth-grant": [
    "kind",
    "principalId",
    "clientId",
    "grantId",
    "grantVersion",
    "principalTokenVersion",
    "exposureMode",
    "audience",
  ],
  "np.agent-authorization-context.v1.authorityRef.runtime-run": [
    "kind",
    "principalId",
    "runId",
    "agentVersionId",
    "deadlineAt",
  ],
  "np.agent-idempotency-request.v1.operation.capability": [
    "schemaVersion",
    "siteId",
    "actorKind",
    "actorFingerprint",
    "authorizationContextFingerprint",
    "operationKind",
    "operationId",
    "contractVersion",
    "contractFingerprint",
    "effectProfile",
    "input",
  ],
  "np.agent-idempotency-request.v1.operation.admin": [
    "schemaVersion",
    "siteId",
    "actorKind",
    "actorFingerprint",
    "authorizationContextFingerprint",
    "operationKind",
    "operationId",
    "contractVersion",
    "contractFingerprint",
    "effectProfile",
    "input",
  ],
  "np.agent-capability-registry.v1.projection.definition": [
    "schemaVersion",
    "projection",
    "capabilities",
  ],
  "np.agent-capability-registry.v1.projection.registry": [
    "schemaVersion",
    "projection",
    "capabilities",
  ],
  "np.agent-changeset-plan.v1.body.changeset": [
    "draftVersion",
    "draftHash",
    "validationGeneration",
    "baseFingerprint",
    "operations",
    "risk",
    "requiredScopes",
    "requiredHumanCapabilities",
    "requiredHumanPredicates",
    "policyHashes",
    "expiresAt",
    "rollbackWindowSeconds",
  ],
  "np.agent-changeset-plan.v1.body.rollback": [
    "rollbackPlanId",
    "generation",
    "compensatesExecutionId",
    "originalPlanHash",
    "appliedResultDigest",
    "baseFingerprint",
    "operations",
    "risk",
    "requiredScopes",
    "requiredHumanCapabilities",
    "requiredHumanPredicates",
    "policyHashes",
    "expiresAt",
  ],
  "np.agent-connection-operation.v1.authority.admin-invocation": ["kind", "invocationId"],
  "np.agent-connection-operation.v1.authority.oauth-setup": ["kind", "authRequestId"],
  "np.agent-connection-operation.v1.authority.runtime-refresh": ["kind", "runId"],
  "np.agent-mcp-task-result.v1.tool_result": ["schemaVersion", "kind", "result"],
  "np.agent-mcp-task-result.v1.jsonrpc_error": ["schemaVersion", "kind", "error"],
  "np.agent-notification-delivery.v1.admin": [
    "schemaVersion",
    "siteId",
    "notificationId",
    "channel",
    "source",
    "deduplicationKey",
    "payloadRedacted",
    "attempt",
    "result",
    "observedAt",
  ],
  "np.agent-notification-delivery.v1.external": [
    "schemaVersion",
    "siteId",
    "notificationId",
    "channel",
    "source",
    "deduplicationKey",
    "payloadRedacted",
    "attempt",
    "adapter",
    "connection",
    "result",
    "observedAt",
  ],
  "np.agent-recipe-registry.v1.projection.definition": ["schemaVersion", "projection", "recipes"],
  "np.agent-recipe-registry.v1.projection.registry": ["schemaVersion", "projection", "recipes"],
  "np.agent-restriction.v1.subject.authenticated_principal": [
    "kind",
    "principalKind",
    "principalId",
  ],
  "np.agent-restriction.v1.subject.opaque_actor_bucket": [
    "kind",
    "purpose",
    "projectionVersion",
    "projectionFingerprint",
    "keyId",
    "bucket",
  ],
  "np.agent-staff-site-authorization.v1.authority.super-admin": ["kind", "capabilities"],
  "np.agent-staff-site-authorization.v1.authority.site-role": [
    "kind",
    "source",
    "role",
    "capabilities",
  ],
} as const;
```

The golden registry describes how branch coverage is derived from an analyzed
body; a vector cannot self-report coverage. JSON pointer patterns use RFC 6901
segments plus `*` only as one array-item segment. A pointer without `*` must
resolve to exactly one string. A wildcard pointer matches each analyzed array
item, and a case is covered when at least one resolved string is in its exact
sorted, unique `acceptedValues`. The `caseId` also selects the branch-key
fixture above.

```ts
interface NpAgentCanonicalDiscriminatorCaseV1 {
  caseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  selector: {
    jsonPointerPattern: `/${string}`;
    acceptedValues: readonly [string, ...string[]];
  };
}

export const npAgentCanonicalDiscriminatorCasesV1: Partial<
  Record<keyof NpAgentCanonicalPurposeBodyMapV1, readonly NpAgentCanonicalDiscriminatorCaseV1[]>
> = {
  "np.agent-approval-statement.v1": [
    {
      caseId: "np.agent-approval-statement.v1.requester.principal",
      selector: { jsonPointerPattern: "/requester/kind", acceptedValues: ["principal"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.requester.staff",
      selector: { jsonPointerPattern: "/requester/kind", acceptedValues: ["staff"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.target.changeset",
      selector: { jsonPointerPattern: "/target/kind", acceptedValues: ["changeset"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.target.changeset_rollback",
      selector: { jsonPointerPattern: "/target/kind", acceptedValues: ["changeset_rollback"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.target.action",
      selector: { jsonPointerPattern: "/target/kind", acceptedValues: ["action"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.reauthentication.none",
      selector: { jsonPointerPattern: "/reauthentication/mode", acceptedValues: ["none"] },
    },
    {
      caseId: "np.agent-approval-statement.v1.reauthentication.recent",
      selector: { jsonPointerPattern: "/reauthentication/mode", acceptedValues: ["recent"] },
    },
  ],
  "np.agent-artifact.v1": [
    {
      caseId: "np.agent-artifact.v1.artifacts[].screenshot",
      selector: { jsonPointerPattern: "/artifacts/*/kind", acceptedValues: ["screenshot"] },
    },
    {
      caseId: "np.agent-artifact.v1.artifacts[].report",
      selector: { jsonPointerPattern: "/artifacts/*/kind", acceptedValues: ["report"] },
    },
  ],
  "np.agent-authorization-context.v1": [
    {
      caseId: "np.agent-authorization-context.v1.actor.principal",
      selector: { jsonPointerPattern: "/actor/kind", acceptedValues: ["principal"] },
    },
    {
      caseId: "np.agent-authorization-context.v1.actor.staff",
      selector: { jsonPointerPattern: "/actor/kind", acceptedValues: ["staff"] },
    },
    {
      caseId: "np.agent-authorization-context.v1.authorityRef.staff-session",
      selector: { jsonPointerPattern: "/authorityRef/kind", acceptedValues: ["staff-session"] },
    },
    {
      caseId: "np.agent-authorization-context.v1.authorityRef.service-family",
      selector: { jsonPointerPattern: "/authorityRef/kind", acceptedValues: ["service-family"] },
    },
    {
      caseId: "np.agent-authorization-context.v1.authorityRef.oauth-grant",
      selector: { jsonPointerPattern: "/authorityRef/kind", acceptedValues: ["oauth-grant"] },
    },
    {
      caseId: "np.agent-authorization-context.v1.authorityRef.runtime-run",
      selector: { jsonPointerPattern: "/authorityRef/kind", acceptedValues: ["runtime-run"] },
    },
  ],
  "np.agent-idempotency-request.v1": [
    {
      caseId: "np.agent-idempotency-request.v1.operation.capability",
      selector: { jsonPointerPattern: "/operationKind", acceptedValues: ["capability"] },
    },
    {
      caseId: "np.agent-idempotency-request.v1.operation.admin",
      selector: { jsonPointerPattern: "/operationKind", acceptedValues: ["admin"] },
    },
  ],
  "np.agent-capability-registry.v1": [
    {
      caseId: "np.agent-capability-registry.v1.projection.definition",
      selector: { jsonPointerPattern: "/projection", acceptedValues: ["definition"] },
    },
    {
      caseId: "np.agent-capability-registry.v1.projection.registry",
      selector: { jsonPointerPattern: "/projection", acceptedValues: ["registry"] },
    },
  ],
  "np.agent-changeset-plan.v1": [
    {
      caseId: "np.agent-changeset-plan.v1.body.changeset",
      selector: { jsonPointerPattern: "/planKind", acceptedValues: ["changeset"] },
    },
    {
      caseId: "np.agent-changeset-plan.v1.body.rollback",
      selector: { jsonPointerPattern: "/planKind", acceptedValues: ["rollback"] },
    },
  ],
  "np.agent-connection-operation.v1": [
    {
      caseId: "np.agent-connection-operation.v1.authority.admin-invocation",
      selector: { jsonPointerPattern: "/authority/kind", acceptedValues: ["admin-invocation"] },
    },
    {
      caseId: "np.agent-connection-operation.v1.authority.oauth-setup",
      selector: { jsonPointerPattern: "/authority/kind", acceptedValues: ["oauth-setup"] },
    },
    {
      caseId: "np.agent-connection-operation.v1.authority.runtime-refresh",
      selector: { jsonPointerPattern: "/authority/kind", acceptedValues: ["runtime-refresh"] },
    },
  ],
  "np.agent-mcp-task-result.v1": [
    {
      caseId: "np.agent-mcp-task-result.v1.tool_result",
      selector: { jsonPointerPattern: "/kind", acceptedValues: ["tool_result"] },
    },
    {
      caseId: "np.agent-mcp-task-result.v1.jsonrpc_error",
      selector: { jsonPointerPattern: "/kind", acceptedValues: ["jsonrpc_error"] },
    },
  ],
  "np.agent-notification-delivery.v1": [
    {
      caseId: "np.agent-notification-delivery.v1.admin",
      selector: { jsonPointerPattern: "/channel", acceptedValues: ["admin"] },
    },
    {
      caseId: "np.agent-notification-delivery.v1.external",
      selector: {
        jsonPointerPattern: "/channel",
        acceptedValues: ["email", "siem", "slack", "webhook"],
      },
    },
  ],
  "np.agent-recipe-registry.v1": [
    {
      caseId: "np.agent-recipe-registry.v1.projection.definition",
      selector: { jsonPointerPattern: "/projection", acceptedValues: ["definition"] },
    },
    {
      caseId: "np.agent-recipe-registry.v1.projection.registry",
      selector: { jsonPointerPattern: "/projection", acceptedValues: ["registry"] },
    },
  ],
  "np.agent-restriction.v1": [
    {
      caseId: "np.agent-restriction.v1.subject.authenticated_principal",
      selector: {
        jsonPointerPattern: "/subject/kind",
        acceptedValues: ["authenticated_principal"],
      },
    },
    {
      caseId: "np.agent-restriction.v1.subject.opaque_actor_bucket",
      selector: { jsonPointerPattern: "/subject/kind", acceptedValues: ["opaque_actor_bucket"] },
    },
  ],
  "np.agent-staff-site-authorization.v1": [
    {
      caseId: "np.agent-staff-site-authorization.v1.authority.super-admin",
      selector: { jsonPointerPattern: "/authority/kind", acceptedValues: ["super-admin"] },
    },
    {
      caseId: "np.agent-staff-site-authorization.v1.authority.site-role",
      selector: { jsonPointerPattern: "/authority/kind", acceptedValues: ["site-role"] },
    },
  ],
} as const;

type NpAgentCanonicalRegistryProjectionPurposeV1 =
  "np.agent-capability-registry.v1" | "np.agent-recipe-registry.v1";

interface NpAgentCanonicalContextualSiblingPairV1 {
  sourceCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  siblingCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  verification: "registry-completeness";
}

export const npAgentCanonicalContextualSiblingPairsV1: {
  [P in NpAgentCanonicalRegistryProjectionPurposeV1]: readonly [
    NpAgentCanonicalContextualSiblingPairV1,
    NpAgentCanonicalContextualSiblingPairV1,
  ];
} = {
  "np.agent-capability-registry.v1": [
    {
      sourceCaseId: "np.agent-capability-registry.v1.projection.definition",
      siblingCaseId: "np.agent-capability-registry.v1.projection.registry",
      verification: "registry-completeness",
    },
    {
      sourceCaseId: "np.agent-capability-registry.v1.projection.registry",
      siblingCaseId: "np.agent-capability-registry.v1.projection.definition",
      verification: "registry-completeness",
    },
  ],
  "np.agent-recipe-registry.v1": [
    {
      sourceCaseId: "np.agent-recipe-registry.v1.projection.definition",
      siblingCaseId: "np.agent-recipe-registry.v1.projection.registry",
      verification: "registry-completeness",
    },
    {
      sourceCaseId: "np.agent-recipe-registry.v1.projection.registry",
      siblingCaseId: "np.agent-recipe-registry.v1.projection.definition",
      verification: "registry-completeness",
    },
  ],
} as const;
```

The adapter-owned destination descriptor schema may have other declared
business keys, but it must explicitly reject each credential-bearing key
above in addition to its own `additionalProperties:false` rule. The provider
outcome, event payload, ChangeSet operation, policy rules, JSON Schema, target,
subject, authority, and recipe unions use their already exhaustive nested
field fixtures; AP-000 imports those fixtures rather than maintaining
lookalike lists here.

## 5. Purpose, algorithm, and owner mapping

Every row has one closed semantic owner family; a purpose with an explicit
`projection` discriminator may own the named definition and complete-registry
outputs listed in that same row and no others. “Registry snapshot” means a
code-owned validated wire/runtime snapshot, not a database table. Milestone
notes identify the first schema slice that persists the already-locked R0
contract; they prevent an implementation from silently reusing a semantically
different digest column.

| Exact purpose                          | Algorithm owner                     | Owning persisted/wire field                                                                                                                                        |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `np.agent-action.v1`                   | SHA-256                             | `np_agent_actions.input_hash` over retained canonical input/scopes/targets plus frozen columns; direct-action `proposalHash` is identical                          |
| `np.agent-approval-decision.v1`        | SHA-256 and approval-integrity HMAC | retained `np_agent_approvals.decision_body`, `decision_hash`, and `decision_mac`; `integrity_key_id` selects the MAC key                                           |
| `np.agent-approval-revocation.v1`      | SHA-256 and approval-integrity HMAC | retained `np_agent_approvals.revocation_body`, `revocation_hash`, and `revocation_mac`; `revocation_integrity_key_id` selects the MAC key                          |
| `np.agent-approval-statement.v1`       | SHA-256 and approval-integrity HMAC | retained `np_agent_approvals.statement_body`, `statement_hash`, and `statement_mac`; `integrity_key_id` selects the MAC key                                        |
| `np.agent-artifact.v1`                 | SHA-256                             | `np_agent_changeset_previews.digest`; `NpAgentPreviewSummary.digest`                                                                                               |
| `np.agent-authorization-context.v1`    | SHA-256                             | invocation retained authorization-context body/fingerprint; byte-equal body copy on validation, preview, rollback-plan, and MCP-task rows                          |
| `np.agent-budget-snapshot.v1`          | SHA-256                             | `np_agent_runs.budget_snapshot_hash` over `budget_snapshot`                                                                                                        |
| `np.agent-capability-registry.v1`      | SHA-256                             | definition body retained on invocation/action; current complete registry projection owns discovery/Doctor `registryFingerprint`                                    |
| `np.agent-changeset-plan.v1`           | SHA-256                             | `np_agent_changesets.plan_hash` and `np_agent_changeset_rollback_plans.plan_hash` over their retained discriminated `sealed_plan_body`                             |
| `np.agent-changeset-proposal.v1`       | SHA-256                             | `np_agent_changesets.draft_hash`                                                                                                                                   |
| `np.agent-changeset-snapshot.v1`       | SHA-256                             | `np_agent_changeset_operations.snapshot_hash` in R3/AP-301; rollback operation copies it                                                                           |
| `np.agent-connection-config.v1`        | SHA-256                             | `np_agent_connection_config_versions.config_hash` and the checked active connection projection                                                                     |
| `np.agent-connection-destination.v1`   | dedicated destination-keyring HMAC  | retained active-connection/notification destination descriptors plus frozen account/adapter tuple reconstruct the body; fingerprint and key-id columns own the MAC |
| `np.agent-connection-operation.v1`     | SHA-256                             | `np_agent_connection_operations.request_hash`                                                                                                                      |
| `np.agent-effect-profile.v1`           | SHA-256                             | effect body inside retained capability definition/current registry owns `effectFingerprint`; enclosing capability fingerprint binds it                             |
| `np.agent-event.v1`                    | SHA-256                             | `np_agent_events.event_hash`                                                                                                                                       |
| `np.agent-idempotency-request.v1`      | SHA-256                             | `np_agent_invocations.request_hash` over retained non-secret `request_body`                                                                                        |
| `np.agent-mcp-task-result.v1`          | SHA-256                             | `np_agent_mcp_tasks.terminal_result_digest` over `terminal_result`                                                                                                 |
| `np.agent-notification-delivery.v1`    | SHA-256                             | `np_agent_notifications.delivery_result_digest` over retained safe `delivery_digest_body`                                                                          |
| `np.agent-policy.v1`                   | SHA-256                             | `np_agent_policies.content_hash`; `policyHash` is the wire/runtime name                                                                                            |
| `np.agent-preview-contract.v1`         | SHA-256                             | preview retained `preview_contract_body`/fingerprint; byte-equal fingerprint repeated on render session/artifact metadata                                          |
| `np.agent-preview-routes.v1`           | SHA-256                             | preview/render/viewer `allowed_routes_digest`; `allowedRoutesDigest` in token claims                                                                               |
| `np.agent-provider-request.v1`         | SHA-256                             | `np_agent_provider_calls.request_digest`                                                                                                                           |
| `np.agent-provider-response.v1`        | SHA-256                             | `np_agent_provider_calls.response_digest`                                                                                                                          |
| `np.agent-recipe-registry.v1`          | SHA-256                             | retained version `recipe_registry_body` owns registry fingerprint and every contained definition `fingerprint`; current registry owns live discovery               |
| `np.agent-restriction.v1`              | SHA-256                             | `np_agent_actor_restrictions.restriction_hash` in R7/AP-701; adapter requests recompute it                                                                         |
| `np.agent-run-admission.v1`            | SHA-256                             | `np_agent_runs.admission_fingerprint`                                                                                                                              |
| `np.agent-run-limits.v1`               | SHA-256                             | `np_agent_runs.run_limits_hash` over `run_limits`                                                                                                                  |
| `np.agent-signal-evidence.v1`          | SHA-256                             | `np_agent_signals.evidence_digest` in R6/AP-600; it accompanies exact `evidence`                                                                                   |
| `np.agent-site-deletion-plan.v1`       | SHA-256                             | retained `np_agent_site_deletion_sagas.plan_body`/`plan_hash`; body repeats the exact `sdsv1` site-version digest                                                  |
| `np.agent-staff-site-authorization.v1` | SHA-256                             | viewer-launch retained `site_authorization_body`/digest; `siteAuthorizationDigest` in that launch's viewer claim                                                   |
| `np.agent-vault-aad.v1`                | SHA-256                             | `np_agent_connection_secret_versions.aad_digest`, `np_agent_vault_entries.aad_digest`, and exact adapter sealed-value projection                                   |

No owner may use another row's digest merely because both happen to be
SHA-256. In particular:

- `before_hash` is a resource-state digest, not a ChangeSet snapshot digest;
- `target_version_digest` is a protected-resource version, not a restriction
  digest;
- `capability_fingerprint` is the enclosing definition digest, not an effect
  profile digest;
- `classification_manifest_digest` is provider-input evidence, not the whole
  provider request digest; and
- raw artifact `ac1:*`, upload request `aur1:*`, upload set `aus1:*`, upload
  operation receipt `auo1:*`, delete receipt `adr1:*`, and nested deletion-row
  inventory `sdri1:*` digests do not use this purpose registry; and
- model-pricing rule `pr1:*` and complete-catalog `pc1:*` digests use the
  exact framed raw digest builders in the data-model contract, not a
  caller/adapter fingerprint or this purpose registry; and
- site-deletion site-version `sdsv1:*` uses the exact canonical `np_sites`
  snapshot builder in the data-model contract and is repeated inside the
  retained deletion plan.

## 6. Ordering, null, and omission matrix

The following table is executable acceptance criteria for each context-free
exact body analyzer. The two cells explicitly labeled “domain builder” add a
second contextual assertion after body analysis; they are not claims that a
generic analyzer can inspect the installed code registry. “Sorted” always
means ascending Unicode code-point comparison of the stated tuple after each
element has passed its exact analyzer; no locale collation is allowed.

| Purpose                                | Array ordering/uniqueness                                                                            | Required null/omission rule                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `np.agent-action.v1`                   | scopes sorted unique; targets/facts same-length and same RFC 8785 target order                       | `runFingerprint` null only inline; every target fact has a non-empty owner version digest                                                         |
| `np.agent-approval-decision.v1`        | current human capabilities sorted unique                                                             | reject requires reauth `none`; approve mode/assurance/max-age equal statement and adds actual fact/time; reason is explicit string or null        |
| `np.agent-approval-revocation.v1`      | none                                                                                                 | prior `decisionHash` may be null; non-human reason must be null                                                                                   |
| `np.agent-approval-statement.v1`       | scopes, capabilities, predicates, and policy hashes sorted unique                                    | preview id/digest are both non-null iff live preview is required; action run/agent ids may independently be null as frozen                        |
| `np.agent-artifact.v1`                 | artifacts by unique positive ordinal; report parts contiguous                                        | screenshot locator/viewport non-null and report parts null; report locator/viewport null and both part fields non-null                            |
| `np.agent-authorization-context.v1`    | no arrays                                                                                            | actor id/branch, transport, audience, and exposure follow the exact staff/service/OAuth/Runtime matrix; staff/Runtime exposure is null            |
| `np.agent-budget-snapshot.v1`          | source refs by `(kind,id-or-empty,version,digest)` unique                                            | Agent/recipe both null for Gateway; recipe may be non-null with Agent only                                                                        |
| `np.agent-capability-registry.v1`      | capabilities by id; effects by profile id; descriptor sets sorted unique                             | analyzer: definition exactly one, registry non-empty, effect matrix exact; domain builder: registry equals complete installed set                 |
| `np.agent-changeset-plan.v1`           | branch operations by unique ordinal; rollback original ordinals unique; all set arrays sorted unique | `planKind` selects the exact body; initial owns a sealed duration and no rollback ids; rollback owns compensation ids/absolute expiry             |
| `np.agent-changeset-proposal.v1`       | operations by unique positive ordinal                                                                | summary explicitly null when absent                                                                                                               |
| `np.agent-changeset-snapshot.v1`       | none                                                                                                 | absent requires base/value null; present requires both non-null                                                                                   |
| `np.agent-connection-config.v1`        | pricing catalog by `(modelId,effectiveFrom,pricingId,version)` unique                                | pricing `effectiveUntil` may be null; no active secret/account/destination fields                                                                 |
| `np.agent-connection-destination.v1`   | descriptor-owned arrays use adapter schema ordering                                                  | no nullable top-level field; descriptor cannot contain a secret                                                                                   |
| `np.agent-connection-operation.v1`     | secret ids unique in semantic-purpose order                                                          | expected secret/version pair; refresh generation only refresh; mutable deadline is excluded                                                       |
| `np.agent-effect-profile.v1`           | none                                                                                                 | read has both ids null; mutation verifier required; compensator only compensatable; Gateway mutation exposure is null or at least `propose`       |
| `np.agent-event.v1`                    | payload branch owns ordering                                                                         | subject, actor, causation, correlation, and dedup key are explicit null when absent; kind equals payload kind                                     |
| `np.agent-idempotency-request.v1`      | frozen operation analyzer normalizes input; canonical JSON preserves array order                     | capability requires a closed capability id plus effect profile; Admin requires a closed route-operation id plus null                              |
| `np.agent-mcp-task-result.v1`          | underlying validated MCP result owns ordering                                                        | exactly one of result/error; error `data` may be omitted and must not be synthesized                                                              |
| `np.agent-notification-delivery.v1`    | payload analyzer owns ordering                                                                       | at least one source id; Admin omits adapter/connection; external requires both; provider receipt absent from body                                 |
| `np.agent-policy.v1`                   | every policy set follows `NpAgentPolicyRulesV1`; quiet hours use normalized start/end order          | no null outer member; site/agent association is not content-hash input                                                                            |
| `np.agent-preview-contract.v1`         | allowlist origins sorted unique                                                                      | screenshot adapter triple all null or all non-null                                                                                                |
| `np.agent-preview-routes.v1`           | routes by `(route,locale-or-empty,audience)` unique                                                  | locale is explicit string or null                                                                                                                 |
| `np.agent-provider-request.v1`         | trusted context, evidence, and tools use their exact tuples; schemas canonicalized                   | `retryOfId` explicit null for first call; no nullable instruction for a provider call                                                             |
| `np.agent-provider-response.v1`        | outcome/decision analyzers own nested ordering                                                       | decision non-null only successful parsed output; dispatch state agrees with outcome                                                               |
| `np.agent-recipe-registry.v1`          | recipes by `(id,version)`; definition sets sorted unique                                             | analyzer: definition exactly one, registry non-empty, null matrix exact; domain builder: registry equals complete installed set                   |
| `np.agent-restriction.v1`              | action scopes sorted unique non-empty                                                                | exactly one subject union branch; no receipt/lifecycle fields                                                                                     |
| `np.agent-run-admission.v1`            | policy refs by `(kind,id-or-empty,version,digest)` unique                                            | Gateway null Agent/trigger/recipe/connection; Runtime has Agent/recipe; deterministic Runtime may have null connection; instruction triple paired |
| `np.agent-run-limits.v1`               | none                                                                                                 | no null member; every value is concrete                                                                                                           |
| `np.agent-signal-evidence.v1`          | evidence by `(observedAt,kind,canonical-source-id,digest)` unique and non-empty                      | subject explicit null when absent                                                                                                                 |
| `np.agent-site-deletion-plan.v1`       | rows by table; targets by `(kind,targetId)`; both unique                                             | no cursor/result/receipt; target adapter triple/key/digest always present                                                                         |
| `np.agent-staff-site-authorization.v1` | capabilities sorted unique                                                                           | exact super-admin or site-role branch; only site-role has source/role                                                                             |
| `np.agent-vault-aad.v1`                | none                                                                                                 | no null or optional member                                                                                                                        |

RFC 8785 sorts object keys after these semantic array transformations. An
implementation must not sort an order-sensitive ChangeSet operation list,
report-part list, or connection secret-purpose list by serialized bytes.

## 7. Canonical-byte size ceilings

The analyzer measures RFC 8785 UTF-8 bytes before adding the domain prefix.
These are hard v1 maxima; the owning domain may impose a lower limit on a
particular branch.

```ts
export const npAgentCanonicalBodyMaxBytesV1 = {
  "np.agent-action.v1": 4 * 1024 * 1024,
  "np.agent-approval-decision.v1": 64 * 1024,
  "np.agent-approval-revocation.v1": 64 * 1024,
  "np.agent-approval-statement.v1": 256 * 1024,
  "np.agent-artifact.v1": 256 * 1024,
  "np.agent-authorization-context.v1": 64 * 1024,
  "np.agent-budget-snapshot.v1": 256 * 1024,
  "np.agent-capability-registry.v1": 16 * 1024 * 1024,
  "np.agent-changeset-plan.v1": 4 * 1024 * 1024,
  "np.agent-changeset-proposal.v1": 4 * 1024 * 1024,
  "np.agent-changeset-snapshot.v1": 256 * 1024,
  "np.agent-connection-config.v1": 512 * 1024,
  "np.agent-connection-destination.v1": 32 * 1024,
  "np.agent-connection-operation.v1": 64 * 1024,
  "np.agent-effect-profile.v1": 16 * 1024,
  "np.agent-event.v1": 16 * 1024,
  "np.agent-idempotency-request.v1": 4 * 1024 * 1024,
  "np.agent-mcp-task-result.v1": 4 * 1024 * 1024,
  "np.agent-notification-delivery.v1": 256 * 1024,
  "np.agent-policy.v1": 1024 * 1024,
  "np.agent-preview-contract.v1": 64 * 1024,
  "np.agent-preview-routes.v1": 256 * 1024,
  "np.agent-provider-request.v1": 4 * 1024 * 1024,
  "np.agent-provider-response.v1": 4 * 1024 * 1024,
  "np.agent-recipe-registry.v1": 8 * 1024 * 1024,
  "np.agent-restriction.v1": 64 * 1024,
  "np.agent-run-admission.v1": 512 * 1024,
  "np.agent-run-limits.v1": 16 * 1024,
  "np.agent-signal-evidence.v1": 512 * 1024,
  "np.agent-site-deletion-plan.v1": 16 * 1024 * 1024,
  "np.agent-staff-site-authorization.v1": 64 * 1024,
  "np.agent-vault-aad.v1": 16 * 1024,
} as const satisfies {
  [P in keyof NpAgentCanonicalPurposeBodyMapV1]: number;
};
```

The 4 MiB ChangeSet plan ceiling remains the authoritative plan limit.
Individual snapshots still cap at 256 KiB and aggregate inline snapshots at
2 MiB. Event payload and preview/notification/provider component limits are
checked before the outer byte ceiling, so the larger outer bound does not
weaken those domain limits.

## 8. Required builder and analyzer surface

Implementation status (2026-08-26): the purpose/body, analyzer,
included-field, excluded-field, and size registries are byte-equal exhaustive
over all 32 v1 purposes. The shared dispatch reparses the selected exact body
before producing canonical bytes or a SHA digest; the destination purpose is
excluded from that SHA surface and continues to use its dedicated
connection-destination HMAC builder and verifier. Capability-, adapter-,
collection-, setting-, and recipe-specific JSON remains subject to its named
domain builder as described below.

R0 exports only typed purpose selection:

```ts
export type NpAgentCanonicalPurposeV1 = keyof NpAgentCanonicalPurposeBodyMapV1;
export type NpAgentCanonicalShaPurposeV1 = Exclude<
  NpAgentCanonicalPurposeV1,
  "np.agent-connection-destination.v1"
>;

export interface NpAgentCanonicalBytesV1<P extends NpAgentCanonicalPurposeV1> {
  purpose: P;
  body: NpAgentCanonicalPurposeBodyMapV1[P];
  canonicalJsonUtf8: Uint8Array;
  domainSeparatedUtf8: Uint8Array;
}

export function npAnalyzeAgentCanonicalBodyV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): NpAgentCanonicalPurposeBodyMapV1[P];

export function npBuildAgentCanonicalBytesV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  body: NpAgentCanonicalPurposeBodyMapV1[P],
): NpAgentCanonicalBytesV1<P>;

export function npDigestAgentCanonicalBodyV1<P extends NpAgentCanonicalShaPurposeV1>(
  purpose: P,
  body: NpAgentCanonicalPurposeBodyMapV1[P],
): `cj1:sha256:${string}`;

export function npMacAgentCanonicalBodyV1<P extends keyof typeof npAgentCanonicalHmacOwnersV1>(
  purpose: P,
  body: NpAgentCanonicalPurposeBodyMapV1[P],
  key: {
    owner: (typeof npAgentCanonicalHmacOwnersV1)[P];
    id: string;
    bytes: Uint8Array;
  },
): `cj1:hmac-sha256:${string}:${string}`;
```

The generic HMAC helper is server-only. Its call-site allowlist has exactly
four purpose/keyring pairs:

```ts
export const npAgentCanonicalHmacOwnersV1 = {
  "np.agent-approval-statement.v1": "approval-integrity",
  "np.agent-approval-decision.v1": "approval-integrity",
  "np.agent-approval-revocation.v1": "approval-integrity",
  "np.agent-connection-destination.v1": "connection-destination",
} as const;
```

All other purposes use SHA-256 only. Passing a purpose/keyring pair outside
this map is a type error and a runtime contract error. Key ids are output
prefix/owner-column metadata and never enter their own body.
Conversely, `np.agent-connection-destination.v1` is excluded from
`NpAgentCanonicalShaPurposeV1`; attempting to pass it to the bare SHA helper is
both a compile-time and runtime contract error.

Each domain exports a named body builder that accepts authoritative domain
records, reparses dynamic JSON, and returns the corresponding exact type.
Callers do not assemble body-shaped object literals at digest sites. At
minimum, lint/AST enforcement forbids direct calls to the generic digest/MAC
helpers outside those named builder modules.

## 9. Naming resolutions and migration requirements

AP-000 resolves the existing document vocabulary as follows:

1. `NpAgentApprovalStatementCanonicalV1` is the digest/MAC body.
   `NpAgentApprovalStatementV1` must become a type alias or byte-identical
   public projection; it cannot retain the older missing
   `requiresLivePreview`/`previewId` shape.
2. `np_agent_actions.input_hash` and direct-action `proposalHash` are the same
   `np.agent-action.v1` digest. A separate `proposal_hash` column is not
   created.
3. `np_agent_policies.content_hash` and runtime/wire `policyHash` are the same
   `np.agent-policy.v1` digest.
4. `active_destination_fingerprint` and notification
   `destination_fingerprint` carry the
   `np.agent-connection-destination.v1` HMAC. Their paired key-id columns are
   mandatory, and the exact safe descriptor plus frozen account/adapter tuple
   remain the reconstruction authority for as long as either MAC owner exists.
5. `NpAgentRestrictionCanonicalV1` is byte-identical to the adapter's
   `NpAgentRestrictionDescriptorV1`. The implementation aliases those names
   rather than maintaining duplicate interfaces.
6. `NpAgentVaultAadCanonicalV1` is byte-identical to `NpAgentVaultAadV1`.
7. `NpAgentRunLimitsCanonicalV1` is byte-identical to
   `NpAgentRunLimitsV1`.
8. The provider request digest uses the complete server-owned wrapper in this
   appendix. The provider adapter still receives its documented logical
   subset; the adapter may not choose site/call/credential/classification
   bindings.
9. Connection-operation `deadline_at` is state-dependent lifecycle metadata
   and is excluded from the immutable request digest.
10. R0 locks all three bodies; R3/AP-301 persists the discriminated sealed
    initial/rollback plan bodies, frozen rollback duration, and ChangeSet
    `snapshot_hash`; R6/AP-600 persists signal `evidence_digest`; and
    R7/AP-701 persists restriction `restriction_hash`. These fields use their
    dedicated purposes and cannot alias `before_hash`,
    `target_version_digest`, or an evidence-ref digest.
11. Current capability/effect/recipe registries are validated code-owned
    snapshots and need no mutable global table. An admitted capability
    invocation/action retains its one-definition body, and each Agent version
    retains its complete recipe-registry body, so historical fingerprints do
    not depend on newer deployed code.

Any later change to one of these resolutions requires a new purpose/body
version and migration. Renaming only a storage column does not change bytes;
changing an included body key does.

## 10. Golden-vector and conformance requirements

`@nexpress/core/agent-contract` ships one checked-in non-empty JSON vector set
for each of the 32 purposes. Every entry contains:

```ts
type NpAgentCanonicalHmacPurposeV1 = keyof typeof npAgentCanonicalHmacOwnersV1;

type NpAgentCanonicalGoldenVectorV1<P extends NpAgentCanonicalPurposeV1> = {
  purpose: P;
  vectorId: string;
  body: NpAgentCanonicalPurposeBodyMapV1[P];
  canonicalJsonUtf8Base64: string;
  domainSeparatedUtf8Base64: string;
} & (P extends NpAgentCanonicalShaPurposeV1
  ? { sha256: `cj1:sha256:${string}` }
  : { sha256: null }) &
  (P extends NpAgentCanonicalHmacPurposeV1
    ? {
        hmac: {
          keyId: "test-key-1";
          keyBase64: string;
          value: `cj1:hmac-sha256:test-key-1:${string}`;
        };
      }
    : { hmac: null });

type NpAgentCanonicalGoldenRegistryV1 = {
  [P in NpAgentCanonicalPurposeV1]: readonly [
    NpAgentCanonicalGoldenVectorV1<P>,
    ...NpAgentCanonicalGoldenVectorV1<P>[],
  ];
};

export declare const npAgentCanonicalGoldenVectorsV1: NpAgentCanonicalGoldenRegistryV1;

interface NpAgentCanonicalMatchedDiscriminatorCaseV1 {
  caseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  concreteDiscriminatorPath: `/${string}`;
}

export function npMatchAgentCanonicalDiscriminatorCasesV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  analyzedBody: NpAgentCanonicalPurposeBodyMapV1[P],
): NpAgentCanonicalMatchedDiscriminatorCaseV1[];

interface NpAgentCanonicalPositiveDiscriminatorFixtureV1<P extends NpAgentCanonicalPurposeV1> {
  purpose: P;
  fixtureId: string;
  vectorId: string;
  caseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  concreteDiscriminatorPath: `/${string}`;
}

type NpAgentCanonicalPositiveDiscriminatorRegistryV1 = {
  [P in NpAgentCanonicalPurposeV1]?: readonly [
    NpAgentCanonicalPositiveDiscriminatorFixtureV1<P>,
    ...NpAgentCanonicalPositiveDiscriminatorFixtureV1<P>[],
  ];
};

export declare const npAgentCanonicalPositiveDiscriminatorVectorsV1: NpAgentCanonicalPositiveDiscriminatorRegistryV1;

interface NpAgentCanonicalRegistryProjectionFixtureV1<
  P extends NpAgentCanonicalRegistryProjectionPurposeV1,
> {
  purpose: P;
  fixtureId: string;
  definitionCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  registryCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  singletonDefinitionVectorId: string;
  singletonRegistryVectorId: string;
  multiMemberDefinitionVectorId: string;
  multiRegistryVectorId: string;
  expectedIncompleteRegistryErrorCode: "AGENT_CANONICAL_INCOMPLETE_REGISTRY";
}

type NpAgentCanonicalRegistryProjectionFixtureRegistryV1 = {
  [P in NpAgentCanonicalRegistryProjectionPurposeV1]: readonly [
    NpAgentCanonicalRegistryProjectionFixtureV1<P>,
  ];
};

export declare const npAgentCanonicalRegistryProjectionVectorsV1: NpAgentCanonicalRegistryProjectionFixtureRegistryV1;

declare function expectRegistryProjectionCompletenessFixture<
  P extends NpAgentCanonicalRegistryProjectionPurposeV1,
>(
  purpose: P,
  fixture: NpAgentCanonicalRegistryProjectionFixtureV1<P>,
  vectors: readonly NpAgentCanonicalGoldenVectorV1<P>[],
  contextualPairs: readonly [
    NpAgentCanonicalContextualSiblingPairV1,
    NpAgentCanonicalContextualSiblingPairV1,
  ],
): void;

interface NpAgentCanonicalSiblingInjectionV1<P extends NpAgentCanonicalPurposeV1> {
  purpose: P;
  fixtureId: string;
  sourceVectorId: string;
  sourceCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  siblingCaseId: keyof typeof npAgentCanonicalBranchIncludedKeysV1;
  concreteDiscriminatorPath: `/${string}`;
  replacementValue: string;
  expectedErrorCode: "AGENT_CANONICAL_BRANCH_MISMATCH";
}

type NpAgentCanonicalSiblingInjectionRegistryV1 = {
  [P in NpAgentCanonicalPurposeV1]?: readonly [
    NpAgentCanonicalSiblingInjectionV1<P>,
    ...NpAgentCanonicalSiblingInjectionV1<P>[],
  ];
};

export declare const npAgentCanonicalSiblingInjectionVectorsV1: NpAgentCanonicalSiblingInjectionRegistryV1;

export function npBuildAgentCanonicalSiblingInjectionV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  sourceBody: NpAgentCanonicalPurposeBodyMapV1[P],
  fixture: NpAgentCanonicalSiblingInjectionV1<P>,
): unknown;
```

`npAgentCanonicalGoldenVectorsV1`,
`npAgentCanonicalPositiveDiscriminatorVectorsV1`, and
`npAgentCanonicalSiblingInjectionVectorsV1` are checked-in registries.
`npAgentCanonicalRegistryProjectionVectorsV1` is the separate checked-in
context fixture for capability/recipe registry completeness. The matcher
reparses the body first and derives coverage only from registered selectors;
no golden vector stores or asserts its own covered cases. Each positive fixture
assigns one registered case to one actual vector and concrete matching path,
and every case must have exactly one such assignment.

For every ordered sibling pair not listed in
`npAgentCanonicalContextualSiblingPairsV1`, the sibling builder requires both
case ids to belong to the same purpose and pointer pattern, requires the
concrete path to resolve to the source case in the referenced positive vector,
and replaces only that discriminator with one of the sibling's accepted
values. It rejects a replacement accepted by the source, any second mutation,
or any wildcard/path ambiguity. The resulting unknown candidate must fail the
exact analyzer with the registered error.

Capability and recipe `definition`/`registry` projections are intentionally
contextual. A complete installed registry may contain exactly one definition,
so changing only `projection` can be valid. Each registry-projection fixture
therefore names four positive vectors: a singleton definition, its byte-equal
singleton registry apart from `projection`, one definition drawn from a
complete multi-item registry, and that complete sorted multi-item registry.
The helper requires four distinct existing vector ids, exact definition/
registry case ids matching both contextual ordered-pair endpoints, identical
singleton item arrays, at least two items in the multi registry, and a
byte-equal member match for the multi-member definition.
The domain builder must accept both singleton projections and produce distinct
digests, accept the complete multi-item registry, reject the one-member body
retagged as `registry` against that multi-item installed snapshot with
`AGENT_CANONICAL_INCOMPLETE_REGISTRY`, and reject the multi-item body retagged
as `definition` by exact cardinality. The generic body analyzer validates
shape/cardinality; the named capability/recipe domain builder owns installed-
set completeness.

The destination fixture has `sha256:null` and a non-null HMAC; the three
approval-integrity purposes have both values; every other purpose has a
non-null SHA digest and `hmac:null`. Every purpose must cover, across its
positive vectors and attached negative cases:

- source key shuffling produces byte-identical canonical JSON/digest;
- an unknown top-level key and every listed self-digest/MAC key fail;
- each security-sensitive nested excluded key fails;
- sorted-set input in another order either normalizes before body construction
  or the already-canonical body analyzer rejects it, according to the owner;
- a duplicate set member fails;
- a required null changed to omission fails;
- an optional MCP error `data` omission stays omitted;
- a branch-only key on the other union branch fails;
- every discriminator branch registered for the purpose has one verified
  positive assignment; structurally exclusive sibling injection fails, while
  capability/recipe projection pairs pass the separate singleton/multi-item
  completeness fixtures;
- Unicode code points, escapes, `-0`, safe-integer boundaries, unsafe
  integers, non-finite numbers, and lone surrogates follow JCS/I-JSON rules;
- the exact byte ceiling succeeds and one byte beyond fails before hashing;
- replacing the purpose with any of the other 31 values changes the digest;
  and
- for a retained-body owner, persisted/wire serialization followed by
  authoritative rehydration reproduces the same body and digest; and
- for the two deliberately ephemeral sensitive diagnostic bodies
  (`np.agent-provider-request.v1` and
  `np.agent-provider-response.v1`), independent pre-discard
  serialize/parse/hash paths reproduce the same body and digest, while
  post-retention rehydration is intentionally not claimed.

Those two provider purposes are the only v1 hash-only-retention exceptions.
Their rows retain the digest, frozen registry/config/classification facts,
safe outcome/decision, and optional diagnostic redaction, but not the full
prompt/evidence/provider body. Every other purpose must retain its exact body
or a complete immutable reconstruction source for the full dependency
closure. A hash-only exception cannot be inferred from a nullable JSON
column; adding one changes this closed contract and its tests.

Purpose-specific vectors additionally prove:

- approval hash and MAC consume byte-identical statement/decision/revocation
  bytes, and live-preview identity changes all statement integrity values;
- destination low-entropy descriptors use the dedicated HMAC keyring and are
  not accepted by the generic SHA type or runtime analyzer;
- action target-version facts have exactly the same length, order, and
  byte-equal refs as `targetRefs`; missing, duplicate, unknown, reordered, or
  cross-ref facts fail, and changing one `versionDigest` changes the proposal
  hash;
- artifact ordering, screenshot/report null matrix, report-part continuity,
  and `resourceUri` exclusion;
- ChangeSet proposal/plan/snapshot hashes are distinct and cannot substitute
  for `beforeHash`;
- service-family token rotation under the same effective deployment/site
  ceiling that preserves scopes, transport, exposure, audience, and authority
  produces the same authorization-context fingerprint, while another
  family/version or effective exposure does not;
- MCP related-task metadata and request ids do not affect the stored terminal
  result;
- provider dispatch-state/outcome mismatches fail;
- restriction adapter receipts do not alter `restrictionHash`;
- a deletion cursor/receipt update does not alter `planHash`; and
- vault ciphertext/nonce/tag changes do not alter AAD bytes, while any AAD
  identity field change does.

CI performs this exact exhaustiveness assertion:

```ts
expect(sortedKeys(npAgentCanonicalPurposes)).toEqual(
  sortedKeys(npAgentCanonicalPurposeAnalyzersV1),
);
expect(sortedKeys(npAgentCanonicalPurposes)).toEqual(
  sortedKeys(npAgentCanonicalPurposeIncludedKeysV1),
);
expect(sortedKeys(npAgentCanonicalPurposes)).toEqual(
  sortedKeys(npAgentCanonicalPurposeExcludedKeysV1),
);
expect(sortedKeys(npAgentCanonicalPurposes)).toEqual(sortedKeys(npAgentCanonicalBodyMaxBytesV1));
expect(sortedKeys(npAgentCanonicalPurposes)).toEqual(sortedKeys(npAgentCanonicalGoldenVectorsV1));
for (const purpose of sortedKeys(npAgentCanonicalPurposes)) {
  const vectors = npAgentCanonicalGoldenVectorsV1[purpose];
  const cases = npAgentCanonicalDiscriminatorCasesV1[purpose] ?? [];
  const contextualPairs =
    (
      npAgentCanonicalContextualSiblingPairsV1 as Partial<
        Record<NpAgentCanonicalPurposeV1, readonly NpAgentCanonicalContextualSiblingPairV1[]>
      >
    )[purpose] ?? [];
  const positiveVectors = npAgentCanonicalPositiveDiscriminatorVectorsV1[purpose] ?? [];
  const negativeVectors = npAgentCanonicalSiblingInjectionVectorsV1[purpose] ?? [];

  expect(vectors.length).toBeGreaterThan(0);
  for (const vector of vectors) expect(vector.purpose).toBe(purpose);
  expect(vectors.map((vector) => vector.vectorId).length).toBe(
    new Set(vectors.map((vector) => vector.vectorId)).size,
  );

  const expectedCaseIds = cases.map((entry) => entry.caseId);
  expect(expectedCaseIds.length).toBe(new Set(expectedCaseIds).size);
  for (const entry of cases) {
    expectBranchCaseOwnedByPurpose(purpose, entry.caseId);
    expect(entry.selector.acceptedValues).toEqual(sortedUnique(entry.selector.acceptedValues));
  }
  expectCaseSelectorsForOnePathToBeDisjoint(cases);

  expect(positiveVectors.map((fixture) => fixture.fixtureId).length).toBe(
    new Set(positiveVectors.map((fixture) => fixture.fixtureId)).size,
  );
  const assignedCaseIds = positiveVectors.map((fixture) => fixture.caseId);
  expect(assignedCaseIds.length).toBe(new Set(assignedCaseIds).size);
  expect(sortedUnique(assignedCaseIds)).toEqual(sortedUnique(expectedCaseIds));
  for (const fixture of positiveVectors) {
    expect(fixture.purpose).toBe(purpose);
    const source = requireGoldenVectorById(purpose, fixture.vectorId);
    expectCanonicalDiscriminatorCaseAtPath(purpose, source.body, fixture);
  }

  const matchedCases = vectors.flatMap((vector) =>
    npMatchAgentCanonicalDiscriminatorCasesV1(purpose, vector.body),
  );
  const matchedCaseIds = matchedCases.map((entry) => entry.caseId);
  expect(sortedUnique(matchedCaseIds)).toEqual(sortedUnique(expectedCaseIds));

  const allSiblingPairs = orderedSiblingPairsByPointerPattern(cases);
  const contextualPairIds = contextualPairs.map(
    (pair) => `${pair.sourceCaseId}->${pair.siblingCaseId}`,
  );
  expect(contextualPairIds.length).toBe(new Set(contextualPairIds).size);
  expectContextualPairsToShareOneRegisteredPointerPattern(purpose, cases, contextualPairs);
  expect(contextualPairIds.every((pair) => allSiblingPairs.includes(pair))).toBe(true);
  const expectedSiblingPairs = allSiblingPairs.filter((pair) => !contextualPairIds.includes(pair));
  const actualSiblingPairs = negativeVectors.map(
    (fixture) => `${fixture.sourceCaseId}->${fixture.siblingCaseId}`,
  );
  expect(actualSiblingPairs.length).toBe(new Set(actualSiblingPairs).size);
  expect(sortedUnique(actualSiblingPairs)).toEqual(sortedUnique(expectedSiblingPairs));
  expect(negativeVectors.map((fixture) => fixture.fixtureId).length).toBe(
    new Set(negativeVectors.map((fixture) => fixture.fixtureId)).size,
  );

  for (const fixture of negativeVectors) {
    expect(fixture.purpose).toBe(purpose);
    const source = requireGoldenVectorById(purpose, fixture.sourceVectorId);
    expectPositiveCaseAssignment(
      purpose,
      fixture.sourceVectorId,
      fixture.sourceCaseId,
      fixture.concreteDiscriminatorPath,
    );
    const candidate = npBuildAgentCanonicalSiblingInjectionV1(purpose, source.body, fixture);
    expect(() => npAnalyzeAgentCanonicalBodyV1(purpose, candidate)).toThrowContractError(
      fixture.expectedErrorCode,
    );
  }
}
expect(sortedKeys(npAgentCanonicalContextualSiblingPairsV1)).toEqual([
  "np.agent-capability-registry.v1",
  "np.agent-recipe-registry.v1",
]);
expect(sortedKeys(npAgentCanonicalRegistryProjectionVectorsV1)).toEqual([
  "np.agent-capability-registry.v1",
  "np.agent-recipe-registry.v1",
]);
for (const purpose of ["np.agent-capability-registry.v1", "np.agent-recipe-registry.v1"] as const) {
  const [fixture] = npAgentCanonicalRegistryProjectionVectorsV1[purpose];
  expect(fixture.purpose).toBe(purpose);
  expectRegistryProjectionCompletenessFixture(
    purpose,
    fixture,
    npAgentCanonicalGoldenVectorsV1[purpose],
    npAgentCanonicalContextualSiblingPairsV1[purpose],
  );
}
expect(() =>
  (npDigestAgentCanonicalBodyV1 as unknown as (purpose: string, body: unknown) => string)(
    "np.agent-connection-destination.v1",
    destinationFixtureBody,
  ),
).toThrowContractError();

// @ts-expect-error destination fingerprints are HMAC-only
npDigestAgentCanonicalBodyV1("np.agent-connection-destination.v1", destinationFixtureBody);
```

It also compiles a type-only assertion that every value of
`NpAgentCanonicalPurposeBodyMapV1` has a registered exact analyzer and named
domain builder, and that the destination purpose cannot type-check at a SHA
call site. The branch loop rejects duplicate vector/fixture/case ids, duplicate
or falsely claimed coverage, overlapping discriminator values, and a
missing/duplicate ordered structural sibling-injection fixture. The two
contextual pair inventories must be exact, and their helper enforces the
singleton/multi-item builder behavior described above rather than pretending a
valid singleton registry must fail. R1 or later migrations, digest columns, approvals,
idempotency, provider calls, or external-effect journals remain blocked until
these assertions and all golden vectors pass.
