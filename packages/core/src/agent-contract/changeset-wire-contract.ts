import {
  canonicalBodyPreviewRoute,
  canonicalBodyPreviewLocale,
  canonicalBodyQuerylessHttpsOrigin,
} from "./canonical-preview-values.js";
import { npRequireAgentPreviewArtifactManifestCanonical } from "./canonical-preview-artifact.js";
import type { NpCapability } from "../auth/capabilities.js";
import { npCollectionContractLimits } from "../collection-contract/contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodySiteId,
  canonicalBodyCapabilities,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  parseSortedUniqueEnumArray,
} from "./canonical-runtime-primitives.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { npAgentContractLimits, npRequireAgentContractResult } from "./contract.js";
import {
  npRequireAgentChangeSetOperationInput,
  npRequireAgentChangeSetResourceKey,
  npAgentChangeSetOperationMatchesResourceKey,
  npAgentChangeSetOperationInputIncludedKeysV1,
  npAgentChangeSetOperationResourceIncludedKeysV1,
} from "./changeset-contract.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentChangeSetResourceKinds,
  npAgentRiskLevels,
  npAgentRiskReasonCodes,
  npAgentHumanPredicates,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetResourceKeyV1,
  type NpAgentRiskSummary,
  type NpAgentJsonObject,
  type NpAgentContractResult,
} from "./types.js";

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

export type NpAgentChangeSetState = (typeof npAgentChangeSetStates)[number];

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

export interface NpAgentValidationIssueWire {
  code: (typeof npAgentValidationIssueCodes)[number];
  severity: "warning" | "error";
  operationOrdinal: number | null;
  path: string;
  message: string;
  evidenceRefs: string[];
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
  allowedRoutes: Array<{ route: string; locale: string | null; audience: "public" }>;
  diffSummary: NpAgentJsonObject;
  checkSummary: NpAgentJsonObject;
  riskSummary: NpAgentRiskSummary;
  createdAt: string;
  completedAt: string | null;
  safeErrorCode: string | null;
};
export const npAgentPreviewCheckIdsV1 = [
  "broken-links",
  "metadata",
  "structured-data",
  "accessibility",
  "route-collision",
] as const;
export const npAgentPreviewIssueMessagesV1 = Object.freeze({
  ROUTE_NOT_FOUND: "The route is unavailable.",
  EXTERNAL_UNVERIFIED: "The external destination was not checked.",
  EXTERNAL_UNREACHABLE: "The external destination could not be reached.",
  METADATA_MISSING: "Required metadata is missing.",
  METADATA_INVALID: "Metadata is invalid.",
  STRUCTURED_DATA_INVALID: "Structured data is invalid.",
  ACCESSIBILITY_VIOLATION: "An accessibility check failed.",
  ROUTE_COLLISION: "The route conflicts with another route.",
  CHECK_TIMEOUT: "The check did not complete in time.",
});
export type NpAgentPreviewCheckIdV1 = (typeof npAgentPreviewCheckIdsV1)[number];
export type NpAgentPreviewIssueCodeV1 = keyof typeof npAgentPreviewIssueMessagesV1;
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
    route: { route: string; locale: string | null; audience: "public" } | null;
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
    evidenceRefs: Array<{ kind: "artifact" | "operation"; id: string }>;
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

export const npAgentChangeSetLimits = Object.freeze({
  operations: npAgentContractLimits.changeSetOperations,
  collections: npAgentContractLimits.changeSetCollections,
  planBytes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-plan.v1"],
  snapshotBytes: npAgentContractLimits.changeSetSnapshotBytes,
  aggregateSnapshotBytes: npAgentContractLimits.changeSetAggregateSnapshotBytes,
  explanatoryCharacters: npAgentContractLimits.changeSetExplanatoryCharacters,
  validationIssues: 1000,
  previewScreenshots: 20,
  previewHtmlBytes: 5 * 1024 * 1024,
  previewArtifacts: 24,
  previewReports: 4,
  screenshotBytes: 2 * 1024 * 1024,
  reportBytes: 512 * 1024,
  previewLifetimeSeconds: 604800,
  eligibilityDefaultSeconds: 2592000,
  eligibilityMaximumSeconds: 7776000,
  approvalDefaultSeconds: 86400,
  approvalMaximumSeconds: 604800,
  viewerLifetimeSeconds: 300,
  activeViewerLaunches: 20,
  renderLifetimeSeconds: 120,
  rollbackDefaultSeconds: 2592000,
  rollbackMaximumSeconds: 7776000,
  adminProposalCharacters: 262144,
  wireBytes: 8 * 1024 * 1024,
});
export interface NpAgentChangeSetDraftInputV1 {
  title: string;
  summary: string | null;
  operations: NpAgentChangeSetOperationInput[];
}
export type NpAgentChangeSetAdminInputV1<M extends "create" | "update" = "create" | "update"> = {
  idempotencyKey: string;
  proposalJson: string;
  proposalHash: string;
} & (M extends "update" ? { expectedVersion: number } : Record<never, never>);
const INTEGER_MAX = 2147483647;
const state = () => ({ seen: new WeakSet<object>() });
type Parser<T = unknown> = (value: unknown, path: string) => T;
function object<S extends Record<string, Parser>>(
  value: unknown,
  path: string,
  fields: S,
): { [K in keyof S]: ReturnType<S[K]> } {
  const record = canonicalBodyRecord(
    value,
    path,
    Object.keys(fields),
    Object.keys(fields),
    state(),
  );
  return Object.fromEntries(
    Object.entries(fields).map(([key, parser]) => [key, parser(record[key], `${path}.${key}`)]),
  ) as { [K in keyof S]: ReturnType<S[K]> };
}
function list<T>(parser: Parser<T>, maximum: number): Parser<T[]> {
  return (value, path) =>
    canonicalBodyArray(value, path, maximum, state()).map((entry, index) =>
      parser(entry, `${path}[${index}]`),
    );
}
function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return (value, path) => (value === null ? null : parser(value, path));
}
function enumeration<const T extends readonly string[]>(values: T): Parser<T[number]> {
  return (value, path) => canonicalBodyEnum(value, path, new Set(values));
}
function literal<const T extends string>(expected: T): Parser<T> {
  return (value, path) => {
    if (value !== expected) failCanonicalBody("invalid-field", path, `must be ${expected}`);
    return expected;
  };
}
const positive: Parser<number> = (v, p) => canonicalBodyInteger(v, p, 1, INTEGER_MAX);
const natural: Parser<number> = (v, p) => canonicalBodyInteger(v, p, 0, INTEGER_MAX);
const text: Parser<string> = (v, p) =>
  canonicalRuntimeText(v, p, npAgentChangeSetLimits.explanatoryCharacters, { allowEmpty: true });
const title: Parser<string> = (v, p) =>
  canonicalRuntimeText(v, p, npAgentChangeSetLimits.explanatoryCharacters);
const bool: Parser<boolean> = (v, p) => {
  if (typeof v !== "boolean") failCanonicalBody("invalid-field", p, "must be boolean");
  return v;
};
const digest = canonicalBodySha256Digest;
const utc = canonicalBodyUtc;
const uuid = canonicalBodyUuid;
const capabilities: Parser<NpCapability[]> = (v, p) => canonicalBodyCapabilities(v, p, state());
const predicates: Parser<Array<"is-super-admin">> = (v, p) =>
  parseSortedUniqueEnumArray(
    v,
    p,
    new Set(npAgentHumanPredicates),
    npAgentHumanPredicates.length,
    state(),
  );
function clone(value: unknown, path: string, maximumBytes = npAgentChangeSetLimits.wireBytes) {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, {
      maximumDepth: npCollectionContractLimits.jsonDepth + 16,
      maximumNodes: maximumBytes,
      maximumArrayItems: npCollectionContractLimits.arrayRows,
      maximumObjectProperties: npCollectionContractLimits.jsonKeys,
      maximumStringCharacters: npCollectionContractLimits.stringLength,
      maximumCanonicalBytes: maximumBytes,
    }),
    "Invalid ChangeSet wire",
  );
}
function order(start: string, end: string, path: string, maximumSeconds?: number) {
  const delta = Date.parse(end) - Date.parse(start);
  if (delta < 0 || (maximumSeconds !== undefined && delta > maximumSeconds * 1000))
    failCanonicalBody("invalid-field", path, "timestamps must follow their bounded order");
}
function operationsBound(
  operations: readonly { operation: NpAgentChangeSetOperationInput }[],
  path: string,
) {
  const ids = new Set<string>();
  const collections = new Set<string>();
  for (const entry of operations) {
    if (ids.has(entry.operation.clientOperationId))
      failCanonicalBody("duplicate", path, "client operation ids must be unique");
    ids.add(entry.operation.clientOperationId);
    if (entry.operation.kind === "document" || entry.operation.kind === "media_ref")
      collections.add(entry.operation.resource.collection);
  }
  if (collections.size > npAgentChangeSetLimits.collections)
    failCanonicalBody("limit", path, "too many collections");
}
function parseDraft(value: unknown, path: string): NpAgentChangeSetDraftInputV1 {
  const draft = object(value, path, {
    title,
    summary: nullable(text),
    operations: list(npRequireAgentChangeSetOperationInput, npAgentChangeSetLimits.operations),
  });
  operationsBound(
    draft.operations.map((operation) => ({ operation })),
    `${path}.operations`,
  );
  return draft;
}
export function npAnalyzeAgentChangeSetDraftInputV1(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetDraftInputV1> {
  return analyzeCanonicalBody("agent.changeset.draft", () =>
    parseDraft(
      clone(value, "agent.changeset.draft", npAgentChangeSetLimits.planBytes),
      "agent.changeset.draft",
    ),
  );
}
export function npRequireAgentChangeSetDraftInputV1(value: unknown): NpAgentChangeSetDraftInputV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetDraftInputV1(value),
    "Invalid ChangeSet draft input",
  );
}
export function npBuildAgentChangeSetDraftInputJsonV1(value: unknown): string {
  return serializeAgentCanonicalJson(npRequireAgentChangeSetDraftInputV1(value));
}
/** Admin proposalHash covers editable content only; persisted draftHash uses the existing server-attributed proposal canonical purpose. */
export async function npDigestAgentChangeSetDraftInputV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-changeset-draft-input.v1\0${npBuildAgentChangeSetDraftInputJsonV1(value)}`,
    ),
  );
}
export function npRequireAgentChangeSetAdminInputV1<M extends "create" | "update">(
  mode: M,
  value: unknown,
): NpAgentChangeSetAdminInputV1<M> {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.changeset.admin", () => {
      if (mode !== "create" && mode !== "update")
        failCanonicalBody(
          "invalid-field",
          "agent.changeset.admin.mode",
          "must be create or update",
        );
      return object(clone(value, "agent.changeset.admin"), "agent.changeset.admin", {
        idempotencyKey: (v, p) => {
          const key = canonicalRuntimeText(v, p, 256);
          if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key))
            failCanonicalBody("invalid-field", p, "must be an idempotency key");
          return key;
        },
        proposalJson: (v, p) =>
          canonicalRuntimeText(v, p, npAgentChangeSetLimits.adminProposalCharacters),
        proposalHash: digest,
        ...(mode === "update" ? { expectedVersion: positive } : {}),
      }) as NpAgentChangeSetAdminInputV1<M>;
    }),
    "Invalid ChangeSet Admin input",
  );
}
export interface NpAgentChangeSetValidateRequestV1 {
  idempotencyKey: string;
  expectedVersion: number;
}
export function npRequireAgentChangeSetValidateRequestV1(
  value: unknown,
): NpAgentChangeSetValidateRequestV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.changeset.validate", () =>
      object(clone(value, "agent.changeset.validate"), "agent.changeset.validate", {
        idempotencyKey: (v, p) => {
          const key = canonicalRuntimeText(v, p, 256);
          if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key))
            failCanonicalBody("invalid-field", p, "must be an idempotency key");
          return key;
        },
        expectedVersion: positive,
      }),
    ),
    "Invalid ChangeSet validation request",
  );
}
export async function npVerifyAgentChangeSetAdminProposalV1<M extends "create" | "update">(
  mode: M,
  value: unknown,
): Promise<{ request: NpAgentChangeSetAdminInputV1<M>; draft: NpAgentChangeSetDraftInputV1 }> {
  const request = npRequireAgentChangeSetAdminInputV1(mode, value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.proposalJson);
  } catch {
    failCanonicalBody("shape", "agent.changeset.admin.proposalJson", "must contain valid JSON");
  }
  const draft = npRequireAgentChangeSetDraftInputV1(parsed);
  if ((await npDigestAgentChangeSetDraftInputV1(draft)) !== request.proposalHash)
    failCanonicalBody(
      "invalid-field",
      "agent.changeset.admin.proposalHash",
      "must match canonical editable content",
    );
  return {
    request: { ...request, proposalJson: npBuildAgentChangeSetDraftInputJsonV1(draft) },
    draft,
  };
}
function parseApproval(value: unknown, path: string): NpAgentApprovalWire {
  const result = object(value, path, {
    id: uuid,
    generation: positive,
    state: enumeration(["pending", "approved", "rejected", "expired", "consumed", "revoked"]),
    statementHash: digest,
    requiredHumanCapabilities: capabilities,
    requiredHumanPredicates: predicates,
    requestedAt: utc,
    expiresAt: utc,
    decidedAt: nullable(utc),
  });
  order(result.requestedAt, result.expiresAt, path, npAgentChangeSetLimits.approvalMaximumSeconds);
  if (result.requestedAt === result.expiresAt)
    failCanonicalBody("invalid-field", path, "approval lifetime must be positive");
  if (
    (["approved", "rejected", "consumed"].includes(result.state) && result.decidedAt === null) ||
    (result.state === "pending" && result.decidedAt !== null)
  )
    failCanonicalBody("invalid-field", `${path}.decidedAt`, "must match decision state");
  if (result.decidedAt !== null) {
    order(result.requestedAt, result.decidedAt, path);
    order(result.decidedAt, result.expiresAt, path);
  }
  return result;
}
export function npAnalyzeAgentApprovalWire(
  value: unknown,
): NpAgentContractResult<NpAgentApprovalWire> {
  return analyzeCanonicalBody("agent.approval.wire", () =>
    parseApproval(clone(value, "agent.approval.wire"), "agent.approval.wire"),
  );
}
export function npRequireAgentApprovalWire(value: unknown): NpAgentApprovalWire {
  return npRequireAgentContractResult(npAnalyzeAgentApprovalWire(value), "Invalid approval wire");
}
function parseRisk(value: unknown, path: string): NpAgentRiskSummary {
  return object(value, path, {
    level: enumeration(npAgentRiskLevels),
    reasonCodes: (v, p) =>
      parseSortedUniqueEnumArray<(typeof npAgentRiskReasonCodes)[number]>(
        v,
        p,
        new Set(npAgentRiskReasonCodes),
        npAgentRiskReasonCodes.length,
        state(),
      ),
    approvalMode: literal("human"),
    reversible: bool,
  });
}
function parseIssue(value: unknown, path: string): NpAgentValidationIssueWire {
  return object(value, path, {
    code: enumeration(npAgentValidationIssueCodes),
    severity: enumeration(["warning", "error"]),
    operationOrdinal: nullable(positive),
    path: (v, p) => canonicalRuntimeText(v, p, 1024, { allowEmpty: true }),
    message: text,
    evidenceRefs: list((v, p) => canonicalRuntimeText(v, p, 256), 24),
  });
}
function parseOperation(value: unknown, path: string): NpAgentChangeSetOperationWire {
  const result = object(value, path, {
    ordinal: positive,
    operation: npRequireAgentChangeSetOperationInput,
    canonicalResourceKey: npRequireAgentChangeSetResourceKey,
    beforeHash: nullable(digest),
    afterHash: nullable(digest),
    state: enumeration(["draft", "valid", "invalid", "applied", "verified", "failed"]),
    issues: list(parseIssue, npAgentChangeSetLimits.validationIssues),
    resultDigest: nullable(digest),
  });
  if (!npAgentChangeSetOperationMatchesResourceKey(result.operation, result.canonicalResourceKey))
    failCanonicalBody("invalid-field", path, "operation and resource identity must match");
  if (
    result.issues.some(
      (issue) => issue.operationOrdinal !== null && issue.operationOrdinal !== result.ordinal,
    )
  )
    failCanonicalBody("invalid-field", path, "issue ordinal must match operation");
  return result;
}
export function npAnalyzeAgentChangeSetOperationWire(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetOperationWire> {
  return analyzeCanonicalBody("agent.changeset.operation.wire", () =>
    parseOperation(
      clone(value, "agent.changeset.operation.wire"),
      "agent.changeset.operation.wire",
    ),
  );
}
export function npRequireAgentChangeSetOperationWire(
  value: unknown,
): NpAgentChangeSetOperationWire {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetOperationWire(value),
    "Invalid ChangeSet operation wire",
  );
}
function parseValidation(value: unknown, path: string): NpAgentValidationSummary {
  const result = object(value, path, {
    state: enumeration(["queued", "running", "valid", "invalid", "failed"]),
    generation: positive,
    issueCount: natural,
    digest: nullable(digest),
    completedAt: nullable(utc),
  });
  const terminal = ["valid", "invalid", "failed"].includes(result.state);
  if (
    terminal !== (result.completedAt !== null) ||
    (result.state === "valid" && result.digest === null) ||
    (result.state === "failed" && result.digest !== null)
  )
    failCanonicalBody("invalid-field", path, "validation evidence must match state");
  return result;
}
function parsePreview(
  value: unknown,
  path: string,
  context: { siteId: string; changeSetId: string },
): NpAgentPreviewSummary {
  const refs: Parser<NpAgentPreviewArtifactRefWireV1[]> = (v, p) =>
    canonicalBodyArray(v, p, npAgentChangeSetLimits.previewArtifacts, state()).map(
      (entry, index) => {
        const r = canonicalBodyRecord(
          entry,
          `${p}[${index}]`,
          [
            "schemaVersion",
            "artifactId",
            "ordinal",
            "kind",
            "route",
            "locale",
            "viewport",
            "reportPart",
            "reportTotalParts",
            "contentDigest",
            "mime",
            "bytes",
            "resourceUri",
            "createdAt",
            "expiresAt",
          ],
          [
            "schemaVersion",
            "artifactId",
            "ordinal",
            "kind",
            "route",
            "locale",
            "viewport",
            "reportPart",
            "reportTotalParts",
            "contentDigest",
            "mime",
            "bytes",
            "resourceUri",
            "createdAt",
            "expiresAt",
          ],
          state(),
        );
        literal("np.agent-preview-artifact-ref.v1")(
          r.schemaVersion,
          `${p}[${index}].schemaVersion`,
        );
        return r as unknown as NpAgentPreviewArtifactRefWireV1;
      },
    );
  const result = object(value, path, {
    schemaVersion: literal("np.agent-preview-summary.v1"),
    previewId: uuid,
    state: enumeration(["queued", "rendering", "ready", "failed", "expired"]),
    generation: positive,
    planHash: digest,
    previewContractFingerprint: digest,
    digest: nullable(digest),
    artifactCount: (v, p) => canonicalBodyInteger(v, p, 0, npAgentChangeSetLimits.previewArtifacts),
    artifactRefs: refs,
    interactiveLaunch: nullable((v, p) =>
      object(v, p, {
        previewId: uuid,
        adminLaunchOperation: (v, p) => canonicalRuntimeText(v, p, 256),
      }),
    ),
    expiresAt: nullable(utc),
  });
  if (
    result.state !== "ready" &&
    (result.artifactRefs.length !== 0 || result.interactiveLaunch !== null)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "non-ready previews cannot expose artifacts or launch",
    );
  if (
    result.state === "ready" &&
    (result.digest === null ||
      result.expiresAt === null ||
      result.artifactCount !== result.artifactRefs.length)
  )
    failCanonicalBody("invalid-field", path, "ready previews require complete evidence");
  if (
    result.interactiveLaunch !== null &&
    (result.interactiveLaunch.previewId !== result.previewId ||
      result.interactiveLaunch.adminLaunchOperation !==
        `/api/admin/agents/changesets/${context.changeSetId}/previews/${result.previewId}/launch`)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "launch must select this preview's fixed Admin operation",
    );
  const manifest = npRequireAgentPreviewArtifactManifestCanonical({
    schemaVersion: "np.agent-preview-artifact-manifest.v1",
    ...context,
    previewId: result.previewId,
    generation: result.generation,
    planHash: result.planHash,
    previewContractFingerprint: result.previewContractFingerprint,
    artifacts: result.artifactRefs.map(
      ({ schemaVersion: _version, resourceUri: _uri, ...artifact }) => artifact,
    ),
  });
  for (const [index, ref] of result.artifactRefs.entries()) {
    if (
      ref.resourceUri !==
      `nexpress://site/${context.siteId}/agent-previews/${result.previewId}/artifacts/${ref.artifactId}`
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.artifactRefs[${index}].resourceUri`,
        "must be this preview's canonical artifact resource",
      );
    order(
      ref.createdAt,
      ref.expiresAt,
      `${path}.artifactRefs[${index}]`,
      npAgentChangeSetLimits.previewLifetimeSeconds,
    );
    if (result.expiresAt !== null && ref.expiresAt !== result.expiresAt)
      failCanonicalBody("invalid-field", path, "artifact expiry must match preview expiry");
  }
  return {
    ...result,
    artifactRefs: manifest.artifacts.map((artifact, index) => ({
      schemaVersion: "np.agent-preview-artifact-ref.v1",
      ...artifact,
      resourceUri: result.artifactRefs[index].resourceUri,
    })),
  };
}
function parseExecution(value: unknown, path: string): NpAgentExecutionSummary {
  const result = object(value, path, {
    executionId: uuid,
    state: enumeration(["reserved", "committed", "verifying", "succeeded", "failed", "ambiguous"]),
    resultDigest: nullable(digest),
    startedAt: utc,
    finishedAt: nullable(utc),
  });
  if (result.finishedAt !== null) order(result.startedAt, result.finishedAt, path);
  if (["succeeded", "failed"].includes(result.state) !== (result.finishedAt !== null))
    failCanonicalBody("invalid-field", path, "execution terminal timestamp must match state");
  return result;
}
function parseVerification(value: unknown, path: string): NpAgentVerificationSummary {
  const result = object(value, path, {
    state: enumeration(["queued", "running", "passed", "failed"]),
    requiredPassed: natural,
    requiredFailed: natural,
    advisoryWarnings: natural,
    digest: nullable(digest),
    completedAt: nullable(utc),
  });
  if (
    ["passed", "failed"].includes(result.state) !== (result.completedAt !== null) ||
    (result.state === "passed" && (result.requiredFailed !== 0 || result.digest === null))
  )
    failCanonicalBody("invalid-field", path, "verification result must match state");
  return result;
}
function parseRollback(value: unknown, path: string): NpAgentRollbackSummary {
  const result = object(value, path, {
    rollbackPlanId: uuid,
    generation: positive,
    state: enumeration(npAgentRollbackPlanStates),
    planHash: nullable(digest),
    approvalId: nullable(uuid),
    operationCount: (v, p) => canonicalBodyInteger(v, p, 0, npAgentChangeSetLimits.operations),
    createdAt: utc,
    expiresAt: utc,
    finishedAt: nullable(utc),
    terminalReason: nullable(
      enumeration([
        "validation_failed",
        "snapshot_expired",
        "conflict",
        "policy_blocked",
        "approval_rejected",
        "approval_revoked",
        "approval_expired",
        "operator_cancelled",
        "execution_cancelled",
        "execution_failed",
        "verification_failed",
      ]),
    ),
  });
  order(result.createdAt, result.expiresAt, path, npAgentChangeSetLimits.rollbackMaximumSeconds);
  const terminal = ["invalid", "verified", "failed", "conflicted", "expired"].includes(
    result.state,
  );
  if (
    terminal !== (result.finishedAt !== null) ||
    (result.state === "verified" && result.terminalReason !== null) ||
    (!terminal && result.terminalReason !== null)
  )
    failCanonicalBody("invalid-field", path, "rollback terminal evidence must match state");
  if (result.finishedAt !== null) order(result.createdAt, result.finishedAt, path);
  return result;
}
function parseChangeSet(value: unknown, path: string): NpAgentChangeSetWire {
  const safe = clone(value, path);
  const record = canonicalBodyRecord(
    safe,
    path,
    npAgentChangeSetWireIncludedKeysV1,
    npAgentChangeSetWireIncludedKeysV1,
    state(),
  );
  const siteId = canonicalBodySiteId(record.siteId, `${path}.siteId`);
  const id = uuid(record.id, `${path}.id`);
  const result = object(record, path, {
    schemaVersion: literal("np.agent-changeset.v1"),
    id: uuid,
    siteId: canonicalBodySiteId,
    title,
    summary: nullable(text),
    state: enumeration(npAgentChangeSetStates),
    actor: (v, p) =>
      object(v, p, {
        id: (v, p) => (typeof v === "string" && v.startsWith("cj1:") ? digest(v, p) : uuid(v, p)),
        kind: enumeration(["runtime", "external", "staff"]),
        name: (v, p) => canonicalRuntimeText(v, p, 120),
      }),
    agentId: nullable(uuid),
    agentVersionId: nullable(uuid),
    agentConfigHash: nullable(digest),
    runId: nullable(uuid),
    planHash: nullable(digest),
    baseFingerprint: nullable(digest),
    draftVersion: positive,
    draftHash: digest,
    risk: nullable(parseRisk),
    operations: list(parseOperation, npAgentChangeSetLimits.operations),
    validation: nullable(parseValidation),
    preview: nullable((v, p) => parsePreview(v, p, { siteId, changeSetId: id })),
    approval: nullable(parseApproval),
    schedule: nullable((v, p) => object(v, p, { at: utc })),
    execution: nullable(parseExecution),
    verification: nullable(parseVerification),
    rollback: nullable(parseRollback),
    createdAt: utc,
    updatedAt: utc,
    expiresAt: utc,
  });
  operationsBound(result.operations, `${path}.operations`);
  let previous = 0;
  let issues = 0;
  for (const operation of result.operations) {
    if (operation.ordinal <= previous)
      failCanonicalBody("order", `${path}.operations`, "ordinals must be sorted and unique");
    previous = operation.ordinal;
    issues += operation.issues.length;
  }
  if (issues > npAgentChangeSetLimits.validationIssues)
    failCanonicalBody("limit", path, "too many validation issues");
  if (result.actor.kind !== "staff" && result.actor.id.startsWith("cj1:"))
    failCanonicalBody(
      "invalid-field",
      `${path}.actor.id`,
      "only deleted staff may use fingerprint attribution",
    );
  const runtime = result.actor.kind === "runtime";
  if (
    [result.agentId, result.agentVersionId, result.agentConfigHash].some(
      (value) => (value !== null) !== runtime,
    )
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "Agent attribution must exist exactly for runtime creators",
    );
  order(result.createdAt, result.updatedAt, path);
  order(result.createdAt, result.expiresAt, path, npAgentChangeSetLimits.eligibilityMaximumSeconds);
  if (result.createdAt === result.expiresAt)
    failCanonicalBody("invalid-field", path, "eligibility lifetime must be positive");
  if (
    (result.planHash === null) !== (result.baseFingerprint === null) ||
    (result.planHash === null) !== (result.risk === null)
  )
    failCanonicalBody("invalid-field", path, "sealed plan identity and risk must appear together");
  if (
    ["draft", "validating", "invalid"].includes(result.state) &&
    (result.planHash !== null ||
      result.preview !== null ||
      result.approval !== null ||
      result.schedule !== null ||
      result.execution !== null ||
      result.verification !== null ||
      result.rollback !== null)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "editable or validating plans cannot expose sealed or execution facts",
    );
  if (
    result.state === "draft" &&
    (result.validation !== null ||
      result.operations.some(
        (operation) =>
          operation.state !== "draft" ||
          operation.issues.length !== 0 ||
          operation.afterHash !== null ||
          operation.resultDigest !== null,
      ))
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "draft operations cannot have validation or execution evidence",
    );
  if (
    !["draft", "validating", "invalid", "cancelled"].includes(result.state) &&
    result.planHash === null
  )
    failCanonicalBody("invalid-field", path, "non-editable states require sealed plan identity");
  if (
    result.state === "validating" &&
    !["queued", "running"].includes(result.validation?.state ?? "")
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "validating state requires an active validation attempt",
    );
  if (result.state === "invalid" && !["invalid", "failed"].includes(result.validation?.state ?? ""))
    failCanonicalBody("invalid-field", path, "invalid state requires terminal validation evidence");
  if (result.planHash !== null && result.validation?.state !== "valid")
    failCanonicalBody("invalid-field", path, "sealed plan requires successful validation evidence");
  if (
    [
      "applying",
      "applied",
      "verifying",
      "verified",
      "apply_failed",
      "verification_failed",
      "rolling_back",
      "rolled_back",
      "rollback_failed",
    ].includes(result.state) &&
    result.execution === null
  )
    failCanonicalBody("invalid-field", path, "execution states require execution evidence");
  if (
    ["verifying", "verified", "verification_failed"].includes(result.state) &&
    result.verification === null
  )
    failCanonicalBody("invalid-field", path, "verification states require verification evidence");
  if (
    ["rolling_back", "rolled_back", "rollback_failed"].includes(result.state) &&
    result.rollback === null
  )
    failCanonicalBody("invalid-field", path, "rollback states require rollback evidence");
  if (result.preview !== null && result.preview.planHash !== result.planHash)
    failCanonicalBody("invalid-field", path, "preview plan must match sealed plan");
  if (result.state === "approval_pending" && result.approval?.state !== "pending")
    failCanonicalBody("invalid-field", path, "pending approval must match state");
  if (["approved", "scheduled"].includes(result.state) && result.approval?.state !== "approved")
    failCanonicalBody("invalid-field", path, "approved state requires approved evidence");
  if (result.state === "scheduled" && result.schedule === null)
    failCanonicalBody("invalid-field", path, "scheduled state requires a schedule");
  if (result.schedule !== null) {
    order(result.createdAt, result.schedule.at, path);
    order(result.schedule.at, result.expiresAt, path);
  }
  return result;
}
export const npAgentChangeSetWireIncludedKeysV1 = [
  "schemaVersion",
  "id",
  "siteId",
  "title",
  "summary",
  "state",
  "actor",
  "agentId",
  "agentVersionId",
  "agentConfigHash",
  "runId",
  "planHash",
  "baseFingerprint",
  "draftVersion",
  "draftHash",
  "risk",
  "operations",
  "validation",
  "preview",
  "approval",
  "schedule",
  "execution",
  "verification",
  "rollback",
  "createdAt",
  "updatedAt",
  "expiresAt",
] as const satisfies readonly (keyof NpAgentChangeSetWire)[];
export const npAgentChangeSetWireExcludedKeysV1 = [
  "sealedPlanBody",
  "sealed_plan_body",
  "beforeSnapshot",
  "before_snapshot",
  "inputCanonical",
  "sourceRequestFingerprint",
  "actorFingerprint",
  "statementBody",
  "statementMac",
  "decisionBody",
  "decisionMac",
  "challenge",
  "challengeHash",
  "secretRef",
  "locator",
  "credential",
] as const;
export function npAnalyzeAgentChangeSetWire(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetWire> {
  return analyzeCanonicalBody("agent.changeset.wire", () =>
    parseChangeSet(value, "agent.changeset.wire"),
  );
}
export function npRequireAgentChangeSetWire(value: unknown): NpAgentChangeSetWire {
  return npRequireAgentContractResult(npAnalyzeAgentChangeSetWire(value), "Invalid ChangeSet wire");
}
export const npAgentChangeSetWireContractV1 = Object.freeze({
  schemaVersion: "np.agent-changeset-wire-contract.v1",
  resourceKinds: npAgentChangeSetResourceKinds,
  operationInputKeys: npAgentChangeSetOperationInputIncludedKeysV1,
  operationResourceKeys: npAgentChangeSetOperationResourceIncludedKeysV1,
  projectionShapes: {
    operation: [
      "ordinal",
      "operation",
      "canonicalResourceKey",
      "beforeHash",
      "afterHash",
      "state",
      "issues",
      "resultDigest",
    ],
    approval: [
      "id",
      "generation",
      "state",
      "statementHash",
      "requiredHumanCapabilities",
      "requiredHumanPredicates",
      "requestedAt",
      "expiresAt",
      "decidedAt",
    ],
    actor: {
      keys: ["id", "kind", "name"],
      id: "UUID; deleted staff may use retained cj1 fingerprint",
      kinds: ["runtime", "external", "staff"],
    },
    validation: ["state", "generation", "issueCount", "digest", "completedAt"],
    risk: ["level", "reasonCodes", "approvalMode", "reversible"],
    preview: [
      "schemaVersion",
      "previewId",
      "state",
      "generation",
      "planHash",
      "previewContractFingerprint",
      "digest",
      "artifactCount",
      "artifactRefs",
      "interactiveLaunch",
      "expiresAt",
    ],
    execution: ["executionId", "state", "resultDigest", "startedAt", "finishedAt"],
    verification: [
      "state",
      "requiredPassed",
      "requiredFailed",
      "advisoryWarnings",
      "digest",
      "completedAt",
    ],
    rollback: [
      "rollbackPlanId",
      "generation",
      "state",
      "planHash",
      "approvalId",
      "operationCount",
      "createdAt",
      "expiresAt",
      "finishedAt",
      "terminalReason",
    ],
  },
  states: npAgentChangeSetStates,
  rollbackStates: npAgentRollbackPlanStates,
  issueCodes: npAgentValidationIssueCodes,
  included: npAgentChangeSetWireIncludedKeysV1,
  excluded: npAgentChangeSetWireExcludedKeysV1,
  limits: npAgentChangeSetLimits,
  draftInputKeys: ["title", "summary", "operations"],
  adminInputKeys: {
    create: ["idempotencyKey", "proposalJson", "proposalHash"],
    update: ["idempotencyKey", "proposalJson", "proposalHash", "expectedVersion"],
  },
  proposalHashDomain: "np.agent-changeset-draft-input.v1",
} as const);
export async function npDigestAgentChangeSetWireContractV1(): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-changeset-wire-contract.v1\0${serializeAgentCanonicalJson(npAgentChangeSetWireContractV1)}`,
    ),
  );
}

export type NpAgentChangeSetCreateRequestV1 = NpAgentChangeSetAdminInputV1<"create">;
export type NpAgentChangeSetUpdateRequestV1 = NpAgentChangeSetAdminInputV1<"update">;

export interface NpAgentChangeSetPreviewRequestV1 extends NpAgentChangeSetValidateRequestV1 {
  expectedPlanHash: string;
}
export interface NpAgentChangeSetPreviewLaunchRequestV1 extends NpAgentChangeSetPreviewRequestV1 {
  route: string;
}
export function npRequireAgentChangeSetPreviewRequestV1(
  value: unknown,
): NpAgentChangeSetPreviewRequestV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.request", () => {
      const r = object(clone(value, "agent.preview.request"), "agent.preview.request", {
        idempotencyKey: (v, p) => canonicalRuntimeText(v, p, 256),
        expectedVersion: positive,
        expectedPlanHash: digest,
      });
      npRequireAgentChangeSetValidateRequestV1({
        idempotencyKey: r.idempotencyKey,
        expectedVersion: r.expectedVersion,
      });
      return r;
    }),
    "Invalid preview request",
  );
}
export function npRequireAgentChangeSetPreviewLaunchRequestV1(
  value: unknown,
): NpAgentChangeSetPreviewLaunchRequestV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.launch", () => {
      const r = object(clone(value, "agent.preview.launch"), "agent.preview.launch", {
        idempotencyKey: (v, p) => canonicalRuntimeText(v, p, 256),
        expectedVersion: positive,
        expectedPlanHash: digest,
        route: canonicalBodyPreviewRoute,
      });
      const { route: _route, ...request } = r;
      npRequireAgentChangeSetPreviewRequestV1(request);
      return r;
    }),
    "Invalid preview launch request",
  );
}
const previewRoute: Parser<{ route: string; locale: string | null; audience: "public" }> = (v, p) =>
  object(v, p, {
    route: canonicalBodyPreviewRoute,
    locale: nullable(canonicalBodyPreviewLocale),
    audience: literal("public"),
  });
const previewEvidenceId: Parser<string> = (v, p) => {
  const id = canonicalRuntimeText(v, p, 80);
  if (!/^[a-z][a-z0-9._-]{0,79}$/u.test(id))
    failCanonicalBody("invalid-field", p, "must be a framework evidence identifier");
  return id;
};
function parsePreviewReport(value: unknown): NpAgentPreviewReportV1 {
  const path = "agent.preview.report";
  const report = object(clone(value, path, npAgentChangeSetLimits.reportBytes), path, {
    schemaVersion: literal("np.agent-preview-report.v1"),
    siteId: canonicalBodySiteId,
    changeSetId: uuid,
    previewId: uuid,
    generation: positive,
    planHash: digest,
    previewContractFingerprint: digest,
    part: (v, p) => canonicalBodyInteger(v, p, 1, npAgentChangeSetLimits.previewReports),
    totalParts: (v, p) => canonicalBodyInteger(v, p, 1, npAgentChangeSetLimits.previewReports),
    results: list(
      (v, p) =>
        object(v, p, {
          id: previewEvidenceId,
          checkId: enumeration(npAgentPreviewCheckIdsV1),
          status: enumeration(["pass", "warning", "fail"]),
          route: nullable(previewRoute),
          issueIds: list(previewEvidenceId, 1000),
        }),
      1000,
    ),
    issues: list((v, p) => {
      const issue = object(v, p, {
        id: previewEvidenceId,
        resultId: previewEvidenceId,
        severity: enumeration(["warning", "error"]),
        code: enumeration(
          Object.keys(npAgentPreviewIssueMessagesV1) as NpAgentPreviewIssueCodeV1[],
        ),
        safeMessage: (v, p) => canonicalRuntimeText(v, p, 500),
        target: nullable((v, p) => {
          const tag = canonicalBodyRecord(
            v,
            p,
            ["kind", "route", "selectorDigest", "origin", "ordinal"],
            ["kind"],
            state(),
          );
          switch (tag.kind) {
            case "route":
              return object(v, p, { kind: literal("route"), route: canonicalBodyPreviewRoute });
            case "selector":
              return object(v, p, { kind: literal("selector"), selectorDigest: digest });
            case "external-origin":
              return object(v, p, {
                kind: literal("external-origin"),
                origin: canonicalBodyQuerylessHttpsOrigin,
              });
            case "operation":
              return object(v, p, {
                kind: literal("operation"),
                ordinal: (v, p) => canonicalBodyInteger(v, p, 1, npAgentChangeSetLimits.operations),
              });
            default:
              failCanonicalBody("invalid-field", p, "must be a closed evidence target");
          }
        }),
        evidenceRefs: list((v, p) => {
          const ref = object(v, p, {
            kind: enumeration(["artifact", "operation"]),
            id: (v, p) => canonicalRuntimeText(v, p, 36),
          });
          if (ref.kind === "artifact") uuid(ref.id, `${p}.id`);
          else if (
            !/^[1-9][0-9]{0,2}$/u.test(ref.id) ||
            Number(ref.id) > npAgentChangeSetLimits.operations
          )
            failCanonicalBody("invalid-field", p, "must name an operation ordinal");
          return ref;
        }, 8),
      });
      if (issue.safeMessage !== npAgentPreviewIssueMessagesV1[issue.code])
        failCanonicalBody("invalid-field", p, "must use the framework safe message");
      return issue;
    }, 1000),
    generatedAt: utc,
  });
  if (report.part > report.totalParts)
    failCanonicalBody("invalid-field", path, "part exceeds total");
  return report;
}
export function npRequireAgentPreviewReportV1(value: unknown): NpAgentPreviewReportV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.report", () => parsePreviewReport(value)),
    "Invalid preview report",
  );
}
/** Validates the complete multipart set, including cross-part ownership and bounds. */
export function npRequireAgentPreviewReportPartsV1(value: unknown): NpAgentPreviewReportV1[] {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.reports", () => {
      const reports = canonicalBodyArray(value, "agent.preview.reports", 4, state()).map(
        npRequireAgentPreviewReportV1,
      );
      if (reports.length === 0) return reports;
      const identity = (r: NpAgentPreviewReportV1) =>
        serializeAgentCanonicalJson({
          siteId: r.siteId,
          changeSetId: r.changeSetId,
          previewId: r.previewId,
          generation: r.generation,
          planHash: r.planHash,
          previewContractFingerprint: r.previewContractFingerprint,
          totalParts: r.totalParts,
          generatedAt: r.generatedAt,
        });
      if (
        reports.some(
          (r, i) =>
            r.part !== i + 1 ||
            r.totalParts !== reports.length ||
            identity(r) !== identity(reports[0]),
        )
      )
        failCanonicalBody(
          "invalid-field",
          "agent.preview.reports",
          "must be the complete contiguous identity-bound set",
        );
      const results = reports.flatMap((r) => r.results),
        issues = reports.flatMap((r) => r.issues);
      if (results.length > 1000 || issues.length > 1000)
        failCanonicalBody(
          "invalid-field",
          "agent.preview.reports",
          "aggregate report bound exceeded",
        );
      const resultIds = new Set(results.map((r) => r.id)),
        issueIds = new Set(issues.map((i) => i.id));
      if (resultIds.size !== results.length || issueIds.size !== issues.length)
        failCanonicalBody("duplicate", "agent.preview.reports", "evidence ids must be unique");
      const orderKey = (r: NpAgentPreviewReportV1["results"][number]) =>
        `${r.checkId}\0${r.route?.route ?? ""}\0${r.route?.locale ?? ""}\0${r.id}`;
      if (results.some((r, i) => i > 0 && orderKey(results[i - 1]) >= orderKey(r)))
        failCanonicalBody("order", "agent.preview.reports", "results must be canonically sorted");
      const owners = new Map<string, string>();
      for (const r of results)
        for (const id of r.issueIds) {
          if (owners.has(id) || !issueIds.has(id))
            failCanonicalBody(
              "invalid-field",
              "agent.preview.reports",
              "issue must resolve exactly once",
            );
          owners.set(id, r.id);
        }
      if (issues.some((i) => owners.get(i.id) !== i.resultId || !resultIds.has(i.resultId)))
        failCanonicalBody("invalid-field", "agent.preview.reports", "issue owner mismatch");
      return reports;
    }),
    "Invalid preview report set",
  );
}
export function npRequireAgentPreviewSummaryV1(
  value: unknown,
  context: { siteId: string; changeSetId: string },
): NpAgentPreviewSummary {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.summary", () =>
      parsePreview(clone(value, "agent.preview.summary"), "agent.preview.summary", context),
    ),
    "Invalid preview summary",
  );
}

export function npRequireAgentPreviewDetailWireV1(
  value: unknown,
  siteId: string,
): NpAgentPreviewDetailWireV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.preview.detail", () => {
      const p = "agent.preview.detail";
      const fields = [
        "schemaVersion",
        "previewId",
        "state",
        "generation",
        "planHash",
        "previewContractFingerprint",
        "digest",
        "artifactCount",
        "artifactRefs",
        "interactiveLaunch",
        "expiresAt",
        "changeSetId",
        "allowedRoutes",
        "diffSummary",
        "checkSummary",
        "riskSummary",
        "createdAt",
        "completedAt",
        "safeErrorCode",
      ];
      const r = canonicalBodyRecord(clone(value, p), p, fields, fields, state());
      literal("np.agent-preview.v1")(r.schemaVersion, `${p}.schemaVersion`);
      const changeSetId = uuid(r.changeSetId, `${p}.changeSetId`);
      const {
        changeSetId: _id,
        allowedRoutes: _routes,
        diffSummary: _diff,
        checkSummary: _checks,
        riskSummary: _risk,
        createdAt: _created,
        completedAt: _completed,
        safeErrorCode: _code,
        ...summary
      } = r;
      const checked = npRequireAgentPreviewSummaryV1(
        { ...summary, schemaVersion: "np.agent-preview-summary.v1" },
        { siteId, changeSetId },
      );
      const routes = list(previewRoute, 256)(r.allowedRoutes, `${p}.allowedRoutes`);
      const keys = routes.map((route) => `${route.route}\0${route.locale ?? ""}`);
      if (keys.some((key, i) => i > 0 && keys[i - 1] >= key))
        failCanonicalBody("order", p, "routes must be sorted unique");
      const diffSummary = object(r.diffSummary, `${p}.diffSummary`, {
        operationCount: (v, p) => canonicalBodyInteger(v, p, 0, 500),
      });
      const checkSummary = object(r.checkSummary, `${p}.checkSummary`, {
        checksRun: (v, p) => canonicalBodyInteger(v, p, 0, 1000),
        screenshots: (v, p) => canonicalBodyInteger(v, p, 0, 20),
        warningCodes: list(enumeration(["SCREENSHOTS_UNAVAILABLE", "CHECKS_NOT_RUN"]), 2),
      });
      if (new Set(checkSummary.warningCodes).size !== checkSummary.warningCodes.length)
        failCanonicalBody("duplicate", p, "warning codes must be unique");
      const createdAt = utc(r.createdAt, `${p}.createdAt`),
        completedAt = nullable(utc)(r.completedAt, `${p}.completedAt`);
      if (completedAt !== null) order(createdAt, completedAt, p);
      if (["queued", "rendering"].includes(checked.state) !== (completedAt === null))
        failCanonicalBody("invalid-field", p, "completion must match preview state");
      const safeErrorCode = nullable(
        enumeration([
          "AUTHORITY_REVOKED",
          "PREVIEW_FAILED",
          "PREVIEW_EXPIRED",
          "CONTRACT_CHANGED",
          "ARTIFACT_INTEGRITY_FAILED",
          "DEPENDENCY_UNAVAILABLE",
        ]),
      )(r.safeErrorCode, `${p}.safeErrorCode`);
      if ((checked.state === "failed") !== (safeErrorCode !== null && checked.state !== "expired"))
        failCanonicalBody("invalid-field", p, "safe error must match preview state");
      return {
        ...checked,
        schemaVersion: "np.agent-preview.v1",
        changeSetId,
        allowedRoutes: routes,
        diffSummary,
        checkSummary,
        riskSummary: parseRisk(r.riskSummary, `${p}.riskSummary`),
        createdAt,
        completedAt,
        safeErrorCode,
      };
    }),
    "Invalid preview detail",
  );
}
export const npAgentPreviewWireContractV1 = Object.freeze({
  schemaVersion: "np.agent-preview-wire-contract.v1",
  checkIds: npAgentPreviewCheckIdsV1,
  issueMessages: npAgentPreviewIssueMessagesV1,
  detailKeys: [
    "schemaVersion",
    "previewId",
    "state",
    "generation",
    "planHash",
    "previewContractFingerprint",
    "digest",
    "artifactCount",
    "artifactRefs",
    "interactiveLaunch",
    "expiresAt",
    "changeSetId",
    "allowedRoutes",
    "diffSummary",
    "checkSummary",
    "riskSummary",
    "createdAt",
    "completedAt",
    "safeErrorCode",
  ],
  reportKeys: [
    "schemaVersion",
    "siteId",
    "changeSetId",
    "previewId",
    "generation",
    "planHash",
    "previewContractFingerprint",
    "part",
    "totalParts",
    "results",
    "issues",
    "generatedAt",
  ],
  resultKeys: ["id", "checkId", "status", "route", "issueIds"],
  issueKeys: ["id", "resultId", "severity", "code", "safeMessage", "target", "evidenceRefs"],
  limits: {
    reports: npAgentChangeSetLimits.previewReports,
    reportBytes: npAgentChangeSetLimits.reportBytes,
    results: 1000,
    issues: 1000,
    evidenceRefs: 8,
    safeMessage: 500,
  },
});
export async function npDigestAgentPreviewWireContractV1(): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-preview-wire-contract.v1\0${serializeAgentCanonicalJson(npAgentPreviewWireContractV1)}`,
    ),
  );
}
