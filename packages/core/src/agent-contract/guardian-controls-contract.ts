import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1 = "guardian.control";
export const NP_AGENT_GUARDIAN_ENABLE_PLAN_LIFETIME_MS_V1 = 300000;
export const npAgentGuardianControlErrorCodesV1 = [
  "GUARDIAN_ARGUMENT_INVALID",
  "GUARDIAN_AUTHORITY_REQUIRED",
  "GUARDIAN_UNAVAILABLE",
  "GUARDIAN_SITE_UNAVAILABLE",
  "GUARDIAN_STATE_INVALID",
  "GUARDIAN_REVISION_CONFLICT",
  "GUARDIAN_DISABLED",
  "GUARDIAN_SOURCE_ABSENT",
  "GUARDIAN_PLAN_INVALID",
  "GUARDIAN_PLAN_EXPIRED",
  "GUARDIAN_READINESS_BLOCKED",
  "GUARDIAN_NOT_DISABLED",
  "GUARDIAN_EXECUTE_REQUIRED",
  "GUARDIAN_APPROVAL_REQUIRED",
  "GUARDIAN_ARTIFACT_UNAVAILABLE",
] as const;
export type NpAgentGuardianControlErrorCodeV1 = (typeof npAgentGuardianControlErrorCodesV1)[number];
export interface NpAgentGuardianEnablePlanV1 {
  schemaVersion: "np.agent-guardian-enable-plan.v1";
  id: string;
  siteId: string;
  actorFingerprint: string;
  revision: number;
  controlDigest: string;
  registrationFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  planHash: string;
}
/** Private persisted state. Absence preserves explicitly installed source capture authority. */
export interface NpAgentGuardianControlV1 {
  schemaVersion: "np.agent-guardian-control.v1";
  revision: number;
  enabled: boolean;
  currentEnablePlan: NpAgentGuardianEnablePlanV1 | null;
  lastEnableReceipt: {
    plan: NpAgentGuardianEnablePlanV1;
    revision: number;
    completedAt: string;
  } | null;
}
export interface NpAgentGuardianCaptureAdmissionV1 {
  schemaVersion: "np.agent-guardian-capture-admission.v1";
  state: "enabled-by-registration" | "enabled" | "disabled";
  reason: "HOST_REGISTRATION" | "OPERATOR_ENABLED" | "OPERATOR_DISABLED" | "SOURCE_ABSENT";
  /** Null for an absent source: its control was not read or asserted. */
  configured: boolean | null;
  revision: number | null;
  controlDigest: string | null;
}
export interface NpAgentGuardianControlStatusV1 {
  schemaVersion: "np.agent-guardian-control-status.v1";
  siteId: string;
  configured: boolean;
  revision: number;
  capture: "enabled-by-registration" | "enabled" | "disabled" | "unavailable";
  registration: {
    state: "registered" | "absent" | "unavailable";
    sourceCount: number | null;
    readiness: "ready" | "blocked" | "unavailable";
  };
  response: "separate-policy-required";
  generatedAt: string;
}
export interface NpAgentGuardianControlOpsResultV1 {
  schemaVersion: "np.agent-guardian-control-ops.v1";
  operation: "status" | "disable" | "enable-plan" | "enable";
  outcome: "status" | "disabled" | "planned" | "enabled" | "blocked";
  errorCode: NpAgentGuardianControlErrorCodeV1 | null;
  status: NpAgentGuardianControlStatusV1 | null;
  plan: NpAgentGuardianEnablePlanV1 | null;
}
const p = "guardian.controls";
function fail(): never {
  return failCanonicalBody("invalid-field", p, "must match exact Guardian control state");
}
const rec = (v: unknown, keys: string[]) =>
  canonicalBodyRecord(v, p, keys, keys, { seen: new WeakSet() });
const en = <const T extends string>(v: unknown, values: readonly T[]) =>
  canonicalBodyEnum<T>(v, p, new Set(values));
const sha = (v: unknown) => canonicalBodySha256Digest(v, p);
const revision = (v: unknown) => canonicalBodyInteger(v, p, 1, 2147483647);
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") fail();
  return v;
}
export function npRequireAgentGuardianEnablePlanV1(value: unknown): NpAgentGuardianEnablePlanV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 4096), [
    "schemaVersion",
    "id",
    "siteId",
    "actorFingerprint",
    "revision",
    "controlDigest",
    "registrationFingerprint",
    "issuedAt",
    "expiresAt",
    "planHash",
  ]);
  const issuedAt = canonicalBodyUtc(r.issuedAt, p),
    expiresAt = canonicalBodyUtc(r.expiresAt, p);
  if (Date.parse(expiresAt) - Date.parse(issuedAt) !== NP_AGENT_GUARDIAN_ENABLE_PLAN_LIFETIME_MS_V1)
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-enable-plan.v1"]),
    id: canonicalBodyUuid(r.id, p),
    siteId: canonicalBodySiteId(r.siteId, p),
    actorFingerprint: sha(r.actorFingerprint),
    revision: revision(r.revision),
    controlDigest: sha(r.controlDigest),
    registrationFingerprint: sha(r.registrationFingerprint),
    issuedAt,
    expiresAt,
    planHash: sha(r.planHash),
  };
}
export function npRequireAgentGuardianControlV1(value: unknown): NpAgentGuardianControlV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 12288), [
    "schemaVersion",
    "revision",
    "enabled",
    "currentEnablePlan",
    "lastEnableReceipt",
  ]);
  const currentEnablePlan =
    r.currentEnablePlan === null ? null : npRequireAgentGuardianEnablePlanV1(r.currentEnablePlan);
  const enabled = bool(r.enabled),
    number = revision(r.revision);
  let lastEnableReceipt: NpAgentGuardianControlV1["lastEnableReceipt"] = null;
  if (r.lastEnableReceipt !== null) {
    const v = rec(r.lastEnableReceipt, ["plan", "revision", "completedAt"]);
    lastEnableReceipt = {
      plan: npRequireAgentGuardianEnablePlanV1(v.plan),
      revision: revision(v.revision),
      completedAt: canonicalBodyUtc(v.completedAt, p),
    };
    if (
      lastEnableReceipt.revision !== number ||
      lastEnableReceipt.plan.revision + 1 !== number ||
      lastEnableReceipt.completedAt < lastEnableReceipt.plan.issuedAt ||
      lastEnableReceipt.completedAt >= lastEnableReceipt.plan.expiresAt
    )
      fail();
  }
  if (
    (currentEnablePlan &&
      (enabled || currentEnablePlan.revision !== number || lastEnableReceipt !== null)) ||
    (lastEnableReceipt && !enabled) ||
    (enabled && !lastEnableReceipt)
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-control.v1"]),
    revision: number,
    enabled,
    currentEnablePlan,
    lastEnableReceipt,
  };
}
export function npRequireAgentGuardianCaptureAdmissionV1(
  value: unknown,
): NpAgentGuardianCaptureAdmissionV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 2048), [
    "schemaVersion",
    "state",
    "reason",
    "configured",
    "revision",
    "controlDigest",
  ]);
  const state = en(r.state, ["enabled-by-registration", "enabled", "disabled"]),
    reason = en(r.reason, [
      "HOST_REGISTRATION",
      "OPERATOR_ENABLED",
      "OPERATOR_DISABLED",
      "SOURCE_ABSENT",
    ]);
  const configured = r.configured === null ? null : bool(r.configured),
    number = r.revision === null ? null : canonicalBodyInteger(r.revision, p, 0, 2147483647),
    controlDigest = r.controlDigest === null ? null : sha(r.controlDigest);
  if (
    reason === "SOURCE_ABSENT"
      ? state !== "disabled" || configured !== null || number !== null || controlDigest !== null
      : !controlDigest ||
        number === null ||
        configured === null ||
        (reason === "HOST_REGISTRATION"
          ? state !== "enabled-by-registration" || configured || number !== 0
          : !configured ||
            number < 1 ||
            state !== (reason === "OPERATOR_ENABLED" ? "enabled" : "disabled"))
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-capture-admission.v1"]),
    state,
    reason,
    configured,
    revision: number,
    controlDigest,
  };
}
export function npRequireAgentGuardianControlStatusV1(
  value: unknown,
): NpAgentGuardianControlStatusV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 4096), [
    "schemaVersion",
    "siteId",
    "configured",
    "revision",
    "capture",
    "registration",
    "response",
    "generatedAt",
  ]);
  const v = rec(r.registration, ["state", "sourceCount", "readiness"]);
  const registration = {
    state: en(v.state, ["registered", "absent", "unavailable"]),
    sourceCount: v.sourceCount === null ? null : canonicalBodyInteger(v.sourceCount, p, 0, 10000),
    readiness: en(v.readiness, ["ready", "blocked", "unavailable"]),
  };
  const configured = bool(r.configured),
    number = canonicalBodyInteger(r.revision, p, 0, 2147483647),
    capture = en(r.capture, ["enabled-by-registration", "enabled", "disabled", "unavailable"]);
  if (
    configured !== number > 0 ||
    (registration.state === "unavailable"
      ? registration.sourceCount !== null || registration.readiness !== "unavailable"
      : registration.sourceCount === null ||
        (registration.state === "registered"
          ? registration.sourceCount < 1
          : registration.sourceCount !== 0)) ||
    (!configured && capture === "enabled") ||
    (configured && capture === "enabled-by-registration") ||
    ((capture === "enabled" || capture === "enabled-by-registration") &&
      registration.state !== "registered")
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-control-status.v1"]),
    siteId: canonicalBodySiteId(r.siteId, p),
    configured,
    revision: number,
    capture,
    registration,
    response: en(r.response, ["separate-policy-required"]),
    generatedAt: canonicalBodyUtc(r.generatedAt, p),
  };
}
export function npRequireAgentGuardianControlOpsResultV1(
  value: unknown,
): NpAgentGuardianControlOpsResultV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 12288), [
    "schemaVersion",
    "operation",
    "outcome",
    "errorCode",
    "status",
    "plan",
  ]);
  const operation = en(r.operation, ["status", "disable", "enable-plan", "enable"]),
    outcome = en(r.outcome, ["status", "disabled", "planned", "enabled", "blocked"]),
    errorCode = r.errorCode === null ? null : en(r.errorCode, npAgentGuardianControlErrorCodesV1);
  const status = r.status === null ? null : npRequireAgentGuardianControlStatusV1(r.status),
    plan = r.plan === null ? null : npRequireAgentGuardianEnablePlanV1(r.plan);
  if (
    outcome === "blocked"
      ? !errorCode || status !== null || plan !== null
      : errorCode !== null ||
        !status ||
        outcome !==
          (
            {
              status: "status",
              disable: "disabled",
              "enable-plan": "planned",
              enable: "enabled",
            } as const
          )[operation] ||
        (operation === "enable-plan"
          ? !plan || plan.siteId !== status.siteId || plan.revision !== status.revision
          : plan !== null) ||
        (operation === "disable" && status.capture !== "disabled")
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-control-ops.v1"]),
    operation,
    outcome,
    errorCode,
    status,
    plan,
  };
}
