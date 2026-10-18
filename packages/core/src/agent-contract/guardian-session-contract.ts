import {
  canonicalBodyEnum,
  canonicalBodyAscii,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentJsonObject, NpAgentJsonSchema } from "./types.js";

/** Safe historical observation. Exact principal/session targets remain private. */
export interface NpAgentGuardianSessionEvidenceV1 {
  schemaVersion: "np.agent-guardian-session-evidence.v1";
  signalId: string;
  detectorId: "guardian.login-after-failures";
  detectorVersion: 1;
  audience: "staff" | "member";
  window: { startedAt: string; endedAt: string };
  successfulLoginAt: string;
  precedingFailureCount: 5;
  countBasis: "at-least";
  sourceDigest: string;
}
export function npRequireAgentGuardianSessionEvidenceV1(
  value: unknown,
): NpAgentGuardianSessionEvidenceV1 {
  const path = "guardian.session.evidence";
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "audience",
    "window",
    "successfulLoginAt",
    "precedingFailureCount",
    "countBasis",
    "sourceDigest",
  ];
  const state = { seen: new WeakSet<object>() };
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 4096),
    path,
    keys,
    keys,
    state,
  );
  const window = canonicalBodyRecord(
    row.window,
    path,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const startedAt = canonicalBodyUtc(window.startedAt, path);
  const endedAt = canonicalBodyUtc(window.endedAt, path);
  const successfulLoginAt = canonicalBodyUtc(row.successfulLoginAt, path);
  if (
    startedAt > endedAt ||
    successfulLoginAt < startedAt ||
    successfulLoginAt > endedAt ||
    Date.parse(endedAt) - Date.parse(startedAt) >= 600_000
  )
    failCanonicalBody("invalid-field", path, "invalid login observation window");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-session-evidence.v1"]),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId: canonicalBodyEnum(row.detectorId, path, new Set(["guardian.login-after-failures"])),
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    audience: canonicalBodyEnum(row.audience, path, new Set(["staff", "member"])),
    window: { startedAt, endedAt },
    successfulLoginAt,
    precedingFailureCount: canonicalBodyInteger(row.precedingFailureCount, path, 5, 5) as 5,
    countBasis: canonicalBodyEnum(row.countBasis, path, new Set(["at-least"])),
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
  };
}

export interface NpAgentGuardianSessionPlanInputV1 {
  schemaVersion: "np.agent-guardian-session-plan-input.v1";
  expectedVersion: number;
  expectedTargetVersionDigest: string;
  idempotencyKey: string;
}
export interface NpAgentGuardianSessionExecuteInputV1 {
  schemaVersion: "np.agent-guardian-session-execute-input.v1";
  expectedVersion: number;
  actionId: string;
  approvalId: string;
  proposalHash: string;
  idempotencyKey: string;
}
/** Deployment-global session ownership is deliberately conservative until auth owns a site fence. */
export interface NpAgentGuardianSessionTargetV1 {
  actorKind: "staff" | "member";
  sessionFamilyId: string;
  createdAt: string;
  impact: "deployment";
  affectedSiteCount: number;
  impactDigest: string;
}
export interface NpAgentGuardianSessionPlanV1 {
  actionId: string;
  approvalId: string;
  proposalHash: string;
  state: "approval_pending" | "approved" | "succeeded" | "failed";
  approvalExpiresAt: string;
  canExecute: boolean;
}
export interface NpAgentGuardianSessionV1 {
  schemaVersion: "np.agent-guardian-session.v1";
  incidentId: string;
  incidentVersion: number;
  targetVersionDigest: string;
  target: NpAgentGuardianSessionTargetV1;
  canPlan: boolean;
  plans: NpAgentGuardianSessionPlanV1[];
  truncated: boolean;
}
export interface NpAgentApprovalGuardianSessionActionReviewV1 {
  actionId: string;
  proposalHash: string;
  capabilityId: "security.revokeSessions";
  incidentId: string;
  expectedTargetVersionDigest: string;
  target: NpAgentGuardianSessionTargetV1;
  policyDigest: string;
}
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, "guardianSession", keys, keys, { seen: new WeakSet<object>() });
const positive = (v: unknown) => canonicalBodyInteger(v, "guardianSession.version", 1, 2147483647);
const uuid = (v: unknown) => canonicalBodyUuid(v, "guardianSession.id");
const sha = (v: unknown) => canonicalBodySha256Digest(v, "guardianSession.digest");
function key(v: unknown): string {
  const result = canonicalBodyAscii(v, "guardianSession.idempotencyKey", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result))
    failCanonicalBody("invalid-field", "guardianSession.idempotencyKey", "Invalid stable key");
  return result;
}
function bool(v: unknown): boolean {
  if (typeof v !== "boolean")
    failCanonicalBody("invalid-field", "guardianSession", "Expected boolean");
  return v;
}
export function npRequireAgentGuardianSessionPlanInputV1(
  value: unknown,
): NpAgentGuardianSessionPlanInputV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "guardianSession.plan", 8192), [
    "schemaVersion",
    "expectedVersion",
    "expectedTargetVersionDigest",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      "guardianSession.schemaVersion",
      new Set(["np.agent-guardian-session-plan-input.v1"] as const),
    ),
    expectedVersion: positive(r.expectedVersion),
    expectedTargetVersionDigest: sha(r.expectedTargetVersionDigest),
    idempotencyKey: key(r.idempotencyKey),
  };
}
export function npRequireAgentGuardianSessionExecuteInputV1(
  value: unknown,
): NpAgentGuardianSessionExecuteInputV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "guardianSession.execute", 8192), [
    "schemaVersion",
    "expectedVersion",
    "actionId",
    "approvalId",
    "proposalHash",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      "guardianSession.schemaVersion",
      new Set(["np.agent-guardian-session-execute-input.v1"] as const),
    ),
    expectedVersion: positive(r.expectedVersion),
    actionId: uuid(r.actionId),
    approvalId: uuid(r.approvalId),
    proposalHash: sha(r.proposalHash),
    idempotencyKey: key(r.idempotencyKey),
  };
}
export function npRequireAgentGuardianSessionTargetV1(
  value: unknown,
): NpAgentGuardianSessionTargetV1 {
  const r = record(value, [
    "actorKind",
    "sessionFamilyId",
    "createdAt",
    "impact",
    "affectedSiteCount",
    "impactDigest",
  ]);
  return {
    actorKind: canonicalBodyEnum(
      r.actorKind,
      "guardianSession.actorKind",
      new Set(["staff", "member"] as const),
    ),
    sessionFamilyId: uuid(r.sessionFamilyId),
    createdAt: canonicalBodyUtc(r.createdAt, "guardianSession.createdAt"),
    impact: canonicalBodyEnum(r.impact, "guardianSession.impact", new Set(["deployment"] as const)),
    affectedSiteCount: positive(r.affectedSiteCount),
    impactDigest: sha(r.impactDigest),
  };
}
export function npRequireAgentApprovalGuardianSessionActionReviewV1(
  value: unknown,
): NpAgentApprovalGuardianSessionActionReviewV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "guardianSession.review", 16384), [
    "actionId",
    "proposalHash",
    "capabilityId",
    "incidentId",
    "expectedTargetVersionDigest",
    "target",
    "policyDigest",
  ]);
  return {
    actionId: uuid(r.actionId),
    proposalHash: sha(r.proposalHash),
    capabilityId: canonicalBodyEnum(
      r.capabilityId,
      "guardianSession.capabilityId",
      new Set(["security.revokeSessions"] as const),
    ),
    incidentId: uuid(r.incidentId),
    expectedTargetVersionDigest: sha(r.expectedTargetVersionDigest),
    target: npRequireAgentGuardianSessionTargetV1(r.target),
    policyDigest: sha(r.policyDigest),
  };
}
export function npRequireAgentGuardianSessionV1(value: unknown): NpAgentGuardianSessionV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "guardianSession.result", 65536), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "targetVersionDigest",
    "target",
    "canPlan",
    "plans",
    "truncated",
  ]);
  if (!Array.isArray(r.plans) || r.plans.length > 25)
    failCanonicalBody("invalid-field", "guardianSession.plans", "Expected bounded plans");
  const ids = new Set<string>();
  const plans: NpAgentGuardianSessionPlanV1[] = r.plans.map((value) => {
    const p = record(value, [
      "actionId",
      "approvalId",
      "proposalHash",
      "state",
      "approvalExpiresAt",
      "canExecute",
    ]);
    const state = canonicalBodyEnum<NpAgentGuardianSessionPlanV1["state"]>(
      p.state,
      "guardianSession.state",
      new Set(["approval_pending", "approved", "succeeded", "failed"] as const),
    );
    const actionId = uuid(p.actionId),
      canExecute = bool(p.canExecute);
    if (ids.has(actionId) || (canExecute && state !== "approved"))
      failCanonicalBody("invalid-field", "guardianSession.plans", "Inconsistent plan state");
    ids.add(actionId);
    return {
      actionId,
      approvalId: uuid(p.approvalId),
      proposalHash: sha(p.proposalHash),
      state,
      approvalExpiresAt: canonicalBodyUtc(p.approvalExpiresAt, "guardianSession.expiresAt"),
      canExecute,
    };
  });
  return {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      "guardianSession.schemaVersion",
      new Set(["np.agent-guardian-session.v1"] as const),
    ),
    incidentId: uuid(r.incidentId),
    incidentVersion: positive(r.incidentVersion),
    targetVersionDigest: sha(r.targetVersionDigest),
    target: npRequireAgentGuardianSessionTargetV1(r.target),
    canPlan: bool(r.canPlan),
    plans,
    truncated: bool(r.truncated),
  };
}
const uuidSchema = { type: "string", format: "uuid", maxLength: 36 };
const digestSchema = { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", maxLength: 54 };
const positiveSchema = { type: "integer", minimum: 1, maximum: 2147483647 };
const keySchema = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  minLength: 1,
  maxLength: 128,
};
export function npAgentGuardianSessionTargetSchemaV1(): NpAgentJsonObject {
  const properties = {
    actorKind: { enum: ["staff", "member"] },
    sessionFamilyId: uuidSchema,
    createdAt: { type: "string", format: "date-time", maxLength: 24 },
    impact: { const: "deployment" },
    affectedSiteCount: positiveSchema,
    impactDigest: digestSchema,
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
function schema(properties: NpAgentJsonObject): NpAgentJsonSchema {
  return JSON.parse(
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    }),
  ) as NpAgentJsonSchema;
}
export function npAgentGuardianSessionPlanInputSchemaV1(): NpAgentJsonSchema {
  return schema({
    schemaVersion: { const: "np.agent-guardian-session-plan-input.v1" },
    expectedVersion: positiveSchema,
    expectedTargetVersionDigest: digestSchema,
    idempotencyKey: keySchema,
  });
}
export function npAgentGuardianSessionExecuteInputSchemaV1(): NpAgentJsonSchema {
  return schema({
    schemaVersion: { const: "np.agent-guardian-session-execute-input.v1" },
    expectedVersion: positiveSchema,
    actionId: uuidSchema,
    approvalId: uuidSchema,
    proposalHash: digestSchema,
    idempotencyKey: keySchema,
  });
}
