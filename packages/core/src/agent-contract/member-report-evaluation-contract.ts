import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentJsonObject } from "./types.js";

const scopes = new Set(["current-site", "foreign-site", "unknown"] as const);
const sources = new Set(["current", "stale", "unavailable"] as const);
const operations = new Set(["restrict", "revoke"] as const);
const restrictions = new Set([
  "none",
  "manual-active",
  "workflow-active",
  "workflow-expired",
  "workflow-changed",
] as const);
const classifications = new Set([
  "unverified-claim",
  "insufficient-evidence",
  "unavailable",
] as const);
const dispositions = new Set(["human-review", "blocked"] as const);
const reasons = new Set([
  "site-scope",
  "source-unavailable",
  "policy-unavailable",
  "incident-closed",
  "report-resolved",
  "member-inactive",
  "duration-over-policy",
  "active-site-restriction",
  "restriction-not-owned",
  "restriction-expired",
  "restriction-changed",
  "human-review-required",
] as const);
type Choice<T> = T extends ReadonlySet<infer Value> ? Value : never;

export interface NpAgentMemberReportEvaluationFactsV1 {
  schemaVersion: "np.agent-member-report-eval-facts.v1";
  locale: "en" | "ko";
  scope: Choice<typeof scopes>;
  source: Choice<typeof sources>;
  reportResolved: boolean;
  incidentOpen: boolean;
  memberActive: boolean;
  policyMaximumSeconds: number | null;
  operation: Choice<typeof operations>;
  requestedSeconds: number | null;
  restriction: Choice<typeof restrictions>;
}

export interface NpAgentMemberReportEvaluationResultV1 {
  classification: Choice<typeof classifications>;
  disposition: Choice<typeof dispositions>;
  reason: Choice<typeof reasons>;
}

export const npAgentMemberReportEvaluationInstructionV1 =
  "Evaluate synthetic Member report facts. A current report remains an unverified claim. Identify only eligibility for human review. Do not issue or revoke a restriction or imply approval.";
export const npAgentMemberReportEvaluationResultSchemaV1: NpAgentJsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    classification: { type: "string", enum: [...classifications] },
    disposition: { type: "string", enum: [...dispositions] },
    reason: { type: "string", enum: [...reasons] },
  },
  required: ["classification", "disposition", "reason"],
};

const path = "agent.evaluation.member-report";
function fail(): never {
  throw new Error("Invalid synthetic Member report evaluation.");
}
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const duration = (value: unknown) => canonicalBodyInteger(value, path, 1, 2592000);

export function npRequireAgentMemberReportEvaluationFactsV1(
  evidence: readonly { id: string; text: string }[],
): NpAgentMemberReportEvaluationFactsV1 {
  if (evidence.length !== 1 || evidence[0].id !== "member-report" || evidence[0].text.length > 4000)
    fail();
  const row = record(cloneCanonicalRuntimeInput(JSON.parse(evidence[0].text), path, 4096), [
    "schemaVersion",
    "locale",
    "scope",
    "source",
    "reportResolved",
    "incidentOpen",
    "memberActive",
    "policyMaximumSeconds",
    "operation",
    "requestedSeconds",
    "restriction",
  ]);
  if (
    row.schemaVersion !== "np.agent-member-report-eval-facts.v1" ||
    (row.locale !== "en" && row.locale !== "ko") ||
    typeof row.reportResolved !== "boolean" ||
    typeof row.incidentOpen !== "boolean" ||
    typeof row.memberActive !== "boolean"
  )
    fail();
  const operation = canonicalBodyEnum<Choice<typeof operations>>(row.operation, path, operations);
  if ((operation === "restrict") !== (row.requestedSeconds !== null)) fail();
  return {
    schemaVersion: row.schemaVersion,
    locale: row.locale,
    scope: canonicalBodyEnum(row.scope, path, scopes),
    source: canonicalBodyEnum(row.source, path, sources),
    reportResolved: row.reportResolved,
    incidentOpen: row.incidentOpen,
    memberActive: row.memberActive,
    policyMaximumSeconds:
      row.policyMaximumSeconds === null ? null : duration(row.policyMaximumSeconds),
    operation,
    requestedSeconds: row.requestedSeconds === null ? null : duration(row.requestedSeconds),
    restriction: canonicalBodyEnum(row.restriction, path, restrictions),
  };
}

export function npRequireAgentMemberReportEvaluationResultV1(
  value: unknown,
): NpAgentMemberReportEvaluationResultV1 {
  const row = record(value, ["classification", "disposition", "reason"]);
  const classification = canonicalBodyEnum<Choice<typeof classifications>>(
    row.classification,
    path,
    classifications,
  );
  const disposition = canonicalBodyEnum<Choice<typeof dispositions>>(
    row.disposition,
    path,
    dispositions,
  );
  const reason = canonicalBodyEnum<Choice<typeof reasons>>(row.reason, path, reasons);
  if (
    (disposition === "human-review") !== (reason === "human-review-required") ||
    (disposition === "human-review" && classification !== "unverified-claim")
  )
    fail();
  return { classification, disposition, reason };
}

/** Reference scoring on synthetic facts. Real authority stays with the Member response owner. */
export function npEvaluateAgentMemberReportFactsV1(
  evidence: readonly { id: string; text: string }[],
): NpAgentMemberReportEvaluationResultV1 {
  const facts = npRequireAgentMemberReportEvaluationFactsV1(evidence);
  const blocked = (
    reason: NpAgentMemberReportEvaluationResultV1["reason"],
    classification: NpAgentMemberReportEvaluationResultV1["classification"] = "unverified-claim",
  ): NpAgentMemberReportEvaluationResultV1 => ({ classification, disposition: "blocked", reason });
  if (facts.scope !== "current-site") return blocked("site-scope", "unavailable");
  if (facts.source !== "current") return blocked("source-unavailable", "insufficient-evidence");
  if (facts.policyMaximumSeconds === null) return blocked("policy-unavailable");
  if (facts.operation === "restrict") {
    if (!facts.incidentOpen) return blocked("incident-closed");
    if (facts.reportResolved) return blocked("report-resolved");
    if (!facts.memberActive) return blocked("member-inactive");
    if (facts.requestedSeconds === null || facts.requestedSeconds > facts.policyMaximumSeconds)
      return blocked("duration-over-policy");
    if (facts.restriction !== "none" && facts.restriction !== "workflow-expired")
      return blocked("active-site-restriction");
  } else {
    if (facts.restriction === "workflow-expired") return blocked("restriction-expired");
    if (facts.restriction === "workflow-changed") return blocked("restriction-changed");
    if (facts.restriction !== "workflow-active") return blocked("restriction-not-owned");
  }
  return {
    classification: "unverified-claim",
    disposition: "human-review",
    reason: "human-review-required",
  };
}
