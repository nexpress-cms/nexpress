# Agent ChangeSets and approvals

> Status: proposed mutation, preview, approval, and rollback contract.
> Baseline: `9b1c04e8927e195b8e8e23c7b1261756067ee25f` (2026-07-24).
> Depends on [README.md](README.md) and [data-model.md](data-model.md).

An Agent ChangeSet is the default boundary for multi-resource writes proposed
by a Runtime Agent or external MCP client. It turns a model's suggestion into a
canonical server-owned plan that can be validated, previewed, approved,
scheduled, applied, verified, audited, and reversed without granting the model
direct production mutation authority.

The same contract is available to humans and deterministic automations. "Agent"
describes the caller, not a weaker write path.

## 1. Goals

- Group related document, navigation, theme-token, setting, and media-reference
  changes into one operator-visible unit.
- Detect stale bases and cross-resource conflicts before any production write.
- Render previews and diffs from the exact canonical plan.
- Bind approvals to a site, principal, operation set, policy set, and hash.
- Apply database-owned changes atomically through existing validated services.
- Make retries idempotent and crash recovery explicit.
- Verify the public/runtime result after commit.
- Roll back by applying a new validated forward change, never by rewriting
  history in place.

## 2. Non-goals

- Arbitrary SQL, shell commands, source edits, dependency installation, schema
  generation, migrations, database restore, or secret rotation.
- Treating object storage or third-party side effects as transactionally atomic
  with Postgres.
- Silently overwriting a resource changed after the plan was built.
- Letting a model choose risk, approval requirements, or the text shown as
  trusted approval evidence.
- Replacing document revisions or physical backups.

## 3. Supported resource kinds

The first contract supports:

| Kind           | Canonical key                                                                          | Initial operations                                   |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `document`     | `{ collection, documentId }`; create receives a server-reserved id at draft acceptance | `create`, `update`, `publish`, `schedule`, `archive` |
| `navigation`   | `{ location }`                                                                         | `replace`                                            |
| `theme_tokens` | singleton active overlay                                                               | `replace`                                            |
| `setting`      | allowlisted portable/non-secret key                                                    | `replace`, `remove`                                  |
| `media_ref`    | `{ mediaId, collection, documentId, field }`                                           | `attach`, `detach`                                   |

Initial release exclusions:

- permanent document/media deletion;
- user, member, role, membership, ban, or credential changes;
- plugin package/config/install changes;
- site quota, agent policy, agent scope, or provider connection changes;
- job/backup/storage/migration/restore actions.

Those operations use their existing service or `ops.plan`/`ops.execute`
boundary. A later resource kind must define exact input, base fingerprint,
preview, apply, verification, compensation, scope, and risk rules before it can
register.

## 4. Wire contract

All public types and analyzers live in the proposed client-safe
`@nexpress/core/agent-contract` entry.

```ts
export const npAgentChangeSetStates = [
  "draft",
  "validating",
  "invalid",
  "ready",
  "approval_pending",
  "approved",
  "scheduled",
  "applying",
  "applied",
  "verifying",
  "verified",
  "rejected",
  "cancelled",
  "apply_failed",
  "verification_failed",
  "rolling_back",
  "rolled_back",
  "rollback_failed",
] as const;

export type NpAgentChangeSetState = (typeof npAgentChangeSetStates)[number];

export const npAgentRollbackPlanStates = [
  "preparing",
  "invalid",
  "ready",
  "approval_pending",
  "approved",
  "executing",
  "verified",
  "failed",
  "conflicted",
  "expired",
] as const;

export type NpAgentRollbackPlanState = (typeof npAgentRollbackPlanStates)[number];

export interface NpAgentRollbackSummary {
  rollbackPlanId: string;
  generation: number;
  state: NpAgentRollbackPlanState;
  planHash: string | null;
  approvalId: string | null;
  operationCount: number;
  createdAt: string;
  expiresAt: string;
  finishedAt: string | null;
  terminalReason:
    | "validation_failed"
    | "snapshot_expired"
    | "conflict"
    | "policy_blocked"
    | "approval_rejected"
    | "approval_revoked"
    | "approval_expired"
    | "operator_cancelled"
    | "execution_cancelled"
    | "execution_failed"
    | "verification_failed"
    | null;
}

export interface NpAgentChangeSetWire {
  schemaVersion: "np.agent-changeset.v1";
  id: string;
  siteId: string;
  title: string;
  summary: string | null;
  state: NpAgentChangeSetState;
  actor: {
    id: string;
    kind: "runtime" | "external" | "staff";
    name: string;
  };
  agentId: string | null;
  agentVersionId: string | null;
  agentConfigHash: string | null;
  runId: string | null;
  planHash: string | null;
  baseFingerprint: string | null;
  draftVersion: number;
  draftHash: string;
  risk: NpAgentRiskSummary | null;
  operations: NpAgentChangeSetOperationWire[];
  validation: NpAgentValidationSummary | null;
  preview: NpAgentPreviewSummary | null;
  approval: NpAgentApprovalWire | null;
  schedule: { at: string } | null;
  execution: NpAgentExecutionSummary | null;
  verification: NpAgentVerificationSummary | null;
  rollback: NpAgentRollbackSummary | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
```

Every object is closed and bounded. Timestamps are canonical UTC ISO strings.
Unknown state, resource kind, operation, issue code, risk reason, or nested key
fails closed.

### 4.1 Operation input

```ts
interface NpAgentChangeSetOperationCommon {
  clientOperationId: string;
  reason: string | null;
}

interface NpAgentVersionBase {
  version: string;
  digest: string;
}

export const npAgentMutableSettingKeys = ["seo"] as const;
export type NpAgentMutableSettingKey = (typeof npAgentMutableSettingKeys)[number];

export type NpAgentChangeSetOperationInput =
  | (NpAgentChangeSetOperationCommon & {
      kind: "document";
      operation: "create";
      resource: { collection: string; documentId: null };
      base: null;
      input: {
        document: NpAgentJsonObject;
        targetStatus: "draft" | "published";
      };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "document";
      operation: "update";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBase;
      input: {
        patch: NpAgentJsonObject;
        targetStatus: "draft" | "published" | null;
      };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "document";
      operation: "publish" | "archive";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBase;
      input: Record<string, never>;
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "document";
      operation: "schedule";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBase;
      input: { publishAt: string };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "navigation";
      operation: "replace";
      resource: { location: string };
      base: NpAgentVersionBase;
      input: { items: NpNavigationItems };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "theme_tokens";
      operation: "replace";
      resource: { themeId: string };
      base: NpAgentVersionBase;
      input: { tokens: NpThemeTokensOverlay };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "setting";
      operation: "replace";
      resource: { key: NpAgentMutableSettingKey };
      base: NpAgentVersionBase | null;
      input: { value: NpAgentJsonValue };
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "setting";
      operation: "remove";
      resource: { key: NpAgentMutableSettingKey };
      base: NpAgentVersionBase;
      input: Record<string, never>;
    })
  | (NpAgentChangeSetOperationCommon & {
      kind: "media_ref";
      operation: "attach" | "detach";
      resource: {
        mediaId: string;
        collection: string;
        documentId: string;
        field: string;
      };
      base: NpAgentVersionBase;
      input: Record<string, never>;
    });
```

`clientOperationId` is caller-stable within the ChangeSet and lets a retry
replace the same draft operation rather than append a duplicate. `reason` is
untrusted explanatory text. The server resolves the active collection,
navigation, token, setting, and media schemas; canonicalizes the input; and
rejects undeclared fields before persistence.

`document`/`patch` and setting `value` use the common bounded JSON wire only as
the transport envelope; the selected live collection or closed
`NpAgentMutableSettingKey` analyzer reparses them exactly. Document create
allocates and persists its canonical UUID when that draft operation is first
accepted and returns
`canonicalResourceKey:{kind:"document",collection,documentId:<reservedUuid>}`;
this reserves identity but does not create a document row or grant read/write
authority. Every other branch returns the corresponding exact
`NpAgentChangeSetResourceKeyV1`; canonical ordering/locking/hash input uses the
RFC 8785 bytes of that tagged object, never delimiter-joined text.
V1 has no caller-defined temporary-id or reference-placeholder grammar:
`tempId`, `$ref`, and equivalent undeclared keys fail closed, and one
ChangeSet cannot point a relationship or media reference at a document created
by another operation in that same ChangeSet. The caller first applies the
create ChangeSet, then uses the returned canonical id in a newly based
ChangeSet. Navigation, token, and media-reference branches reuse the current
client-safe domain contracts shown above; there is no parallel owner-kind
vocabulary.

The shared Core contract publishes exact analyzers/requirers for operation
input, version base, and canonical resource keys. It also publishes exact
proposal/snapshot analyzers plus named canonical-byte and SHA-256 digest
builders. These context-free functions reject unknown keys, accessors,
non-plain or shared/cyclic JSON graphs, invalid branch/base/input matrices,
unsorted or duplicate proposal ordinals, resource-key mismatches, and values
over the normative byte ceilings. They do not replace draft admission's
selected live collection-schema check, authorization, current-base read, UUID
reservation persistence, or any plan/runtime/database transition.

The response types are also exact:

```ts
export const npAgentValidationIssueCodes = [
  "SCHEMA_INVALID",
  "ACCESS_DENIED",
  "RESOURCE_NOT_FOUND",
  "BASE_CONFLICT",
  "REFERENCE_INVALID",
  "QUOTA_EXCEEDED",
  "LIMIT_EXCEEDED",
  "POLICY_BLOCKED",
  "ROLLBACK_UNAVAILABLE",
  "ROUTE_COLLISION",
  "LINK_INVALID",
  "SEO_INVALID",
  "ACCESSIBILITY_ERROR",
  "PREVIEW_REQUIRED",
  "VALIDATION_FAILED",
] as const;

export interface NpAgentValidationIssueWire {
  code: (typeof npAgentValidationIssueCodes)[number];
  severity: "warning" | "error";
  operationOrdinal: number | null;
  path: string;
  message: string;
  evidenceRefs: string[];
}

export type NpAgentChangeSetResourceKeyV1 =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "navigation"; location: string }
  | { kind: "theme_tokens"; themeId: string }
  | { kind: "setting"; key: NpAgentMutableSettingKey }
  | {
      kind: "media_ref";
      mediaId: string;
      collection: string;
      documentId: string;
      field: string;
    };

export const npAgentRiskReasonCodes = [
  "PUBLIC_WRITE",
  "ARCHIVE",
  "PROTECTED_RESOURCE",
  "MULTI_RESOURCE",
  "OPERATION_VOLUME",
  "NAVIGATION_WRITE",
  "THEME_WRITE",
  "SETTING_WRITE",
  "NON_ATOMIC_SIDE_EFFECT",
  "ROLLBACK_PARTIAL",
] as const;

export interface NpAgentChangeSetOperationWire {
  ordinal: number;
  operation: NpAgentChangeSetOperationInput;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  beforeHash: string | null;
  afterHash: string | null;
  state: "draft" | "valid" | "invalid" | "applied" | "verified" | "failed";
  issues: NpAgentValidationIssueWire[];
  resultDigest: string | null;
}

export interface NpAgentRiskSummary {
  level: "low" | "medium" | "high" | "critical";
  reasonCodes: Array<(typeof npAgentRiskReasonCodes)[number]>;
  approvalMode: "human";
  reversible: boolean;
}

export interface NpAgentValidationSummary {
  state: "queued" | "running" | "valid" | "invalid" | "failed";
  generation: number;
  issueCount: number;
  digest: string | null;
  completedAt: string | null;
}

export interface NpAgentPreviewArtifactRefWireV1 {
  schemaVersion: "np.agent-preview-artifact-ref.v1";
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
  resourceUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface NpAgentPreviewSummary {
  schemaVersion: "np.agent-preview-summary.v1";
  previewId: string;
  state: "queued" | "rendering" | "ready" | "failed" | "expired";
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  digest: string | null;
  artifactCount: number;
  artifactRefs: NpAgentPreviewArtifactRefWireV1[];
  interactiveLaunch: {
    previewId: string;
    adminLaunchOperation: string;
  } | null;
  expiresAt: string | null;
}

export type NpAgentPreviewDetailWireV1 = Omit<NpAgentPreviewSummary, "schemaVersion"> & {
  schemaVersion: "np.agent-preview.v1";
  changeSetId: string;
  allowedRoutes: Array<{
    route: string;
    locale: string | null;
    audience: "public";
  }>;
  diffSummary: NpAgentJsonObject;
  checkSummary: NpAgentJsonObject;
  riskSummary: NpAgentRiskSummary;
  createdAt: string;
  completedAt: string | null;
  safeErrorCode: string | null;
};

export type NpAgentPreviewCheckIdV1 =
  "broken-links" | "metadata" | "structured-data" | "accessibility" | "route-collision";

export type NpAgentPreviewIssueCodeV1 =
  | "ROUTE_NOT_FOUND"
  | "EXTERNAL_UNVERIFIED"
  | "EXTERNAL_UNREACHABLE"
  | "METADATA_MISSING"
  | "METADATA_INVALID"
  | "STRUCTURED_DATA_INVALID"
  | "ACCESSIBILITY_VIOLATION"
  | "ROUTE_COLLISION"
  | "CHECK_TIMEOUT";

export interface NpAgentPreviewReportV1 {
  schemaVersion: "np.agent-preview-report.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  part: number;
  totalParts: number;
  results: Array<{
    id: string;
    checkId: NpAgentPreviewCheckIdV1;
    status: "pass" | "warning" | "fail";
    route: {
      route: string;
      locale: string | null;
      audience: "public";
    } | null;
    issueIds: string[];
  }>;
  issues: Array<{
    id: string;
    resultId: string;
    severity: "warning" | "error";
    code: NpAgentPreviewIssueCodeV1;
    safeMessage: string;
    target:
      | { kind: "route"; route: string }
      | { kind: "selector"; selectorDigest: string }
      | { kind: "external-origin"; origin: string }
      | { kind: "operation"; ordinal: number }
      | null;
    evidenceRefs: Array<{
      kind: "artifact" | "operation";
      id: string;
    }>;
  }>;
  generatedAt: string;
}

export interface NpAgentExecutionSummary {
  executionId: string;
  state: "reserved" | "committed" | "verifying" | "succeeded" | "failed" | "ambiguous";
  resultDigest: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface NpAgentVerificationSummary {
  state: "queued" | "running" | "passed" | "failed";
  requiredPassed: number;
  requiredFailed: number;
  advisoryWarnings: number;
  digest: string | null;
  completedAt: string | null;
}

export interface NpAgentApprovalWire {
  id: string;
  generation: number;
  state: "pending" | "approved" | "rejected" | "expired" | "consumed" | "revoked";
  statementHash: string;
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
}
```

Every issue has exact code, severity, operation ordinal, bounded field path,
safe message, and evidence refs. Arrays and strings use the limits in §4.2.
`NpAgentApprovalWire` is the shared redacted approval projection used by the
security/Admin contract, not a second ChangeSet-local authority record.
Preview artifact resource URIs are canonical
`nexpress://site/<siteId>/agent-previews/<previewId>/artifacts/<artifactId>`
references with `contentDigest` in the structured field, never a bearer URL.
The summary/detail `digest` is the canonical preview artifact-manifest digest
defined in [architecture.md](architecture.md), not a digest of concatenated
files; each ref's `contentDigest` is the domain-separated raw-byte digest.
`artifactRefs` is empty and `interactiveLaunch` is null unless state is
`ready`; an Admin projection includes the fixed launch-operation path while an
MCP/Agent projection returns null. Arrays remain within the screenshot/artifact
limit below. Artifact refs are sorted by unique positive ordinal. Screenshot
refs require route/locale/viewport and image MIME with both report-part fields
null. Report refs require those three locator fields null, JSON MIME, and
positive contiguous `reportPart`/byte-equal `reportTotalParts` no greater than
four. The Admin preview GET returns
`NpAgentPreviewDetailWireV1`; ChangeSet list/detail embeds only the summary.

### 4.2 Limits

Proposed v1 constants:

| Limit                                 |                               Value |
| ------------------------------------- | ----------------------------------: |
| Operations per ChangeSet              |                                 500 |
| Collections touched                   |                                  64 |
| Serialized canonical plan             |                               4 MiB |
| Inline before snapshot per operation  |                             256 KiB |
| Inline before snapshots per ChangeSet |                               2 MiB |
| Individual explanatory string         |                    4,000 characters |
| Validation issues returned            |                               1,000 |
| Preview screenshots                   |                                  20 |
| Preview artifacts/refs total          |                                  24 |
| Preview reports                       |                                   4 |
| One preview screenshot                |                               2 MiB |
| One preview report                    |                             512 KiB |
| Preview/object maximum lifetime       |                              7 days |
| ChangeSet execution eligibility       |    30 days default, maximum 90 days |
| Approval lifetime                     | 24 hours by default, maximum 7 days |
| Viewer preview token lifetime         |                           5 minutes |
| Active viewer launches per preview    |                                  20 |
| Internal preview-render lifetime      |                           2 minutes |
| Render captures per attempt           |                                  20 |
| Rollback evidence window              |            30 days, maximum 90 days |

Limits are exported as one frozen `npAgentChangeSetLimits` inventory and are
enforced at draft write, validation, persistence read, API serialization, MCP
output, and Doctor. Media snapshots contain metadata and references, never
binary objects. A plan that cannot preserve bounded rollback evidence fails
validation rather than moving snapshots to an undeclared storage side channel.

The server sets required `expiresAt` at creation within the deployment-capped
eligibility limit. When it passes, a bounded reconciliation compare-and-swaps
any non-executing `draft`, `invalid`, `ready`, `approval_pending`, `approved`,
or `scheduled` row to `cancelled` with `CHANGESET_EXPIRED` and revokes an
unconsumed approval. Proposal validation, initial approval, scheduling, and
apply check this expiry synchronously, so safety never depends on that job.
Rollback uses its independently bounded rollback-plan expiry and the
derived `rollbackEligibleUntil` window. Applying or terminal historical rows retain
their outcome; `expiresAt` is not their retention deadline.

## 5. State machine

```text
draft ──validate──> validating ──issues──> invalid
  ▲                       │                   │
  └────────edit───────────┴────edit──────────┘
                          │ valid
                          ▼
                       ready
                          │
                          ▼
                   approval_pending
                   ├─reject──> rejected
                   └─approve──> approved
                                  ├─schedule──> scheduled ──due─┐
                                  └─apply───────────────────────┤
                                                               ▼
                                                            applying
                                                            ├─failure──> apply_failed
                                                            └─commit───> applied
                                                                            │
                                                                            ▼
                                                                         verifying
                                                                         ├─pass──> verified
                                                                         └─fail──> verification_failed

verified/applied/verification_failed
  └─rollback──> rolling_back ──> rolled_back | rollback_failed
```

`cancelled` is allowed from `draft`, `invalid`, `ready`,
`approval_pending`, `approved`, or `scheduled`. Applying and rollback states
cannot be cancelled by changing a row; the executor receives a cooperative
cancel request only when its transaction has not begun.

Any edit is allowed only in `draft` or `invalid`. It:

1. clears validation, preview, risk, schedule, and execution summaries;
2. expires/revokes prior approval;
3. clears `planHash`, the exact sealed plan body, `baseFingerprint`, and the
   frozen rollback-window duration;
4. increments `draftVersion` and recomputes `draftHash` over the exact
   canonical editable envelope;
5. returns the ChangeSet to `draft`.

Invalid persisted transitions are contract failures, not states to repair
implicitly.

A validation worker's `failed` summary is terminal for that generation and
moves the parent to `invalid` with one server-authored
`VALIDATION_FAILED` error, no `planHash`, and no approval eligibility. A retry
allocates a new validation generation; it never treats infrastructure failure
as a valid or still-running plan.

## 6. Draft creation and canonicalization

`changeset.create` requires `changeset:write` plus every operation's
resource-derived proposal scope: `content:draft`, `media:read` plus
`media:write` when changing a persisted media reference,
`navigation:write`, `theme:write`, or `settings:write` as applicable, but not
the final publish/apply scope for a machine principal. An authenticated Admin
staff caller instead passes the existing equivalent `NpCapability` and
resource checks through the same service without fabricating Agent scopes.
`changeset.validate` and `changeset.preview`
require `changeset:read` plus read visibility for every included resource.
`changeset.schedule`, `changeset.apply`, and rollback execution require
`changeset:apply` plus `content:publish` or the applicable resource write
scopes. Get/list filters or rejects plans whose included resources the caller
cannot see. The service:

1. resolves the current site and normalized invocation actor (`principal` or
   `staff`) from verified transport/Admin context, never request input;
2. reserves the closed `changeset.create` operation plus caller-stable
   idempotency key in `np_agent_invocations`;
3. validates the closed operation envelope and size limits;
4. resolves all collection/resource definitions;
5. allocates one canonical UUID for each accepted document-create operation,
   reuses it when the same `clientOperationId` is replaced or retried, and
   never inserts the document at this stage;
6. rejects caller-defined temporary ids and intra-ChangeSet references to
   newly created documents;
7. canonicalizes dates, JSON, rich text, blocks, navigation, and token values;
8. rejects cross-site media/relationship references;
9. persists a mutable draft with `draftVersion=1` and its canonical
   `draftHash`.

The caller cannot supply framework attribution, site ownership, revision
version, audit id, plan hash, risk, approval mode, or execution state.

Repeated creation with the canonical
`(site, actorKind, actorFingerprint, operationKind, operationId,
idempotencyKey)` invocation tuple returns the existing ChangeSet when the
canonical input hash matches and returns `CONFLICT` when it does not.

## 7. Base fingerprints and conflicts

Validation records the exact base read for each operation:

- versioned document: collection, document id, head revision/version, and
  canonical document hash;
- unversioned document: collection, document id, canonical wire hash, and
  `updatedAt`;
- missing create target: an explicit absence assertion;
- navigation: site, location, `updatedAt`, and canonical item-tree hash;
- theme tokens/setting: key, `updatedAt`, and canonical value hash;
- media reference: media site ownership, active/deleted status, and current
  owner/path relation.

The sorted operation base records form `baseFingerprint`. The executor
re-resolves every base under a site-scoped advisory lock and transaction before
mutation. A mismatch returns an exact conflict list and performs no writes.

There is no `force` flag for agents. A human may ask the caller to rebase:
refresh current resources, regenerate the affected operations, revalidate,
re-preview, and request a new approval.

## 8. Validation and risk

`changeset.validate` runs as a synchronous bounded call for small plans or a
durable task for large/preview-dependent plans.

Every validation admission compare-and-swaps the current `draftVersion` and
`draftHash`, allocates the next positive validation `generation`, and passes
those three values to the durable job. A stale job records no result. Only a
successful validation generation computes and persists `baseFingerprint` and
the sealed `planHash`; validation never requires a not-yet-created plan hash
as input.

Before enqueue, validation persists the admitting invocation, exact
authorization-context fingerprint/authority reference, and requester branch
on its generation row. A durable worker re-resolves that same current
session/family/grant/run and repeats `changeset:read` plus visibility for every
target before any protected read. Revocation, expiry, narrowing, membership
loss, runtime deadline, or visibility loss terminalizes only that generation
as `AUTHORITY_REVOKED`; it creates no sealed plan. The creator's authority is
never substituted for the requester.

Validation order:

1. persisted-row and plan-envelope contract;
2. principal state, site, scopes, and active policy hashes;
3. resource definitions and operation compatibility;
4. current base/fingerprint;
5. collection/field/block/rich-text/media/navigation/token/setting validation;
6. relationship existence and same-site ownership;
7. content policy checks and protected-path rules;
8. link, SEO, accessibility, locale, and publish-schedule checks that do not
   require rendering;
9. resource quotas and projected document/storage usage;
10. deterministic risk and approval decision.

Risk is calculated by server rules from:

- capability/resource risk class;
- whether public output changes;
- create/update/archive/publish semantics;
- operation and collection counts;
- protected collections/settings/paths;
- policy violations or warnings;
- rollback availability;
- external side effects;
- principal scopes and, only for a Runtime caller, the frozen Agent autonomy/
  capability mode.

The result is `low`, `medium`, `high`, or `critical` plus sorted stable reason
codes. Model confidence, model prose, or a caller-provided risk value never
reduces the result.

Validation resolves the current rollback policy to a frozen safe-integer
`rollbackWindowSeconds` (`60..7_776_000`, 30-day default and 90-day maximum),
then creates the complete canonical
`{schemaVersion:"np.agent-changeset-plan.v1",planKind:"changeset",...}` body,
`baseFingerprint`, and `planHash`. The stored sealed body is authoritative for
all scopes, human capabilities/predicates, policy hashes, validation evidence,
expiry, snapshots, and duration; denormalized rows must reproduce it without
consulting a newer registry. A valid plan moves to `ready`. Before v1
schedule/apply, the service creates an approval request and moves it to
`approval_pending`; policy may require stronger human checks but cannot remove
this floor.

## 9. Preview

`changeset.preview` operates only on a sealed plan hash. It produces:

- exact data diff for every operation;
- authorized local interactive-preview launch references for affected public
  pages when routable;
- desktop and mobile screenshots when a screenshot adapter is available;
- broken-link, metadata, structured-data, accessibility, and route-collision
  evidence;
- server-generated risk and approval facts.

Every stored JSON report must first parse as `NpAgentPreviewReportV1`. Parts
are positive, contiguous, at most four, and share byte-equal identity/contract
fields. Results are sorted by check id then canonical route/id, are unique by
id, and each issue id resolves exactly once to its owning result. A complete
preview has at most 1,000 results and 1,000 issues; one safe message is at most
500 characters and one issue has at most eight evidence refs. Selector targets
are domain-separated digests and external targets are canonical queryless
HTTPS origins. Reports contain no fetched body, HTML/DOM text, cookie/header,
credential, query/fragment, raw IP/email, storage key, or model prose. Each
part is RFC 8785 canonical UTF-8 JSON and at most 512 KiB before storage; a
malformed/oversized part fails the generation and can never be served.

### 9.1 Overlay rendering

At preview admission the host persists
`previewContractFingerprint = cj1:sha256(np.agent-preview-contract.v1, value)`
over the exact
`{schemaVersion,overlayResolverVersion,rendererId,rendererVersion,
rendererFingerprint,screenshotAdapterId,screenshotAdapterVersion,
screenshotAdapterFingerprint,routeParserVersion,checkRegistryVersion,
linkAllowlistVersion,linkAllowlistOrigins,networkPolicyVersion,
artifactLimitsVersion,reportSchemaVersion,responseHeaderBuilderVersion,
cspBuilderVersion}` object. Origins and registry members are sorted unique and
all adapter triples must be registered. Every retry/reclaim/render token,
session, artifact manifest, persistence read, and Doctor check requires the
frozen fingerprint; a changed/missing implementation fails the attempt and
requires a new generation rather than writing different evidence under the
old generation.

The preview request carries this exact signed, short-lived attenuator:

```ts
interface NpAgentPreviewTokenClaimsV1 {
  schemaVersion: "np.agent-preview-token.v1";
  intent: "viewer";
  issuer: string;
  audience: string;
  siteId: string;
  changeSetId: string;
  previewId: string;
  planHash: string;
  allowedRoutesDigest: string;
  launchGeneration: number;
  launchId: string;
  viewer: {
    kind: "staff";
    userId: string;
    sessionFingerprint: string;
    userTokenVersion: number;
    siteAuthorizationDigest: string;
  };
  iat: number;
  exp: number;
}
```

`allowedRoutesDigest` uses the shared `cj1:sha256` helper with purpose
`np.agent-preview-routes.v1` over exact
`{schemaVersion:"np.agent-preview-routes.v1",siteId,changeSetId,previewId,
generation,planHash,routes}`. `routes` is the
sorted unique list produced by the live canonical route parser, with each
tuple exactly `{route,locale,audience:"public"}`: absolute site-relative path
plus canonical locale and explicit public audience, with no
origin/query/fragment/dot segment. A current route that becomes member/private
does not match even if its path and locale remain unchanged.
`siteAuthorizationDigest` uses the same
helper with purpose `np.agent-staff-site-authorization.v1` over exact
`{schemaVersion:"np.agent-staff-site-authorization.v1",siteId,userId,
userTokenVersion,authority}` where `authority` is exactly either
`{kind:"super-admin",capabilities}` or
`{kind:"site-role",source:"membership"|"default-site-fallback",role,
capabilities}` and capabilities are sorted unique shipped `NpCapability`
values. Mint and verify import these two builders; no caller supplies a digest.

The compact wire is JWS with protected header exactly
`{alg:"EdDSA",typ:"np-preview+jwt",kid}` and the exact claims above;
unknown/duplicate header or claim fields fail. `issuer` is the deployment's
canonical isolated HTTPS `previewOrigin` and `audience` is
`urn:nexpress:preview:<siteId>`. `previewOrigin` must have a different
registrable domain and schemeful site from the canonical site/Admin origin,
must not share a parent-domain cookie namespace, and serves only the closed
preview launch/view/static-asset surface. It never proxies Admin, Agent API,
member, or arbitrary site routes. If a deployment cannot provide that
boundary, `interactiveLaunch` is null and human interactive viewing is
disabled; authenticated screenshot/report resources remain available.
The optional deployment value `NP_AGENT_PREVIEW_ORIGIN` is an exact canonical
HTTPS origin with no userinfo, non-root path, query, or fragment; it is not a
site setting and cannot be model/Admin supplied. Startup canonicalizes default
ports, checks the public-suffix/registrable-domain separation for every served
site origin, and advertises interactive launch only when the complete check
passes. Local development does not weaken this rule; it may use a separately
mapped test domain/browser profile or leave interactive launch disabled.

Numeric dates are integer seconds, maximum lifetime is five minutes, and
accepted clock skew is 60 seconds. The protected header and claims are
separately serialized to RFC 8785 JCS UTF-8 bytes and base64url-encoded without
padding before the standard JWS signing-input dot is inserted; verification
requires those canonical bytes, not merely an equivalent decoded JSON object.
A dedicated deployment-held preview Ed25519 keyring retains signing and
verification material until every JWS naming the key is expired plus skew.
The retained viewer-launch row keeps non-secret `kid` metadata for audit, but
does not justify keeping signing material through the 30–90 day row-retention
window: a consumed launch exchange is never re-signed or replayed. The keyring
is separate from OAuth, approval-integrity, vault, launch-exchange,
session-fingerprint, and opaque-verifier keys.

`sessionFingerprint` is not a raw session id. It is exactly
`psf1:hmac-sha256:<keyId>:<43-character-unpadded-base64url>`, where the MAC
input is u32be-length-framed UTF-8
`("np-agent-staff-session-fingerprint/v1",siteId,userId,staffSessionId)` under
the dedicated deployment-held preview-session HMAC keyring. The launch row
persists the real same-site `staff_session_id`, the fingerprint, and key id;
verification loads that current live session, recomputes with the frozen key,
and compares in constant time. Replicas share the keyring. A key remains until
every retained launch row that names it is outside retention, allowing Doctor
to recompute historical fingerprints without preserving a raw session id in
diagnostic output. New launches use only the active key; rotation does not
rewrite a live claim. The partial unique key is
`(preview_id, staff_session_id)`, while the keyed projection is the non-PII
claim/audit value.

Admin starts a top-level cross-site launch exchange, never an iframe or
JavaScript-readable token. The CSRF-protected
`POST /api/admin/agents/changesets/{id}/previews/{previewId}/launch` performs
all viewer checks, locks the preview/session pair, supersedes only that
session's prior pending/active row, increments its positive generation, and
creates a random `launchId` plus independent 32-byte exchange secret. The
browser receives the plaintext exactly once in a trusted `private, no-store`
HTML bridge as one hidden `exchange` form field posted to
`<previewOrigin>/__np/launch`; it never appears in JSON, a URL, referrer,
analytics, audit, or application logs. The bridge has no third-party content,
sets `Referrer-Policy: no-referrer`, and uses a server nonce solely to submit
the fixed form (with a framework-owned submit button fallback) under an exact
CSP whose `form-action` is only `previewOrigin`.

The wire is exactly
`nplx1_<canonical-lowercase-launch-uuid>_<43-character-unpadded-base64url>`.
The row stores no plaintext, only
`lxv1:hmac-sha256:<keyId>:<43-character-unpadded-base64url>`, computed under
the dedicated launch-exchange HMAC key over u32be-length-framed byte strings
`("np-agent-preview-launch-exchange/v1",siteId,previewId,launchId,
secretBytes)`. It stores the key id and 30-second exchange expiry. The key is
retained until every launch row naming it is outside viewer-launch retention;
verification is constant-time and the request body is always redacted before
logging.

`POST <previewOrigin>/__np/launch` accepts exactly one URL-encoded `exchange`
field, requires the configured canonical site origin in `Origin`, locks the
row, and atomically consumes `exchange_pending→active`. It then reloads the
persisted production `staff_session_id`, user token version, and current site
authorization server-side, recomputes every viewer claim, signs the JWS, and
sets it only on the isolated preview origin. The browser does not and cannot
send its production staff cookie to `previewOrigin`. A successful exchange
returns a trusted no-store preview-origin HTML activation bridge with only a
relative `continuePath` of
`/__np/view/<previewId>/<launchId>/<canonical-route-encoding>`. A
framework-owned nonce script performs `location.replace(continuePath)` and a
plain same-origin link is the fallback; neither contains a secret. This
same-origin second navigation makes the new `SameSite=Strict` cookie usable
without weakening it for the cross-site exchange request. The activation
bridge has `default-src 'none'; script-src 'nonce-<nonce>'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'`, plus the common no-store,
no-referrer, nosniff, and noindex headers.

The cookie name is exactly
`__Secure-np-preview-<previewId-without-hyphens>` and its value is the compact
JWS. The exact header is:

```text
Set-Cookie: __Secure-np-preview-<previewIdWithoutHyphens>=<JWS>; Path=/__np/view/<previewId>/; Max-Age=<1..300>; Expires=<IMF-fixdate>; Secure; HttpOnly; SameSite=Strict
```

`Domain` is absent. Expiry ends no later than the JWS expiry. Invalidating or
closing a launch sends the same cookie name/path with an empty value,
`Max-Age=0`, `Expires=Thu, 01 Jan 1970 00:00:00 GMT`, and the same final three
attributes. Per-preview names and paths allow multiple preview tabs without a
site-global cookie overwrite and prevent the cookie from reaching the launch
exchange, deployment-global immutable static assets, Admin, Agent API, or
another preview id. Any overlay-specific media/asset route lives under the
same viewer prefix and repeats the complete launch/visibility check; it is not
an unprotected static route.

A preview permits at most 20 unexpired `exchange_pending` plus `active`
viewer-launch rows after expired-row pruning. Further distinct sessions
receive the existing `RATE_LIMITED` envelope with
`details.reasonCode:"PREVIEW_VIEWER_LIMIT"` and `Retry-After` equal to the
earliest pending/active expiry rather than evicting a reviewer. Concurrent
same-session launches serialize on the session-scoped unique key; only the
winning generation can exchange or view. Logout, cancel, edit, preview expiry,
or site deletion invalidates the applicable session/all rows through
mandatory live checks.

Launch is an AP-001 Admin mutation and the third explicit one-time-output
idempotency exception. The first result persists invocation id, request hash,
launch id/generation, exchange verifier metadata, fixed `iat`/`exp`, and
redacted path—never the exchange plaintext or JWS. Repeating the same key/hash
returns the typed `ONE_TIME_VALUE_ALREADY_ISSUED` conflict with the safe
preview/launch id and new-launch recovery operation; a different hash is the
ordinary idempotency conflict. A lost, expired, consumed, or superseded
exchange therefore requires a new idempotency key/generation and never
re-signs or reissues authority. `PREVIEW_LAUNCH_EXPIRED` is used when an
existing viewer path/cookie resolves a non-active or expired row, not to
replay the one-time launch response.

The token is forbidden in URL/query/fragment, referrer, log, audit payload,
analytics, or screenshot metadata. It is never standalone authorization:
every view request presents the preview-origin cookie and the host loads the
launch row's current production staff session server-side; no production
cookie is required or accepted. The host recomputes the viewer fields,
requires a byte-equal claim, then rechecks the existing human capability
equivalent of `changeset:read` plus current visibility for every target before
revealing whether the route exists. It also requires the preview to remain
`ready`, its plan/routes digest to match, and the requested canonical route to
be in the set. Logout, user suspension, staff token-version change,
membership/role/capability loss, plan edit, preview expiry, route-audience
change, or target-visibility change fails closed.
`userTokenVersion` comes from `np_users` and
`siteAuthorizationDigest` hashes the current site, super-admin flag or
persisted membership/default-site role, and derived capability set. For a
machine principal, interactive launch is unavailable; MCP/Agent clients read
authenticated artifact resources with their ordinary audience-bound
credential and current visibility checks. There is no invented generic
authority counter.
A copied URL therefore carries no authority and grants nothing to another
browser/account. Proposed preview markup is same-origin only with the isolated
preview service; it cannot passively load a production Admin/API/private route
with ambient staff cookies.

The Next host validates the token, enters a `withAgentChangeSetPreview()`
async-local scope, and uses a read-only overlay resolver:

```text
normal collection/navigation/settings read
  → resolve current canonical resource
  → find matching sealed ChangeSet operation
  → apply validated in-memory overlay
  → render through normal theme/block/SEO paths
```

Preview never mutates collection rows, revisions, settings, navigation, media
refs, search indexes, or caches. Hooks that normally create external effects
receive preview intent and must be skipped or use an explicit pure preview
contract.

Screenshot workers do not reuse a viewer token or browser session:

```ts
interface NpAgentPreviewRenderTokenClaimsV1 {
  schemaVersion: "np.agent-preview-render-token.v1";
  intent: "render";
  issuer: string;
  audience: "urn:nexpress:preview-render";
  siteId: string;
  previewId: string;
  generation: number;
  planHash: string;
  allowedRoutesDigest: string;
  previewContractFingerprint: string;
  renderAttemptId: string;
  renderSessionId: string;
  jti: string;
  iat: number;
  exp: number;
}
```

The compact token travels only in `X-Np-Preview-Render`; its protected header
is exactly `{alg:"EdDSA",typ:"np-preview-render+jwt",kid}`. Issuer is the
canonical internal preview origin, numeric dates are integer seconds, maximum
lifetime is two minutes, and skew is 60 seconds. Unknown/duplicate claims or
headers fail. `renderSessionId` is a host-allocated canonical lowercase UUID
persisted with the render attempt before token mint, so the worker can bind
ticket digests without choosing session identity. The same dedicated preview
keyring retains verification keys until the last viewer/render token expiry
plus skew; premature absence blocks rendering and raises Doctor.

The header authorizes exactly one loopback
`POST /__np/preview/render-bootstrap`. That transaction locks the preview
attempt, consumes its stored `jti` once by compare-and-swap, and creates one
`np_agent_preview_render_sessions` child. The server derives the complete
sorted capture plan from the frozen preview and accepts only this exact
worker input:

```ts
interface NpAgentPreviewRenderBootstrapInputV1 {
  schemaVersion: "np.agent-preview-render-bootstrap-input.v1";
  renderAttemptId: string;
  tickets: Array<{
    ordinal: number;
    ticketDigest: string;
    ticketKeyId: string;
  }>;
}
```

There must be exactly one entry for every server-derived ordinal, in ascending
order, no extra/missing/duplicate ordinal or key/digest field, and the
standalone key id must equal the id embedded in `ticketDigest`. The worker
cannot choose a route, locale, audience, viewport, or capture count. Before
bootstrap it generates one independent 32-byte ticket per ordinal, stores
plaintext only in ephemeral process memory, and sends the keyed digests. Each
digest is exactly
`ctv1:hmac-sha256:<keyId>:<43-character-unpadded-base64url>` under a dedicated
capture-ticket HMAC keyring over u32be-length-framed byte strings
`("np-agent-preview-capture-ticket/v1",siteId,previewId,renderSessionId,
renderAttemptId,decimalOrdinal,ticketBytes)`. The host persists both digest
and key id and compares in constant time. Capture keys remain until every
render-session row naming them is terminal and outside retention.

The frozen capture plan has at most 20 sorted entries:
`{ordinal,route,locale,audience:"public",viewportName,width,height,
deviceScaleFactor,captureTicketDigest,captureTicketKeyId}`. The row also
freezes site/preview/generation/plan, allowed-routes digest, render-attempt id,
preview-contract fingerprint, expiry, and a hash-only 32-byte random cookie
verifier. It returns no bearer body. Bootstrap is a `204` over an ephemeral
`https://127.0.0.1:<random-port>` listener bound only to loopback. Each attempt
uses a fresh TLS key/certificate with the IP SAN; the worker launches its
isolated Chromium context with only that certificate's frozen SPKI hash
trusted. Failure to bind loopback, verify peer/SPKI, or establish TLS fails
the attempt—there is no HTTP or ignore-all-certificate-errors fallback.

The cookie name is exactly `np-preview-render` and its value is
`nprc1_<canonical-lowercase-session-uuid>_<43-character-unpadded-base64url>`
from 32 random bytes. Only the public session id is parsed before verification.
The row stores
`rcv1:hmac-sha256:<keyId>:<43-character-unpadded-base64url>`, computed under a
dedicated render-cookie HMAC key over u32be-length-framed raw bytes
`("np-agent-preview-render-cookie/v1",siteId,previewId,renderSessionId,
secretBytes)`. Replicas compare it in constant time. The bootstrap's exact
header is:

```text
Set-Cookie: np-preview-render=<value>; Path=/__np/preview/render-route/<renderSessionId>/; Max-Age=<1..120>; Expires=<IMF-fixdate>; Secure; HttpOnly; SameSite=Strict
```

`Expires`/`Max-Age` end no later than the render-token expiry and `Domain` is
absent. Completion/failure/expiry returns the same path with empty value,
`Max-Age=0`, `Expires=Thu, 01 Jan 1970 00:00:00 GMT`, and the same final three
attributes. The HMAC key remains until every session row that names it is
terminal and past render-session retention.

Each subsequent browser navigation uses only
`GET /__np/preview/render-route/<renderSessionId>/<captureOrdinal>`. The host
locks the session, verifies the hashed cookie and unexpired attempt, and
requires all of:

```text
Sec-Fetch-Site: none | same-origin
Sec-Fetch-Mode: navigate
Sec-Fetch-Dest: document
X-Np-Preview-Capture: npct1_<captureOrdinal>_<43-char-base64url-ticket>
```

The renderer arms one exact main-frame/ordinal immediately before its
framework-owned navigation, injects that ticket only for that request, and
disarms before parsing returned HTML. The server HMAC-verifies the ticket with
the frozen key/digest input above, then reparses the exact capture tuple,
rechecks the current route still has public audience, and CAS-marks that
ordinal consumed before returning overlay HTML. Raw tickets never enter
logs, traces, metrics, audit, crash reports, persisted job payloads, or
artifact metadata and are zeroized after success and on every pre/post-CAS
failure path. Image, style, font, fetch/XHR, iframe, meta-refresh, worker,
prefetch, unarmed main-frame, and missing/duplicate Fetch Metadata/header
requests fail without consuming another ordinal. Proposed content cannot
observe the ticket.

An ordinal is usable once; an undeclared/repeated route or viewport fails.
Static assets live outside the cookie path, so the cookie is never attached to
ordinary subresource requests. Completion/abort/expiry closes the row and
clears the cookie; a failed consumed capture requires a new attempt/session,
never reactivation. Cancellation/preview expiry invalidates both bootstrap
and session rows synchronously.

The `X-Np-Preview-Render` header is therefore used only for bootstrap and is
never forwarded to a browser navigation/subrequest or logged. Neither it nor
the scoped render cookie has ChangeSet, MCP, Admin, or external-network bearer
authority.

Rendering and link inspection use two closed network boundaries. The browser
renderer may request only the exact random-loopback preview origin and
generated same-origin asset paths; it receives no ambient cookie,
Authorization header, provider credential, or unrestricted proxy, and all
external subresources are blocked.

Link checking does not provide an open-web fetch primitive. Same-site links
are checked against the canonical route/locale manifest and preview route
resolver without HTTP. An external link receives syntax/scheme/credential
validation only and is reported `external-unverified` unless its exact
queryless HTTPS origin is in a deployment-owned, code/config-reviewed preview
allowlist. Only those allowlisted links may receive one credentialless HEAD
request: at most 100 unique links, concurrency four, five seconds each, no
body, no redirect, default port only, and no query/fragment. The worker strips
all caller headers, resolves and pins DNS, and rejects any literal/resolved
loopback/private/link-local/multicast/unspecified/reserved/CGNAT/metadata
address in IPv4 or IPv6. A model/caller cannot extend the allowlist or choose
method, headers, body, redirect, recipient, or result consumer. `http:`,
`file:`, `data:`, `javascript:`, alternate encodings, credentials in URLs,
action/unsubscribe-looking query links, and DNS-rebinding attempts become
bounded check issues and are never fetched.

Every preview HTML/artifact response sets `Cache-Control: private, no-store`,
`Pragma: no-cache`, `X-Robots-Tag: noindex, nofollow, noarchive`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and the
exact `npAgentChangeSetPreviewCsp(nonce)` bytes, in this order:
`default-src 'none'; script-src 'nonce-<nonce>'; style-src 'self'
'nonce-<nonce>'; img-src 'self'; font-src 'self'; media-src 'self';
connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors
'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action
'none'`. The response creates a fresh cryptographic nonce, applies it only to
framework/theme-owned script/style tags, and never exposes it to proposed
content or model output. Unknown directives/sources and
`unsafe-inline`/`unsafe-eval` are forbidden. Artifact responses also set a safe
header from the shared `npAgentPreviewArtifactHeaders()` builder. Artifact ids
are canonical lowercase UUIDs and never appear without validation. The exact
additional bytes are:

```text
image/png       Content-Type: image/png
                Content-Disposition: inline; filename="np-preview-<artifactId>.png"
image/webp      Content-Type: image/webp
                Content-Disposition: inline; filename="np-preview-<artifactId>.webp"
application/json Content-Type: application/json; charset=utf-8
                 Content-Disposition: attachment; filename="np-preview-<artifactId>.json"
all             Content-Length: <canonical unsigned decimal byte size>
                ETag: "<contentDigest>"
```

`filename*`, caller/model/route text, CR/LF, percent encoding, and any other
parameter are absent. The builder also emits the common headers/CSP above in
their frozen order. Range and conditional write semantics are unsupported;
`If-None-Match` may return `304` only after the complete live authorization
and storage metadata/integrity preflight, and never turns an ETag into
authority.

Screenshots/reports are private objects and are never exposed by storage-signed
bearer URLs. Clients receive an authenticated NexPress artifact reference;
the proxy repeats current viewer authorization, target visibility, preview
state/expiry, artifact `object_state=ready`, storage presence, id/digest/MIME/
size/report-part, and site checks before streaming with the headers above. MCP
returns that resource reference, not a download capability.
Artifacts are not embedded unbounded in MCP results. If screenshots are
unavailable, the preview may still be ready with a stable warning unless
active policy requires visual evidence for the affected risk class.

Each preview attempt and artifact uses the site-owned rows in
[data-model.md](data-model.md): generation state is bound to the sealed
`planHash`, artifact metadata stores a digest and opaque storage key, and the
authenticated proxy resolves it only after current authorization.
Before any object write, the worker completes the bounded byte set in a
private local spool. One transaction then freezes its exact count and `aus1`
set digest and preallocates every `absent` artifact plus its exact `aur1`
upload-journal row with the frozen adapter triple, deterministic opaque key,
expected bytes/MIME/content digest, and stable idempotency identity. A
missing/unreserved planned artifact therefore cannot masquerade as a complete
set. The worker writes only under those rows and requires the adapter to
resolve each operation authoritatively as
`committed|not_started|failed_no_effect`; `pending|unknown` never becomes safe
because a deadline elapsed. A committed object is read back through the same
bounded adapter facet before CAS-recording the verified outcome.
Crash/lost-ack recovery inspects that exact operation identity; it never
invents a second key or blindly repeats bytes no longer available. Only one
transaction that sees the complete count/digest-matching server-derived set
as verified moves all rows `absent→ready`, stores immutable common expiry and
the recomputed manifest digest, and marks the preview ready. Report-only or
empty-warning output follows the same branch without requiring a render
session. Thus a partial/under-counted set is never readable, and a failed or
site-deleting generation can only converge toward deletion.
Screenshot/report objects expire exactly with the preview, no later than
seven days after completion. Editing or resealing the plan makes
an older preview ineligible for approval even if its object has not yet been
pruned.

Preview generation persists and rechecks the same admitting-invocation
authority contract as validation before overlay resolution, safe fetch, or
artifact creation. `AUTHORITY_REVOKED` produces no partial artifact and does
not fall back to the ChangeSet creator.

A successful preview sets
`expiresAt = min(changeSet.expiresAt, completedAt + 604_800_000 ms)`. Every
artifact object's `objectExpiresAt` is byte-equal to that preview expiry;
metadata remains under the longer audit-retention rule. Preview-required
approval creation requires at least five minutes of remaining preview/object
lifetime and sets `approval.expiresAt <= preview.expiresAt`. Policy may
shorten either deadline but cannot extend or detach them.

When an approval statement has `requiresLivePreview=true`, it binds both
`previewId` and the manifest `previewDigest`. Approval decision, schedule, and
apply recheck that the exact preview is still `ready`, unexpired, bound to the
same plan/contract fingerprint, and that every manifest object remains
`ready`, present, and digest-valid. Expiry, deletion backlog, or integrity
failure atomically revokes an unconsumed approval with
`target_invalidated/PREVIEW_REQUIRED`, returns the sealed ChangeSet to `ready`
when unscheduled, and requires a new preview plus new approval generation.
V1 never treats retained metadata/digests alone as live visual evidence.

### 9.2 Approval display integrity

Admin renders resource ids, current/proposed values, operation counts, risk,
scopes, and plan hash from structured server fields. Model-supplied title,
summary, reasons, document content, Markdown, and remote evidence are escaped
and visually labelled as untrusted/generated. They cannot add buttons, hide
warnings, choose colors, or construct confirmation text.

## 10. Approval

V1 `changeset.schedule`, `changeset.apply`, and rollback execution always
require a human approval. Rollback preparation and approval request do not
execute compensation. Sensitive/destructive approval always requires the
shared recent `staff-primary` reauthentication (maximum age 300 seconds);
policy may shorten the age. The following conditions may additionally require
a narrower approver set, the same reauthentication for otherwise reversible
risk, or a fresh preview:

- the effective policy says so;
- risk is above the principal's unattended threshold;
- a public publish/archive operation is present;
- a protected setting/navigation location/collection is touched;
- the operation count or projected impact exceeds a bound;
- rollback evidence is incomplete;
- the capability itself always requires a human.

The approver must have site access and the existing human capability required
for the underlying action. Agent scopes do not grant staff approval power.
The one-time typed decision challenge confirms intent and never substitutes
for the recent reauthentication required by the signed approval statement.

The exact `requestApproval()` service accepts ChangeSet id, sealed version/
`planHash`, intended operation (`schedule` or `apply`), optional canonical
`scheduledFor`, and a caller-stable idempotency key. It rechecks current
validation/preview, expiry, base versions, derived Agent scopes, required human
capabilities, risk, and policy; then creates or returns the identical unexpired
pending approval and moves `ready` to `approval_pending`. A different intended
operation, time, hash, or evidence requires a different statement. Admin calls
it through `/request-approval`. An external `changeset.schedule`/`.apply`
invocation without a valid approved statement calls the same service and
returns `approval_required`; the follow-up invocation must present the exact
`approvalId` and a new idempotency key. It never treats the first call as
approval.

All target kinds use one canonical approval challenge/decision service and the
generic Admin
`/api/admin/agents/approvals/{approvalId}/decision-challenge` plus
`approve|reject|revoke` routes. The closed challenge and decision inputs are
the exact `NpAgentApprovalChallengeRequestV1` and
`NpAgentApprovalDecisionInputV1` contracts in
[security-and-credentials.md](security-and-credentials.md), including
approval version and challenge generation. The server derives target kind and
target ids from the approval row. There are no ChangeSet-specific decision
routes and no caller-supplied target-kind switch.

Approval transaction:

1. lock ChangeSet and approval rows;
2. check site, target, plan hash, state, expiry, and approver capability;
3. record `approved` or `rejected` with bounded reason;
4. mirror the decision to normal audit;
5. move the ChangeSet state.

Approval is single-use. Execution checks and consumes it inside the apply
transaction. Scheduling does not consume it early and rejects a
`scheduledFor` that is not safely before approval expiry and, when
`requiresLivePreview=true`, the bound preview/object expiry. If queue delay or
clock passage still leaves either evidence boundary expired at execution, the
job performs no writes and moves to `apply_failed` with `APPROVAL_EXPIRED` or
`PREVIEW_REQUIRED`; the operator re-previews/revalidates the unchanged plan
and obtains a new approval generation rather than reviving the immutable
failed execution.

Approval-dependent transitions are exact and happen in the same transaction
as the approval decision/reconciliation:

- rejecting a pending ChangeSet approval moves the parent to `rejected`;
- expiry or revocation of a pending/approved, unscheduled approval moves the
  still-sealed parent from `approval_pending`/`approved` back to `ready`;
- a later request for that unchanged sealed plan creates the next positive
  approval generation; it never revives a terminal approval row;
- expiry or revocation after the parent is `scheduled` moves the parent to
  `apply_failed` with `APPROVAL_EXPIRED` or `APPROVAL_REVOKED` and cancels the
  queued admission without writing domain data.

Synchronous schedule/apply checks enforce the same outcomes; bounded
site-retention reconciliation terminalizes abandoned expired rows, so safety
does not depend on its cadence.

`cancelChangeSet()` is the only cancellation transition. It accepts expected
state/version, bounded human reason/reason code, and idempotency key; permits
only `draft`, `invalid`, `ready`, `approval_pending`, `approved`, or
`scheduled`; revokes an unconsumed approval and the exact scheduled job
admission in the same transaction; and moves to `cancelled`. Once an apply/
rollback transaction begins, cancellation cannot rewrite state and the
executor uses only its separately declared cooperative pre-commit boundary.
If that executor observes cancellation after entering `applying` but before
the domain transaction starts, it marks the execution reservation `failed`,
revokes the unconsumed approval, and moves the parent to `apply_failed` with
`EXECUTION_CANCELLED`. During rollback, the same boundary moves the rollback
plan to `failed`, the parent to `rollback_failed`, and records
`EXECUTION_CANCELLED`. After the domain transaction starts, cancellation is
too late and verification/explicit rollback is the only recovery path.

## 11. Scheduling

`changeset.schedule` requires an unexpired `approved` plan. The canonical
future UTC timestamp is stored and an exact job is enqueued:

```ts
interface NpAgentChangeSetApplyJobPayload {
  siteId: string;
  changeSetId: string;
  planHash: string;
  approvalId: string;
  scheduledFor: string | null;
  idempotencyKey: string;
}
```

Immediate apply uses `scheduledFor: null`; scheduled apply uses the exact
stored canonical UTC value. The worker resolves `siteId` from the payload,
enters site execution context, and performs the complete authorization/base/
approval/policy/idempotency recheck. A stale base never becomes an automatic
rebase. It produces `apply_failed` with stable conflict evidence and notifies
the operator.

## 12. Apply and atomicity

`changeset.apply` is the only commit/publish verb. There is no separate
`changeset.publish` capability.

Before the database transaction:

- for a machine-created plan, verify the current principal, optional Runtime
  Agent/version, provider-independent execution scopes, and narrower current
  policy;
- for a staff-created plan, require no fabricated principal and do not treat
  the original creator as execution authority; the approval decision is the
  human authorization record, while the route caller is independently checked
  only when a live Admin request exists;
- for both branches, verify site runtime intent, emergency-pause effect,
  current server-derived approval requirements, approval integrity MACs, and
  plan hash;
- when the approval binds live preview evidence, lock the exact preview and
  require its ready/unexpired manifest plus every ready, present,
  digest-verified object;
- stage any already-authorized media objects without making them publicly
  referenced;
- acquire the per-site ChangeSet admission/advisory lock.

Inside one database transaction:

1. lock the ChangeSet and approval;
2. recheck state, base fingerprints, policy versions/hashes, quotas, approval
   state/integrity, and the unchanged server-derived human-capability set;
3. reserve the execution idempotency key;
4. call transaction-aware existing collection, navigation, setting, theme,
   and media-reference services in canonical operation order;
5. create normal revisions and audit events;
6. persist per-operation after hashes and rollback snapshots;
7. consume approval;
8. set the execution `committedAt`, derive
   `rollbackEligibleUntil = committedAt + sealed rollbackWindowSeconds`, and
   reject rather than clamp if the currently resolved policy/hash no longer
   equals the sealed policy facts;
9. mark the ChangeSet `applied` in the same commit.

If any database operation fails, the complete transaction rolls back and the
outer executor records `apply_failed` without claiming partial success.

After commit:

- drain normal post-commit hooks/jobs;
- invalidate exact caches;
- enqueue search/media convergence work;
- mark staged objects referenced or clean unused staging;
- move to `verifying`.

Object storage, email, webhooks, CDN purges, analytics, and search adapters are
not transactionally atomic with Postgres. Their bounded results are recorded.
Required convergence failures produce `verification_failed` and remediation;
they never rewrite the database commit as if it did not happen.

### 12.1 Crash recovery

The mutation rows, `np_agent_changeset_executions` reservation, per-operation
after hashes, approval consumption, and `applied` state commit together. On
retry:

- `applying` with no committed execution reservation is safe to restart;
- a committed reservation plus applied hashes resumes post-commit verification;
- mismatched or ambiguous rows fail closed and reach Doctor;
- the same idempotency key never replays the writes.

## 13. Verification

Verification compares persisted and public/runtime results with the sealed
plan:

- resource after hashes and statuses;
- revision/audit creation;
- route availability and visibility;
- navigation and theme resolution;
- cache/search convergence;
- media-reference and object readiness;
- optional screenshot and link/SEO/accessibility checks;
- required notification/adapter results.

Every check has stable id, severity, status, evidence references, and suggested
next action. Passing required checks moves to `verified`. Required failure moves
to `verification_failed`; advisory warnings may still produce `verified` with
attention.

Verification failure may prepare and validate a bounded rollback proposal
automatically, but v1 rollback execution always requires a fresh human approval
bound to that compensation plan. A runbook cannot lower the
capability's locked approval floor.

## 14. Rollback

Rollback is a forward compensation, consistent with document revision restore.
It never deletes revisions or rewinds audit history.

### 14.1 Total operation compensation map

Validation classifies every operation as `full`, `residual`, or `unavailable`
using this closed mapping:

| Original operation     | Forward compensation derived only from before snapshot/current after hash          | Class and residual rule                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| document `create`      | archive/unpublish the exact created document at its applied version                | `residual`: row, revisions, audit, media object, and externally delivered effects remain |
| document `update`      | restore the complete prior document/status through normal revisioned update        | `full` when current row equals applied after hash                                        |
| document `publish`     | restore prior status, content, and publish metadata                                | `full`; delivered feed/email/webhook copies are external residual warnings               |
| document `archive`     | restore prior status/content from snapshot                                         | `full` when collection still supports that stored state                                  |
| document `schedule`    | restore prior schedule/status, including explicit absence                          | `full` only when current state equals the applied after hash                             |
| navigation `replace`   | replace with the exact previous tree                                               | `full`                                                                                   |
| theme tokens `replace` | restore previous override, or remove it when it was previously absent              | `full`; CDN/browser caches are convergence evidence, not snapshot state                  |
| setting `replace`      | restore previous value, or remove the key when previously absent                   | `full` for the closed mutable-setting inventory                                          |
| setting `remove`       | restore the exact previous value                                                   | `full`                                                                                   |
| media ref `attach`     | detach only the exact relation created by this plan                                | `full` for the reference; uploaded binary/object delivery may remain as a residual       |
| media ref `detach`     | reattach the exact previous relation if the media row remains active and same-site | `full` when available; otherwise `unavailable`                                           |

The before snapshot records explicit presence/absence, prior status/schedule,
and every internal input needed by this table. No compensation is inferred
from a digest. A collection that cannot represent the mapped prior state, a
missing detached media row, an expired snapshot, or a changed current target
is `unavailable`. Validation emits `ROLLBACK_UNAVAILABLE` as a blocking error
for an unavailable operation. `residual` is permitted only with
`reversible:false`, `ROLLBACK_PARTIAL`, a visible residual list, and the
already mandatory human apply approval. Permanent delete is not a v1
operation. External email/webhook/feed/CDN/search copies never become a
fictional database rollback; they are listed and verified as residual or
convergence work.

### 14.2 Plan, approval, and execution

Rollback uses three exact services rather than one ambiguous
`changeset.rollback` side effect:

- `prepareRollback(changeSetId, idempotencyKey)` creates or returns
  one bounded rollback-plan generation;
- `requestRollbackApproval(changeSetId, rollbackPlanId, planHash,
idempotencyKey)` creates or returns an approval whose target is exactly that
  rollback plan/hash;
- `executeRollback(changeSetId, rollbackPlanId, planHash, approvalId,
idempotencyKey)` consumes the approved statement and admits execution.

Preparation:

1. persists the admitting invocation/authority reference on the new
   generation, then re-resolves that current authority and rollback scope plus
   every target's visibility; loss yields `AUTHORITY_REVOKED` and no plan;
2. loads exact before and after hashes;
3. verifies `rollback_eligible_until` has not passed and every required before
   snapshot body still exists;
4. proves each current resource still equals the ChangeSet's applied after
   state;
5. creates a new `np_agent_changeset_rollback_plans` generation and ordered
   rollback-operation rows linked to the original ChangeSet/operations;
6. validates current schemas, ownership, quotas, and policy;
7. seals an independent
   `{schemaVersion:"np.agent-changeset-plan.v1",planKind:"rollback",...}`
   canonical body, `planHash`, base fingerprint, validation generation, risk,
   exact scopes/human requirements/policy hashes, and absolute expiry.

The operator or machine caller then requests the fresh rollback approval.
After a human decides it through the canonical approval route, execution
compare-and-swaps the rollback plan to `executing` and the parent ChangeSet to
`rolling_back`, then applies through the same transaction and verification
path. A changed plan hash, expired approval, or mismatched rollback-plan id
performs no write.

Only one non-terminal rollback-plan generation may exist for a ChangeSet.
Preparing an invalid/conflicted plan leaves the parent ChangeSet in its prior
`applied`, `verified`, or `verification_failed` state. A successful verified
plan moves both the plan to `verified` and parent to `rolled_back`; execution
or verification failure moves the plan to `failed` and parent to
`rollback_failed`. Expiry moves only the plan to `expired`. The original
operation plan, apply result, snapshots, approval, and audit rows remain
immutable history. Approval rejection, revocation, or operator cancellation
moves a non-executing rollback plan to `failed` with
`approval_rejected`, `approval_revoked`, or `operator_cancelled` and leaves the
parent applied state unchanged. Approval/plan expiry moves only the plan to
`expired` with `approval_expired` or `snapshot_expired`. These terminal states
release the one-nonterminal-generation constraint; a later request creates a
fresh generation and fresh approval if the rollback window and current bases
still permit it. No terminal approval or rollback plan is revived.

If any resource changed after the original apply, rollback reports a conflict
and records the rollback plan as `conflicted`; it does not overwrite later
work. The operator can create a selective manual ChangeSet based on current
state.

After the bounded rollback window, the API returns the exact
`snapshot_expired` unavailable reason and never attempts compensation from a
digest, retained body, or stale preview. Exact snapshot reconstruction bodies
remain with their hashes for the full dependency-closed ChangeSet evidence
lifetime; they are pruned only in the same transaction as the terminal
ChangeSet closure and its last owning canonical-hash references. Retention of
the body is audit integrity, not continuing rollback authority.

Media object deletion, third-party messages, completed webhook delivery, and
external indexing cannot be promised reversible. Rollback removes/restores
NexPress references and records explicit residual-side-effect warnings.

## 15. Direct bounded capabilities

Not every low-latency safety response waits for a multi-resource ChangeSet.
The following canonical v1 capabilities may create direct actions when active
policy explicitly allows their exact target, threshold, and approval mode:

- `moderation.quarantine`;
- `moderation.restore`;
- `security.limitActor` with a short bounded expiry;
- `security.revokeSessions` for one exact actor/session family, with human
  approval.

These still require exact scopes, idempotency, server risk, normal audit, and
verification. Quarantine and temporary restriction are compensatable/
expiring. `moderation.restore` is a sensitive, human-approved compensation
that is not itself treated as guarded-reversible; re-quarantine requires a new
proposal. Session revocation is intentionally non-reversible and never
unattended. Quarantine/temporary restriction returns the shared opaque
`containmentId`; content restore accepts only that id plus expected version
and links its action to the exact source action. Active containment keeps its
source/restore actions, approvals, incident attribution, and original-state
material until terminal restoration/expiry and the dependency-closed
retention deadline.

Approval decisions terminalize their dependents atomically. Approval moves the
action from `approval_pending` to `approved` while a linked run remains
`waiting_approval` until the separate `execute_approved` invocation arrives.
Reject, revoke, or expiry moves the action to `failed` with
`APPROVAL_REJECTED`, `APPROVAL_REVOKED`, or `APPROVAL_EXPIRED`; a linked run
still in `waiting_approval` moves to `failed` with the same reason. The later
approved invocation cannot revive the original MCP task and cannot execute a
terminal action. A new attempt creates a new action, approval generation, and
invocation rather than rewriting history.

Incident state transitions and pausing an Agent/trigger remain authenticated
system or Admin management operations, not extra Agent Gateway capability ids.
Permanent bans, deletion, broad IP blocks, global job pause, plugin disable,
storage migration, restore, and migration remain approval/ops-plan work.

## 16. API and MCP projection

Admin/API routes should expose:

```text
GET    /api/admin/agents/changesets
POST   /api/admin/agents/changesets
GET    /api/admin/agents/changesets/{id}
PATCH  /api/admin/agents/changesets/{id}           # draft only
POST   /api/admin/agents/changesets/{id}/validate
POST   /api/admin/agents/changesets/{id}/preview
POST   /api/admin/agents/changesets/{id}/previews/{previewId}/launch
POST   /api/admin/agents/changesets/{id}/request-approval
POST   /api/admin/agents/changesets/{id}/cancel
POST   /api/admin/agents/changesets/{id}/schedule
POST   /api/admin/agents/changesets/{id}/apply
POST   /api/admin/agents/changesets/{id}/rollback-plans
POST   /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/request-approval
POST   /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/execute
POST   /api/admin/agents/approvals/{approvalId}/decision-challenge
POST   /api/admin/agents/approvals/{approvalId}/approve
POST   /api/admin/agents/approvals/{approvalId}/reject
POST   /api/admin/agents/approvals/{approvalId}/revoke
```

External callers receive equivalent bounded capabilities through the Agent
Gateway. Route and MCP handlers are thin adapters over the same service.
Long-running validation, preview, apply, verification, and rollback return an
exact task/run reference rather than holding an HTTP or MCP request open.

Every error uses the shared client-safe API envelope. V1 adds no competing
top-level status/code mapping: it reuses `FORBIDDEN` for missing scope/policy,
`CONFLICT` for state/base/hash/expiry/replay conflicts, `RATE_LIMITED` for hard
budget admission, and `SERVICE_UNAVAILABLE` for required dependencies.
`approval_required` is a successful typed invocation state, not an API error.

The existing bounded `details` contract gains one exact `reasonCode` union:
`AGENT_SCOPE_REQUIRED`, `AGENT_POLICY_BLOCKED`,
`CHANGESET_STATE_CONFLICT`, `CHANGESET_BASE_CONFLICT`,
`CHANGESET_PLAN_CHANGED`, `CHANGESET_EXPIRED`, `APPROVAL_EXPIRED`,
`APPROVAL_REVOKED`, `APPROVAL_REJECTED`, `APPROVAL_CONSUMED`,
`EXECUTION_CANCELLED`, `PREVIEW_REQUIRED`, `PREVIEW_LAUNCH_EXPIRED`,
`PREVIEW_VIEWER_LIMIT`, or `AGENT_BUDGET_EXCEEDED`.
Each reason has one fixed parent code/status verified in
`@nexpress/core/api-contract`; callers branch on the top-level code plus this
reason, never message text.

| Reason code                                                                                             | Existing top-level code / HTTP status |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `AGENT_SCOPE_REQUIRED`, `AGENT_POLICY_BLOCKED`                                                          | `FORBIDDEN` / 403                     |
| `CHANGESET_STATE_CONFLICT`, `CHANGESET_BASE_CONFLICT`, `CHANGESET_PLAN_CHANGED`, `CHANGESET_EXPIRED`    | `CONFLICT` / 409                      |
| `APPROVAL_EXPIRED`, `APPROVAL_REVOKED`, `APPROVAL_REJECTED`, `APPROVAL_CONSUMED`, `EXECUTION_CANCELLED` | `CONFLICT` / 409                      |
| `PREVIEW_REQUIRED`, `PREVIEW_LAUNCH_EXPIRED`                                                            | `CONFLICT` / 409                      |
| `PREVIEW_VIEWER_LIMIT`, `AGENT_BUDGET_EXCEEDED`                                                         | `RATE_LIMITED` / 429                  |

`PREVIEW_VIEWER_LIMIT` always includes an integer `Retry-After` header to the
earliest unexpired `exchange_pending|active` viewer-launch expiry. OpenAPI and
generated clients expose these two details reasons under their fixed parent
envelopes.

## 17. Doctor, health, and deletion

`agents.contract` checks:

- exact ChangeSet/operation/approval row shapes;
- valid state transitions and timestamp consistency;
- plan/base hash presence by state;
- operation ordering and resource schemas;
- cross-site ids and orphan principals/runs/jobs;
- approval target/hash/expiry/consumption;
- applied operations missing revisions/audit/after hashes;
- stale `applying`, `verifying`, or `rolling_back` states;
- rollback snapshot availability inside the promised window;
- preview expiry, plan/route/contract/manifest fingerprint consistency and
  public-audience route canonicalization;
- artifact count, ordinal, MIME/size/content digest, report-part continuity,
  object-state/timestamp/receipt, object-presence, and orphan/cross-site
  invariants;
- row-first artifact-upload owner/request-digest/key/adapter binding,
  full-set count/`aus1` reservation, `auo1` terminal-operation resolution,
  state/lease/deadline/attempt consistency, read-back observation, manifest
  all-or-nothing finalization, late-write fencing, immutable finalized expiry,
  and 365-day terminal retention;
- isolated preview-origin configuration, including distinct registrable
  domain, closed route inventory, no Admin/API proxy, and exact response/CSP
  builders;
- viewer-launch generation/state/timestamps, one-time exchange
  verifier/consumption, staff-session/fingerprint/site-authorization binding,
  signing/HMAC key availability, per-preview cap, and dynamic cookie
  name/path;
- render attempt/JTI/session uniqueness, bootstrap plan equality,
  render-cookie verifier, consumed bitset, capture-ticket digest/key,
  loopback-TLS/SPKI policy, expiry, and all session/capture caps;
- preview-required approval/object freshness and artifact deletion/retention
  backlog.

Admin Health reports counts and oldest age by state, not operation content.
Site deletion follows [data-model.md](data-model.md) and removes approvals and
operation snapshots before principals/connections while admission is paused.

## 18. Acceptance scenarios

The first implementation is not complete until integration tests prove:

1. two concurrent applies against the same base produce one success and one
   zero-write conflict;
2. tampering with one operation after approval invalidates the hash and blocks
   execution;
3. an expired/revoked approval is rejected inside the apply transaction;
4. a retry after an ambiguous worker response does not duplicate a document,
   revision, media ref, or audit event;
5. a database failure rolls back documents, navigation, settings, revisions,
   refs, approval consumption, and apply state together;
6. a post-commit adapter failure retains the commit and produces exact
   verification/remediation evidence;
7. preview overlays never persist data or fire side effects;
8. rollback refuses to overwrite a resource edited after apply;
9. a principal from another site cannot read, preview, approve, apply, or infer
   the ChangeSet;
10. malicious Markdown/HTML in model text cannot forge the approval UI.
