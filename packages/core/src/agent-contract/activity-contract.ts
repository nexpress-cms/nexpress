import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodySha256Digest,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
} from "./canonical-runtime-primitives.js";
import {
  npAgentCapabilityIds,
  npAgentRunStates,
  npAgentActionStates,
  type NpAgentCapabilityId,
} from "./types.js";
import {
  npAnalyzeAgentPrincipalV1,
  npAnalyzeAgentRunV1,
  npAnalyzeAgentActionProjectionV1,
  npAnalyzeAgentCursorPageV1,
  type NpAgentPrincipalV1,
  type NpAgentRunV1,
  type NpAgentActionProjectionV1,
  type NpAgentCursorPageV1,
} from "./wire-contract.js";

export type NpAgentActivityKindV1 = "principals" | "runs" | "actions";
export interface NpAgentActivityQueryV1 {
  limit?: number;
  cursor?: string;
  principalId?: string;
  runId?: string;
  origin?: "gateway" | "runtime";
  kind?: "external" | "runtime";
  state?: string;
  capabilityId?: NpAgentCapabilityId;
  from?: string;
  to?: string;
}
export interface NpAgentActivityRunDetailV1 {
  schemaVersion: "np.agent-activity-run.v1";
  run: NpAgentRunV1;
  invocationId: string | null;
  evidence: "redacted" | "expired";
  auditEventIds: string[];
}
export interface NpAgentActivityActionDetailV1 {
  schemaVersion: "np.agent-activity-action.v1";
  action: NpAgentActionProjectionV1;
  principalId: string;
  invocationId: string | null;
  inputHash: string;
  outputHash: string | null;
  auditEventId: string | null;
  evidence: "redacted" | "expired";
}
export type NpAgentActivityPrincipalsPageV1 = NpAgentCursorPageV1<
  NpAgentPrincipalV1,
  "np.agent-activity-principals.v1"
>;
export type NpAgentActivityRunsPageV1 = NpAgentCursorPageV1<
  NpAgentActivityRunDetailV1,
  "np.agent-activity-runs.v1"
>;
export type NpAgentActivityActionsPageV1 = NpAgentCursorPageV1<
  NpAgentActivityActionDetailV1,
  "np.agent-activity-actions.v1"
>;
const keys = {
  principals: ["limit", "cursor", "state", "kind", "from", "to"],
  runs: ["limit", "cursor", "state", "principalId", "origin", "capabilityId", "from", "to"],
  actions: ["limit", "cursor", "state", "principalId", "runId", "capabilityId", "from", "to"],
} as const;
export function npAnalyzeAgentActivityQueryV1(kind: NpAgentActivityKindV1, value: unknown) {
  return analyzeCanonicalBody("agent.activity.query", () => {
    const r = canonicalBodyRecord(value, "agent.activity.query", keys[kind], [], {
      seen: new WeakSet(),
    });
    const q: NpAgentActivityQueryV1 = {};
    if (r.limit !== undefined) q.limit = canonicalBodyInteger(r.limit, "limit", 1, 100);
    if (r.cursor !== undefined)
      q.cursor = canonicalRuntimeText(r.cursor, "cursor", 2048, { requireTrimmed: true });
    if (r.state !== undefined)
      q.state = canonicalBodyEnum(
        r.state,
        "state",
        new Set(
          kind === "principals"
            ? ["active", "suspended", "revoked"]
            : kind === "runs"
              ? npAgentRunStates
              : npAgentActionStates,
        ),
      );
    for (const key of ["principalId", "runId"] as const)
      if (r[key] !== undefined) q[key] = canonicalBodyUuid(r[key], key);
    for (const key of ["from", "to"] as const)
      if (r[key] !== undefined) q[key] = canonicalBodyUtc(r[key], key);
    if (q.from && q.to && q.from > q.to)
      failCanonicalBody("invalid-field", "to", "must not precede from");
    if (r.kind !== undefined)
      q.kind = canonicalBodyEnum(r.kind, "kind", new Set(["external", "runtime"]));
    if (r.origin !== undefined)
      q.origin = canonicalBodyEnum(r.origin, "origin", new Set(["gateway", "runtime"]));
    if (r.capabilityId !== undefined)
      q.capabilityId = canonicalBodyEnum(
        r.capabilityId,
        "capabilityId",
        new Set(npAgentCapabilityIds),
      );
    return q;
  });
}
export function npRequireAgentActivityQueryV1(kind: NpAgentActivityKindV1, value: unknown) {
  return npRequireAgentContractResult(npAnalyzeAgentActivityQueryV1(kind, value));
}
const nullableUuid = (v: unknown) => (v === null ? null : canonicalBodyUuid(v, "id"));
export function npAnalyzeAgentActivityRunDetailV1(value: unknown) {
  return analyzeCanonicalBody("agent.activity.run", () => {
    const r = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, "agent.activity.run", 512 * 1024),
      "agent.activity.run",
      ["schemaVersion", "run", "invocationId", "evidence", "auditEventIds"],
      ["schemaVersion", "run", "invocationId", "evidence", "auditEventIds"],
      { seen: new WeakSet() },
    );
    if (!Array.isArray(r.auditEventIds) || r.auditEventIds.length > 100)
      failCanonicalBody("invalid-field", "auditEventIds", "must be bounded");
    return {
      schemaVersion: canonicalBodyEnum<"np.agent-activity-run.v1">(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-activity-run.v1"]),
      ),
      run: npRequireAgentContractResult(npAnalyzeAgentRunV1(r.run)),
      invocationId: nullableUuid(r.invocationId),
      evidence: canonicalBodyEnum<"redacted" | "expired">(
        r.evidence,
        "evidence",
        new Set(["redacted", "expired"]),
      ),
      auditEventIds: r.auditEventIds.map((v) => canonicalBodyUuid(v, "auditEventIds")),
    };
  });
}
export function npRequireAgentActivityRunDetailV1(value: unknown) {
  return npRequireAgentContractResult(npAnalyzeAgentActivityRunDetailV1(value));
}
export function npAnalyzeAgentActivityActionDetailV1(value: unknown) {
  return analyzeCanonicalBody("agent.activity.action", () => {
    const allowed = [
      "schemaVersion",
      "action",
      "principalId",
      "invocationId",
      "evidence",
      "inputHash",
      "outputHash",
      "auditEventId",
    ];
    const r = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, "agent.activity.action", 512 * 1024),
      "agent.activity.action",
      allowed,
      allowed,
      {
        seen: new WeakSet(),
      },
    );
    return {
      schemaVersion: canonicalBodyEnum<"np.agent-activity-action.v1">(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-activity-action.v1"]),
      ),
      action: npRequireAgentContractResult(npAnalyzeAgentActionProjectionV1(r.action)),
      principalId: canonicalBodyUuid(r.principalId, "principalId"),
      invocationId: nullableUuid(r.invocationId),
      evidence: canonicalBodyEnum<"redacted" | "expired">(
        r.evidence,
        "evidence",
        new Set(["redacted", "expired"]),
      ),
      inputHash: canonicalBodySha256Digest(r.inputHash, "inputHash"),
      outputHash:
        r.outputHash === null ? null : canonicalBodySha256Digest(r.outputHash, "outputHash"),
      auditEventId: nullableUuid(r.auditEventId),
    };
  });
}
export function npRequireAgentActivityActionDetailV1(value: unknown) {
  return npRequireAgentContractResult(npAnalyzeAgentActivityActionDetailV1(value));
}
export const npAnalyzeAgentActivityPrincipalsPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-activity-principals.v1" as const,
    analyzeItem: npAnalyzeAgentPrincipalV1,
    itemIssueRoot: "principal",
    maximumItems: 100,
  });
export const npAnalyzeAgentActivityRunsPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-activity-runs.v1" as const,
    analyzeItem: npAnalyzeAgentActivityRunDetailV1,
    itemIssueRoot: "run",
    maximumItems: 100,
  });
export const npAnalyzeAgentActivityActionsPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-activity-actions.v1" as const,
    analyzeItem: npAnalyzeAgentActivityActionDetailV1,
    itemIssueRoot: "action",
    maximumItems: 100,
  });

/** Closed additive Activity discovery inventory; it grants no authorization. */
export const npAgentActivityContractV1 = {
  schemaVersion: "np.agent-activity-contract.v1",
  filters: keys,
  states: {
    principals: ["active", "suspended", "revoked"],
    runs: npAgentRunStates,
    actions: npAgentActionStates,
  },
  pages: [
    "np.agent-activity-principals.v1",
    "np.agent-activity-runs.v1",
    "np.agent-activity-actions.v1",
  ],
  evidence: ["redacted", "expired"],
  maximumItems: 100,
  order: "created-desc-id-desc",
  details: {
    run: ["run", "invocationId", "evidence", "auditEventIds"],
    action: [
      "action",
      "principalId",
      "invocationId",
      "evidence",
      "inputHash",
      "outputHash",
      "auditEventId",
    ],
  },
} as const;

export const npAgentActivityReadRoutesV1 = [
  {
    method: "GET",
    path: "/api/admin/agents/gateway/principals",
    kind: "principals",
    detail: false,
  },
  {
    method: "GET",
    path: "/api/admin/agents/gateway/principals/{id}",
    kind: "principals",
    detail: true,
  },
  { method: "GET", path: "/api/admin/agents/activity", kind: "runs", detail: false },
  { method: "GET", path: "/api/admin/agents/activity/{id}", kind: "runs", detail: true },
  { method: "GET", path: "/api/admin/agents/activity/actions", kind: "actions", detail: false },
  { method: "GET", path: "/api/admin/agents/activity/actions/{id}", kind: "actions", detail: true },
] as const;
