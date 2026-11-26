import { npRequireAgentContractResult } from "./contract.js";
import {
  parseActivityRuntimeDiagnosticsV1,
  type NpAgentActivityRuntimeDiagnosticsV1,
} from "./activity-runtime-diagnostics.js";
import {
  parseActivityRuntimeOperationsV1,
  type NpAgentActivityRuntimeOperationV1,
} from "./activity-runtime-operations.js";
export type { NpAgentActivityRuntimeOperationV1 } from "./activity-runtime-operations.js";
export { npAgentActivityProviderCallLimitV1 } from "./activity-runtime-diagnostics.js";
export type { NpAgentActivityRuntimeDiagnosticsV1 } from "./activity-runtime-diagnostics.js";
import {
  npRequireAgentOperatorReviewV1,
  type NpAgentOperatorReviewV1,
} from "./operator-review-contract.js";
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
  npAgentRecipeTemplates,
  npAgentRecipeTriggerKinds,
  npAgentRunStates,
  npAgentActionStates,
  type NpAgentCapabilityId,
  type NpAgentRecipeTemplate,
  type NpAgentRecipeTriggerKind,
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
  agentId?: string;
  approvalId?: string;
  changeSetId?: string;
  incidentId?: string;
  template?: NpAgentRecipeTemplate;
  q?: string;
  triggerKind?: NpAgentRecipeTriggerKind;
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
/** A receipt-backed historical identity, never a reconstructed execution Run. */
export interface NpAgentActivityExpiredRunV1 {
  schemaVersion: "np.agent-activity-run-expired.v1";
  runId: string;
  siteId: string;
  principalId: string;
  agent: { id: string; versionId: string };
  state: "succeeded" | "failed" | "cancelled" | "policy_blocked" | "budget_blocked";
  finishedAt: string;
  releasedAt: string;
  evidence: "expired";
}
export type NpAgentActivityRunResourceV1 =
  | (NpAgentActivityRunDetailV1 & {
      runtimeDiagnostics?: NpAgentActivityRuntimeDiagnosticsV1 | null;
      runtimeOperations?: NpAgentActivityRuntimeOperationV1[];
      runtimeRetrySourceRunId?: string;
      related?: NpAgentActivityRunLinksV1;
    })
  | NpAgentActivityExpiredRunV1;

const relatedKeys = ["incidentIds", "approvalIds", "changeSetIds"] as const;
export const npAgentActivityRunLinkLimitV1 = 10;
export type NpAgentActivityRunLinksV1 = Record<(typeof relatedKeys)[number], string[]>;

function parseRunLinks(value: unknown): NpAgentActivityRunLinksV1 {
  const record = canonicalBodyRecord(value, "related", relatedKeys, relatedKeys, {
    seen: new WeakSet(),
  });
  function parse(key: (typeof relatedKeys)[number]) {
    const ids = record[key];
    const path = `related.${key}`;
    if (!Array.isArray(ids) || ids.length > npAgentActivityRunLinkLimitV1)
      return failCanonicalBody("invalid-field", path, "must be a bounded ID list");
    const parsed = ids.map((id) => canonicalBodyUuid(id, path));
    if (new Set(parsed).size !== parsed.length)
      return failCanonicalBody("invalid-field", path, "must not contain duplicate IDs");
    return parsed;
  }
  return {
    incidentIds: parse("incidentIds"),
    approvalIds: parse("approvalIds"),
    changeSetIds: parse("changeSetIds"),
  };
}

export function npAnalyzeAgentActivityRunResourceV1(value: unknown) {
  return analyzeCanonicalBody("agent.activity.runResource", (): NpAgentActivityRunResourceV1 => {
    const cloned = cloneCanonicalRuntimeInput(value, "agent.activity.runResource", 512 * 1024);
    const r = canonicalBodyRecord(
      cloned,
      "agent.activity.runResource",
      [
        "schemaVersion",
        "run",
        "invocationId",
        "evidence",
        "auditEventIds",
        "runtimeDiagnostics",
        "runtimeOperations",
        "runtimeRetrySourceRunId",
        "related",
        "runId",
        "siteId",
        "principalId",
        "agent",
        "state",
        "finishedAt",
        "releasedAt",
      ],
      ["schemaVersion"],
      { seen: new WeakSet() },
    );
    if (r.schemaVersion === "np.agent-activity-run.v1") {
      const { runtimeDiagnostics, runtimeOperations, runtimeRetrySourceRunId, related, ...base } =
        r;
      const detail = npRequireAgentActivityRunDetailV1(base);
      const retrySource = Object.hasOwn(r, "runtimeRetrySourceRunId")
        ? canonicalBodyUuid(runtimeRetrySourceRunId, "runtimeRetrySourceRunId")
        : undefined;
      if (
        retrySource &&
        (detail.run.origin !== "runtime" ||
          detail.evidence !== "redacted" ||
          retrySource === detail.run.id)
      )
        failCanonicalBody(
          "invalid-field",
          "runtimeRetrySourceRunId",
          "must identify a different Runtime Run",
        );
      return {
        ...detail,
        ...(Object.hasOwn(r, "runtimeDiagnostics")
          ? {
              runtimeDiagnostics: parseActivityRuntimeDiagnosticsV1(runtimeDiagnostics, detail.run),
            }
          : {}),
        ...(Object.hasOwn(r, "related") ? { related: parseRunLinks(related) } : {}),
        ...(Object.hasOwn(r, "runtimeOperations")
          ? { runtimeOperations: parseActivityRuntimeOperationsV1(runtimeOperations, detail.run) }
          : {}),
        ...(retrySource ? { runtimeRetrySourceRunId: retrySource } : {}),
      };
    }
    const keys = [
      "schemaVersion",
      "runId",
      "siteId",
      "principalId",
      "agent",
      "state",
      "finishedAt",
      "releasedAt",
      "evidence",
    ];
    canonicalBodyRecord(cloned, "agent.activity.expiredRun", keys, keys, { seen: new WeakSet() });
    const agent = canonicalBodyRecord(r.agent, "agent", ["id", "versionId"], ["id", "versionId"], {
      seen: new WeakSet(),
    });
    const finishedAt = canonicalBodyUtc(r.finishedAt, "finishedAt");
    const releasedAt = canonicalBodyUtc(r.releasedAt, "releasedAt");
    if (releasedAt < finishedAt)
      failCanonicalBody("invalid-field", "releasedAt", "must not precede completion");
    return {
      schemaVersion: canonicalBodyEnum<"np.agent-activity-run-expired.v1">(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-activity-run-expired.v1"] as const),
      ),
      runId: canonicalBodyUuid(r.runId, "runId"),
      siteId: canonicalRuntimeText(r.siteId, "siteId", 128, { requireTrimmed: true }),
      principalId: canonicalBodyUuid(r.principalId, "principalId"),
      agent: {
        id: canonicalBodyUuid(agent.id, "agent.id"),
        versionId: canonicalBodyUuid(agent.versionId, "agent.versionId"),
      },
      state: canonicalBodyEnum(
        r.state,
        "state",
        new Set(["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"] as const),
      ),
      finishedAt,
      releasedAt,
      evidence: canonicalBodyEnum<"expired">(r.evidence, "evidence", new Set(["expired"] as const)),
    };
  });
}
export function npRequireAgentActivityRunResourceV1(value: unknown) {
  return npRequireAgentContractResult(npAnalyzeAgentActivityRunResourceV1(value));
}

/** Explicit allowlist for user-initiated support sharing. Never encode the resource itself. */
export function npBuildAgentActivityRunSupportBundleV1(detail: NpAgentActivityRunResourceV1) {
  const schemaVersion = "np.agent-activity-run-support.v1" as const;
  if (detail.schemaVersion === "np.agent-activity-run-expired.v1") {
    const { siteId, runId, state, finishedAt, releasedAt, evidence } = detail;
    return { schemaVersion, siteId, runId, state, finishedAt, releasedAt, evidence };
  }
  const {
    siteId,
    id: runId,
    origin,
    state,
    queuedAt,
    startedAt,
    finishedAt,
    attempt,
    errorCode,
  } = detail.run;
  return {
    schemaVersion,
    siteId,
    runId,
    origin,
    state,
    queuedAt,
    startedAt,
    finishedAt,
    attempt,
    errorCode,
    evidence: detail.evidence,
    invocationId: detail.invocationId,
    auditEventIds: detail.auditEventIds,
  };
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
  operatorReview?: NpAgentOperatorReviewV1;
  changeSetId?: string;
  verificationResult?: {
    state: "queued" | "running" | "passed" | "failed";
    completedAt: string | null;
    digest: string | null;
  };
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
  runs: [
    "limit",
    "cursor",
    "state",
    "principalId",
    "origin",
    "agentId",
    "triggerKind",
    "capabilityId",
    "approvalId",
    "changeSetId",
    "incidentId",
    "template",
    "q",
    "from",
    "to",
  ],
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
    for (const key of [
      "principalId",
      "runId",
      "agentId",
      "approvalId",
      "changeSetId",
      "incidentId",
    ] as const)
      if (r[key] !== undefined) q[key] = canonicalBodyUuid(r[key], key);
    for (const key of ["from", "to"] as const)
      if (r[key] !== undefined) q[key] = canonicalBodyUtc(r[key], key);
    if (q.from && q.to && q.from > q.to)
      failCanonicalBody("invalid-field", "to", "must not precede from");
    if (r.kind !== undefined)
      q.kind = canonicalBodyEnum(r.kind, "kind", new Set(["external", "runtime"]));
    if (r.origin !== undefined)
      q.origin = canonicalBodyEnum(r.origin, "origin", new Set(["gateway", "runtime"]));
    if (r.template !== undefined)
      q.template = canonicalBodyEnum(r.template, "template", new Set(npAgentRecipeTemplates));
    if (r.q !== undefined) {
      const term = canonicalRuntimeText(r.q, "q", 128, { requireTrimmed: true });
      if (!/^[a-z0-9][a-z0-9._:-]*$/iu.test(term))
        return failCanonicalBody("invalid-field", "q", "must be a run or operation identifier");
      q.q = term;
    }
    if (r.triggerKind !== undefined)
      q.triggerKind = canonicalBodyEnum(
        r.triggerKind,
        "triggerKind",
        new Set(npAgentRecipeTriggerKinds),
      );
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
function analyzeAction(value: unknown, includeDetail: boolean) {
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
      "operatorReview",
    ];
    const r = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, "agent.activity.action", 512 * 1024),
      "agent.activity.action",
      includeDetail ? [...allowed, "changeSetId", "verificationResult"] : allowed,
      allowed.filter((key) => key !== "operatorReview"),
      {
        seen: new WeakSet(),
      },
    );
    const action = npRequireAgentContractResult(npAnalyzeAgentActionProjectionV1(r.action));
    const operatorReview =
      r.operatorReview === undefined ? undefined : npRequireAgentOperatorReviewV1(r.operatorReview);
    if (operatorReview && operatorReview.capabilityId !== action.capabilityId)
      failCanonicalBody("invalid-field", "operatorReview", "must match this Action capability");
    const changeSetId =
      r.changeSetId === undefined ? undefined : canonicalBodyUuid(r.changeSetId, "changeSetId");
    if (
      changeSetId &&
      (!action.runId ||
        !["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(
          action.capabilityId,
        ))
    )
      failCanonicalBody(
        "invalid-field",
        "changeSetId",
        "requires a Run-linked ChangeSet execution capability",
      );
    let verificationResult: NpAgentActivityActionDetailV1["verificationResult"];
    if (r.verificationResult !== undefined) {
      const path = "verificationResult";
      const keys = ["state", "completedAt", "digest"];
      const verification = canonicalBodyRecord(r.verificationResult, path, keys, keys, {
        seen: new WeakSet(),
      });
      const state = canonicalBodyEnum<NonNullable<typeof verificationResult>["state"]>(
        verification.state,
        path,
        new Set(["queued", "running", "passed", "failed"]),
      );
      const completedAt =
        verification.completedAt === null ? null : canonicalBodyUtc(verification.completedAt, path);
      const digest =
        verification.digest === null ? null : canonicalBodySha256Digest(verification.digest, path);
      const terminal = state === "passed" || state === "failed";
      if (
        terminal !== (completedAt !== null) ||
        terminal !== (digest !== null) ||
        (completedAt !== null && completedAt < action.createdAt) ||
        (!changeSetId && (!terminal || action.verificationState !== state))
      )
        failCanonicalBody("invalid-field", path, "must match recorded verification evidence");
      verificationResult = { state, completedAt, digest };
    }
    return {
      schemaVersion: canonicalBodyEnum<"np.agent-activity-action.v1">(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-activity-action.v1"]),
      ),
      action,
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
      ...(operatorReview === undefined ? {} : { operatorReview }),
      ...(changeSetId === undefined ? {} : { changeSetId }),
      ...(verificationResult === undefined ? {} : { verificationResult }),
    };
  });
}
export function npAnalyzeAgentActivityActionDetailV1(value: unknown) {
  return analyzeAction(value, true);
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
    analyzeItem: (value) => analyzeAction(value, false),
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
      "operatorReview",
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
