import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const npAgentRuntimeReadinessKeysV1 = [
  "doctor",
  "policy",
  "budget",
  "vault",
  "integrityKey",
  "worker",
] as const;
export type NpAgentRuntimeReadinessV1 = {
  [K in (typeof npAgentRuntimeReadinessKeysV1)[number]]:
    "ready" | "blocked" | "unavailable" | (K extends "vault" ? "not-required" : never);
};
export interface NpAgentRuntimeStatusV1 {
  schemaVersion: "np.agent-runtime-status.v1";
  siteId: string;
  revision: number;
  enabled: boolean;
  paused: boolean;
  readiness: NpAgentRuntimeReadinessV1;
  generatedAt: string;
}
/** A safe local artifact; the matching persisted plan remains the authority. */
export interface NpAgentRuntimeResumePlanV1 {
  schemaVersion: "np.agent-runtime-resume-plan.v1";
  id: string;
  siteId: string;
  actorFingerprint: string;
  revision: number;
  settingsHash: string;
  readinessFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  planHash: string;
}
export interface NpAgentRuntimeResumeReceiptV1 {
  plan: NpAgentRuntimeResumePlanV1;
  revision: number;
  settingsHash: string;
  completedAt: string;
}
/** Private np_settings authority. It is never part of content export or status. */
export interface NpAgentRuntimeControlV1 {
  revision: number;
  currentResumePlan: NpAgentRuntimeResumePlanV1 | null;
  lastResumeReceipt: NpAgentRuntimeResumeReceiptV1 | null;
}
export const npAgentRuntimeOpsErrorCodesV1 = [
  "RUNTIME_ARGUMENT_INVALID",
  "RUNTIME_AUTHORITY_REQUIRED",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_SITE_UNAVAILABLE",
  "RUNTIME_STATE_INVALID",
  "RUNTIME_REVISION_CONFLICT",
  "RUNTIME_PLAN_INVALID",
  "RUNTIME_PLAN_EXPIRED",
  "RUNTIME_READINESS_BLOCKED",
  "RUNTIME_EXECUTE_REQUIRED",
  "RUNTIME_APPROVAL_REQUIRED",
  "RUNTIME_ARTIFACT_UNAVAILABLE",
] as const;
export type NpAgentRuntimeOpsErrorCodeV1 = (typeof npAgentRuntimeOpsErrorCodesV1)[number];
export interface NpAgentRuntimeOpsResultV1 {
  schemaVersion: "np.agent-runtime-ops.v1";
  operation: "status" | "pause" | "resume-plan" | "resume";
  outcome: "status" | "paused" | "planned" | "resumed" | "blocked";
  errorCode: NpAgentRuntimeOpsErrorCodeV1 | null;
  status: NpAgentRuntimeStatusV1 | null;
  plan: NpAgentRuntimeResumePlanV1 | null;
}

const revision = (value: unknown, path: string) =>
  canonicalBodyInteger(value, path, 1, 2_147_483_647);
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") failCanonicalBody("invalid-field", path, "must be boolean");
  return value;
}
function record(
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
) {
  return canonicalBodyRecord(value, path, keys, keys, state);
}
function parseReadiness(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRuntimeReadinessV1 {
  const raw = record(value, path, npAgentRuntimeReadinessKeysV1, state);
  const parse = (key: (typeof npAgentRuntimeReadinessKeysV1)[number]) =>
    canonicalBodyEnum<"ready" | "blocked" | "unavailable">(
      raw[key],
      `${path}.${key}`,
      new Set(["ready", "blocked", "unavailable"]),
    );
  return {
    doctor: parse("doctor"),
    policy: parse("policy"),
    budget: parse("budget"),
    vault: canonicalBodyEnum<NpAgentRuntimeReadinessV1["vault"]>(
      raw.vault,
      `${path}.vault`,
      new Set(["ready", "blocked", "unavailable", "not-required"]),
    ),
    integrityKey: parse("integrityKey"),
    worker: parse("worker"),
  };
}
function parseStatus(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRuntimeStatusV1 {
  const raw = record(
    value,
    path,
    ["schemaVersion", "siteId", "revision", "enabled", "paused", "readiness", "generatedAt"],
    state,
  );
  if (raw.schemaVersion !== "np.agent-runtime-status.v1")
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid runtime status version");
  return {
    schemaVersion: "np.agent-runtime-status.v1",
    siteId: canonicalBodySiteId(raw.siteId, `${path}.siteId`),
    revision: revision(raw.revision, `${path}.revision`),
    enabled: boolean(raw.enabled, `${path}.enabled`),
    paused: boolean(raw.paused, `${path}.paused`),
    readiness: parseReadiness(raw.readiness, `${path}.readiness`, state),
    generatedAt: canonicalBodyUtc(raw.generatedAt, `${path}.generatedAt`),
  };
}
function parsePlan(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRuntimeResumePlanV1 {
  const raw = record(
    value,
    path,
    [
      "schemaVersion",
      "id",
      "siteId",
      "actorFingerprint",
      "revision",
      "settingsHash",
      "readinessFingerprint",
      "issuedAt",
      "expiresAt",
      "planHash",
    ],
    state,
  );
  if (raw.schemaVersion !== "np.agent-runtime-resume-plan.v1")
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid runtime plan version");
  const issuedAt = canonicalBodyUtc(raw.issuedAt, `${path}.issuedAt`);
  const expiresAt = canonicalBodyUtc(raw.expiresAt, `${path}.expiresAt`);
  const duration = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (duration <= 0 || duration > 300_000)
    failCanonicalBody(
      "invalid-field",
      `${path}.expiresAt`,
      "plan lifetime must be bounded to five minutes",
    );
  return {
    schemaVersion: "np.agent-runtime-resume-plan.v1",
    id: canonicalBodyUuid(raw.id, `${path}.id`),
    siteId: canonicalBodySiteId(raw.siteId, `${path}.siteId`),
    actorFingerprint: canonicalBodySha256Digest(raw.actorFingerprint, `${path}.actorFingerprint`),
    revision: revision(raw.revision, `${path}.revision`),
    settingsHash: canonicalBodySha256Digest(raw.settingsHash, `${path}.settingsHash`),
    readinessFingerprint: canonicalBodySha256Digest(
      raw.readinessFingerprint,
      `${path}.readinessFingerprint`,
    ),
    issuedAt,
    expiresAt,
    planHash: canonicalBodySha256Digest(raw.planHash, `${path}.planHash`),
  };
}
function parseControl(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRuntimeControlV1 {
  const raw = record(value, path, ["revision", "currentResumePlan", "lastResumeReceipt"], state);
  const currentRevision = revision(raw.revision, `${path}.revision`);
  const currentResumePlan =
    raw.currentResumePlan === null
      ? null
      : parsePlan(raw.currentResumePlan, `${path}.currentResumePlan`, state);
  let lastResumeReceipt: NpAgentRuntimeResumeReceiptV1 | null = null;
  if (raw.lastResumeReceipt !== null) {
    const receipt = record(
      raw.lastResumeReceipt,
      `${path}.lastResumeReceipt`,
      ["plan", "revision", "settingsHash", "completedAt"],
      state,
    );
    lastResumeReceipt = {
      plan: parsePlan(receipt.plan, `${path}.lastResumeReceipt.plan`, state),
      revision: revision(receipt.revision, `${path}.lastResumeReceipt.revision`),
      settingsHash: canonicalBodySha256Digest(
        receipt.settingsHash,
        `${path}.lastResumeReceipt.settingsHash`,
      ),
      completedAt: canonicalBodyUtc(receipt.completedAt, `${path}.lastResumeReceipt.completedAt`),
    };
    if (
      lastResumeReceipt.revision !== lastResumeReceipt.plan.revision + 1 ||
      lastResumeReceipt.revision > currentRevision ||
      Date.parse(lastResumeReceipt.completedAt) < Date.parse(lastResumeReceipt.plan.issuedAt) ||
      Date.parse(lastResumeReceipt.completedAt) >= Date.parse(lastResumeReceipt.plan.expiresAt)
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.lastResumeReceipt`,
        "receipt must prove a timely single revision transition",
      );
  }
  if (currentResumePlan && currentResumePlan.revision !== currentRevision)
    failCanonicalBody(
      "invalid-field",
      `${path}.currentResumePlan`,
      "plan must bind the current revision",
    );
  if (currentResumePlan && lastResumeReceipt)
    failCanonicalBody(
      "invalid-field",
      path,
      "a pending plan and consumed receipt are mutually exclusive",
    );
  return { revision: currentRevision, currentResumePlan, lastResumeReceipt };
}
function parseResult(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRuntimeOpsResultV1 {
  const raw = record(
    value,
    path,
    ["schemaVersion", "operation", "outcome", "errorCode", "status", "plan"],
    state,
  );
  if (raw.schemaVersion !== "np.agent-runtime-ops.v1")
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid runtime ops version");
  const operation = canonicalBodyEnum<NpAgentRuntimeOpsResultV1["operation"]>(
    raw.operation,
    `${path}.operation`,
    new Set(["status", "pause", "resume-plan", "resume"]),
  );
  const outcome = canonicalBodyEnum<NpAgentRuntimeOpsResultV1["outcome"]>(
    raw.outcome,
    `${path}.outcome`,
    new Set(["status", "paused", "planned", "resumed", "blocked"]),
  );
  const errorCode =
    raw.errorCode === null
      ? null
      : canonicalBodyEnum<NpAgentRuntimeOpsErrorCodeV1>(
          raw.errorCode,
          `${path}.errorCode`,
          new Set(npAgentRuntimeOpsErrorCodesV1),
        );
  const status = raw.status === null ? null : parseStatus(raw.status, `${path}.status`, state);
  const plan = raw.plan === null ? null : parsePlan(raw.plan, `${path}.plan`, state);
  const expected = {
    status: "status",
    pause: "paused",
    "resume-plan": "planned",
    resume: "resumed",
  }[operation];
  if (
    (outcome === "blocked") !== (errorCode !== null) ||
    (outcome !== "blocked" && (outcome !== expected || status === null)) ||
    (outcome === "planned") !== (plan !== null) ||
    (plan !== null && (plan.siteId !== status?.siteId || plan.revision !== status.revision)) ||
    (outcome === "paused" && status?.paused !== true) ||
    (outcome === "resumed" && (status?.paused !== false || status.enabled !== true)) ||
    (outcome === "planned" && (status?.paused !== true || status.enabled !== true))
  )
    failCanonicalBody("invalid-field", path, "runtime result state is inconsistent");
  return { schemaVersion: "np.agent-runtime-ops.v1", operation, outcome, errorCode, status, plan };
}
export const npAnalyzeAgentRuntimeReadinessV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.runtimeReadiness", () =>
    parseReadiness(
      cloneCanonicalRuntimeInput(value, "agent.runtimeReadiness", 1024),
      "agent.runtimeReadiness",
      { seen: new WeakSet<object>() },
    ),
  );
export const npRequireAgentRuntimeReadinessV1 = (value: unknown): NpAgentRuntimeReadinessV1 =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeReadinessV1(value));
export const npAnalyzeAgentRuntimeStatusV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.runtimeStatus", () =>
    parseStatus(
      cloneCanonicalRuntimeInput(value, "agent.runtimeStatus", 4096),
      "agent.runtimeStatus",
      { seen: new WeakSet<object>() },
    ),
  );
export const npRequireAgentRuntimeStatusV1 = (value: unknown): NpAgentRuntimeStatusV1 =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStatusV1(value));
export const npAnalyzeAgentRuntimeResumePlanV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.runtimeResumePlan", () =>
    parsePlan(
      cloneCanonicalRuntimeInput(value, "agent.runtimeResumePlan", 4096),
      "agent.runtimeResumePlan",
      { seen: new WeakSet<object>() },
    ),
  );
export const npRequireAgentRuntimeResumePlanV1 = (value: unknown): NpAgentRuntimeResumePlanV1 =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeResumePlanV1(value));
export const npAnalyzeAgentRuntimeControlV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.runtimeControl", () =>
    parseControl(
      cloneCanonicalRuntimeInput(value, "agent.runtimeControl", 8192),
      "agent.runtimeControl",
      { seen: new WeakSet<object>() },
    ),
  );
export const npRequireAgentRuntimeControlV1 = (value: unknown): NpAgentRuntimeControlV1 =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeControlV1(value));
export const npAnalyzeAgentRuntimeOpsResultV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.runtimeOps", () =>
    parseResult(cloneCanonicalRuntimeInput(value, "agent.runtimeOps", 8192), "agent.runtimeOps", {
      seen: new WeakSet<object>(),
    }),
  );
export const npRequireAgentRuntimeOpsResultV1 = (value: unknown): NpAgentRuntimeOpsResultV1 =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeOpsResultV1(value));
