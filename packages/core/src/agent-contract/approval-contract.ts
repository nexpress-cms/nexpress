import {
  npAgentApprovalWireSchemaV1,
  npCompactAgentWireSchemaV1,
} from "./changeset-capability-schema.js";
import { npRequireAgentApprovalTargetV1 } from "./canonical-approval.js";
import type { NpCapability } from "../auth/capabilities.js";
import type {
  NpAgentApprovalTargetV1,
  NpAgentApprovalReauthenticationRequirementV1,
  NpAgentApprovalRisk,
  NpAgentScope,
  NpAgentJsonSchema,
} from "./types.js";
import { npAgentScopes, npAgentCapabilityIds } from "./types.js";
import {
  npRequireAgentContractResult,
  npAgentContractLimits,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUtc,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
  canonicalBodyCapabilities,
  canonicalBodyArray,
  canonicalBodyCapabilityId,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "./canonical-runtime-primitives.js";
import {
  npRequireAgentApprovalWire,
  type NpAgentApprovalWire,
  type NpAgentPreviewSummary,
  npAgentChangeSetLimits,
} from "./changeset-wire-contract.js";
import {
  npRequireAgentChangeSetReviewV1,
  npAgentChangeSetReviewSchemaV1,
  type NpAgentChangeSetReviewV1,
} from "./changeset-review-contract.js";

export type NpAgentApprovalDecisionPurposeV1 = "approve" | "reject" | "revoke";
export interface NpAgentChangeSetRequestApprovalInputV1 {
  schemaVersion: "np.agent-changeset-request-approval-input.v1";
  expectedDraftVersion: number;
  planHash: string;
  intendedOperation: "apply" | "schedule";
  scheduledFor: string | null;
  idempotencyKey: string;
}
export interface NpAgentApprovalChallengeRequestV1 {
  schemaVersion: "np.agent-approval-challenge-request.v1";
  purpose: NpAgentApprovalDecisionPurposeV1;
  expectedApprovalVersion: number;
  statementHash: string;
  idempotencyKey: string;
}
export interface NpAgentApprovalDecisionInputV1 {
  schemaVersion: "np.agent-approval-decision-input.v1";
  expectedApprovalVersion: number;
  statementHash: string;
  challengeGeneration: number;
  challenge: string;
  idempotencyKey: string;
  reason: string | null;
}
export interface NpAgentApprovalChallengeOutputV1 {
  schemaVersion: "np.agent-approval-challenge.v1";
  approvalId: string;
  approvalVersion: number;
  purpose: NpAgentApprovalDecisionPurposeV1;
  challengeGeneration: number;
  challenge: string;
  reauthentication: NpAgentApprovalReauthenticationRequirementV1;
  expiresAt: string;
}
export interface NpAgentApprovalListItemV1 {
  schemaVersion: "np.agent-approval-list-item.v1";
  approval: NpAgentApprovalWire;
  version: number;
  target: NpAgentApprovalTargetV1;
  intendedOperation: "apply" | "schedule" | null;
  scheduledFor: string | null;
  statementHash: string;
  reauthentication: NpAgentApprovalReauthenticationRequirementV1;
  allowedDecisions: NpAgentApprovalDecisionPurposeV1[];
  risk: NpAgentApprovalRisk;
  capabilityId: string;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  policyHashes: string[];
  requiresLivePreview: boolean;
  requiredScopes: NpAgentScope[];
  requester: { kind: "staff" | "principal"; id: string | null };
  reviewSummary: {
    operationCount: number;
    targetCount: number;
    previewState: NpAgentPreviewSummary["state"] | null;
    checksRun: number | null;
    rollbackPlan: "unavailable";
  };
}
export interface NpAgentApprovalDetailV1 {
  schemaVersion: "np.agent-approval-detail.v1";
  item: NpAgentApprovalListItemV1;
  review: NpAgentChangeSetReviewV1 | null;
}
export interface NpAgentApprovalPageV1 {
  schemaVersion: "np.agent-approval-page.v1";
  items: NpAgentApprovalListItemV1[];
  nextCursor: string | null;
}
export interface NpAgentApprovalQueryV1 {
  state: NpAgentApprovalWire["state"] | null;
  risk: NpAgentApprovalRisk | null;
  targetKind: NpAgentApprovalTargetV1["kind"] | null;
  requesterKind: "staff" | "principal" | null;
  requesterId: string | null;
  requiredHumanCapability: NpCapability | null;
  createdAfter: string | null;
  createdBefore: string | null;
  expiresAfter: string | null;
  expiresBefore: string | null;
  limit: number;
  cursor: string | null;
}
const state = () => ({ seen: new WeakSet<object>() });
const positive = (v: unknown, p: string) => canonicalBodyInteger(v, p, 1, 2_147_483_647);
const enumeration = <T extends string>(v: unknown, p: string, values: readonly T[]): T =>
  canonicalBodyEnum<T>(v, p, new Set(values));
const purpose = (v: unknown, p: string) =>
  enumeration(v, p, ["approve", "reject", "revoke"] as const);
const record = (v: unknown, p: string, keys: string[]) =>
  canonicalBodyRecord(v, p, keys, keys, state());
const nullableUtc = (v: unknown, p: string) => (v === null ? null : canonicalBodyUtc(v, p));
const nullableUuid = (v: unknown, p: string) => (v === null ? null : canonicalBodyUuid(v, p));
function text(v: unknown, p: string, max: number, pattern?: RegExp) {
  const out = canonicalRuntimeText(v, p, max);
  if (pattern && !pattern.test(out)) failCanonicalBody("invalid-field", p, "Invalid value");
  return out;
}
const key = (v: unknown, p: string) => text(v, p, 256, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const challenge = (v: unknown, p: string) =>
  text(v, p, 43, /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
function reauth(v: unknown, p: string): NpAgentApprovalReauthenticationRequirementV1 {
  const r = canonicalBodyRecord(v, p, ["mode", "maxAgeSeconds", "assurance"], ["mode"], state());
  if (r.mode === "none") {
    record(v, p, ["mode"]);
    return { mode: "none" };
  }
  record(v, p, ["mode", "maxAgeSeconds", "assurance"]);
  return {
    mode: enumeration(r.mode, p, ["recent"]),
    maxAgeSeconds: canonicalBodyInteger(r.maxAgeSeconds, p, 1, 300),
    assurance: enumeration(r.assurance, p, ["staff-primary"]),
  };
}
function analyze<T>(
  name: string,
  v: unknown,
  parse: (r: Record<string, unknown>, p: string) => T,
  keys: string[],
) {
  return analyzeCanonicalBody(name, () => {
    const copy = cloneCanonicalRuntimeInput(v, name, 8 * 1024 * 1024, {
      maximumDepth: 64,
      maximumNodes: 1_000_000,
      maximumArrayItems: 262_144,
      maximumObjectProperties: 10000,
      maximumStringCharacters: 1_000_000,
    });
    return parse(record(copy, name, keys), name);
  });
}
export function npAnalyzeAgentChangeSetRequestApprovalInputV1(v: unknown) {
  return analyze(
    "agent.approval.request",
    v,
    (r, p): NpAgentChangeSetRequestApprovalInputV1 => {
      const intendedOperation = enumeration(r.intendedOperation, p, ["apply", "schedule"]);
      const scheduledFor = nullableUtc(r.scheduledFor, p);
      if ((intendedOperation === "schedule") !== (scheduledFor !== null))
        failCanonicalBody("invalid-field", p, "Schedule time must match the intended operation");
      return {
        schemaVersion: enumeration(r.schemaVersion, p, [
          "np.agent-changeset-request-approval-input.v1",
        ]),
        expectedDraftVersion: positive(r.expectedDraftVersion, p),
        planHash: canonicalBodySha256Digest(r.planHash, p),
        intendedOperation,
        scheduledFor,
        idempotencyKey: key(r.idempotencyKey, p),
      };
    },
    [
      "schemaVersion",
      "expectedDraftVersion",
      "planHash",
      "intendedOperation",
      "scheduledFor",
      "idempotencyKey",
    ],
  );
}
export const npRequireAgentChangeSetRequestApprovalInputV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentChangeSetRequestApprovalInputV1(v),
    "Invalid approval request",
  );
export function npAnalyzeAgentApprovalChallengeRequestV1(v: unknown) {
  return analyze(
    "agent.approval.challengeRequest",
    v,
    (r, p): NpAgentApprovalChallengeRequestV1 => ({
      schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-challenge-request.v1"]),
      purpose: purpose(r.purpose, p),
      expectedApprovalVersion: positive(r.expectedApprovalVersion, p),
      statementHash: canonicalBodySha256Digest(r.statementHash, p),
      idempotencyKey: key(r.idempotencyKey, p),
    }),
    ["schemaVersion", "purpose", "expectedApprovalVersion", "statementHash", "idempotencyKey"],
  );
}
export const npRequireAgentApprovalChallengeRequestV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentApprovalChallengeRequestV1(v),
    "Invalid approval challenge request",
  );
export function npAnalyzeAgentApprovalDecisionInputV1(v: unknown) {
  return analyze(
    "agent.approval.decision",
    v,
    (r, p): NpAgentApprovalDecisionInputV1 => ({
      schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-decision-input.v1"]),
      expectedApprovalVersion: positive(r.expectedApprovalVersion, p),
      statementHash: canonicalBodySha256Digest(r.statementHash, p),
      challengeGeneration: positive(r.challengeGeneration, p),
      challenge: challenge(r.challenge, p),
      idempotencyKey: key(r.idempotencyKey, p),
      reason: r.reason === null ? null : text(r.reason, p, 2000),
    }),
    [
      "schemaVersion",
      "expectedApprovalVersion",
      "statementHash",
      "challengeGeneration",
      "challenge",
      "idempotencyKey",
      "reason",
    ],
  );
}
export const npRequireAgentApprovalDecisionInputV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentApprovalDecisionInputV1(v),
    "Invalid approval decision",
  );
export function npAnalyzeAgentApprovalChallengeOutputV1(v: unknown) {
  return analyze(
    "agent.approval.challenge",
    v,
    (r, p): NpAgentApprovalChallengeOutputV1 => ({
      schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-challenge.v1"]),
      approvalId: canonicalBodyUuid(r.approvalId, p),
      approvalVersion: positive(r.approvalVersion, p),
      purpose: purpose(r.purpose, p),
      challengeGeneration: positive(r.challengeGeneration, p),
      challenge: challenge(r.challenge, p),
      reauthentication: reauth(r.reauthentication, p),
      expiresAt: canonicalBodyUtc(r.expiresAt, p),
    }),
    [
      "schemaVersion",
      "approvalId",
      "approvalVersion",
      "purpose",
      "challengeGeneration",
      "challenge",
      "reauthentication",
      "expiresAt",
    ],
  );
}
export const npRequireAgentApprovalChallengeOutputV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentApprovalChallengeOutputV1(v),
    "Invalid approval challenge",
  );
export function npAnalyzeAgentApprovalListItemV1(v: unknown) {
  return analyze(
    "agent.approval.item",
    v,
    (r, p): NpAgentApprovalListItemV1 => {
      const approval = npRequireAgentApprovalWire(r.approval);
      const parsedTarget = npRequireAgentApprovalTargetV1(r.target);
      const operation =
        r.intendedOperation === null
          ? null
          : enumeration(r.intendedOperation, p, ["apply", "schedule"]);
      const scheduledFor = nullableUtc(r.scheduledFor, p);
      if (
        parsedTarget.kind === "changeset"
          ? operation === null ||
            scheduledFor !== parsedTarget.scheduledFor ||
            (operation === "schedule") !== (scheduledFor !== null)
          : operation !== null || scheduledFor !== null
      )
        failCanonicalBody("invalid-field", p, "Target and operation must agree");
      const statementHash = canonicalBodySha256Digest(r.statementHash, p);
      if (statementHash !== approval.statementHash)
        failCanonicalBody("invalid-field", p, "Statement hashes must agree");
      const req = record(r.requester, p, ["kind", "id"]);
      const requester = {
        kind: enumeration(req.kind, p, ["staff", "principal"]),
        id: nullableUuid(req.id, p),
      };
      if (requester.kind === "principal" && requester.id === null)
        failCanonicalBody("invalid-field", p, "Principal id required");
      const allowedDecisions = canonicalBodyArray(r.allowedDecisions, p, 3, state()).map((v) =>
        purpose(v, p),
      );
      if (
        allowedDecisions.some((d, i) => i > 0 && d <= (allowedDecisions[i - 1] ?? "")) ||
        allowedDecisions.some((d) =>
          d === "revoke"
            ? !["pending", "approved"].includes(approval.state)
            : approval.state !== "pending",
        )
      )
        failCanonicalBody("invalid-field", p, "Invalid allowed decisions");
      const requiredScopes = canonicalBodyArray(
        r.requiredScopes,
        p,
        npAgentScopes.length,
        state(),
      ).map((v) => enumeration(v, p, npAgentScopes));
      if (requiredScopes.some((s, i) => i > 0 && s <= (requiredScopes[i - 1] ?? "")))
        failCanonicalBody("order", p, "Scopes must be sorted and unique");
      return {
        reviewSummary: (() => {
          const value = record(r.reviewSummary, `${p}.reviewSummary`, [
            "operationCount",
            "targetCount",
            "previewState",
            "checksRun",
            "rollbackPlan",
          ]);
          const operationCount = canonicalBodyInteger(
            value.operationCount,
            p,
            1,
            npAgentChangeSetLimits.operations,
          );
          const targetCount = canonicalBodyInteger(
            value.targetCount,
            p,
            1,
            npAgentChangeSetLimits.operations,
          );
          if (targetCount > operationCount)
            failCanonicalBody("invalid-field", p, "Target count cannot exceed operation count");
          const previewState =
            value.previewState === null
              ? null
              : enumeration(value.previewState, p, [
                  "queued",
                  "rendering",
                  "ready",
                  "failed",
                  "expired",
                ]);
          const checksRun =
            value.checksRun === null ? null : canonicalBodyInteger(value.checksRun, p, 0, 1000);
          if (previewState === null && checksRun !== null)
            failCanonicalBody("invalid-field", p, "Absent preview has no recorded check count");
          return {
            operationCount,
            targetCount,
            previewState,
            checksRun,
            rollbackPlan: enumeration(value.rollbackPlan, p, ["unavailable"]),
          };
        })(),
        schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-list-item.v1"]),
        approval,
        version: positive(r.version, p),
        target: parsedTarget,
        intendedOperation: operation,
        scheduledFor,
        statementHash,
        reauthentication: reauth(r.reauthentication, p),
        allowedDecisions,
        risk: enumeration(r.risk, p, ["reversible", "sensitive", "destructive"]),
        capabilityId: canonicalBodyCapabilityId(r.capabilityId, p),
        capabilityContractVersion: positive(r.capabilityContractVersion, p),
        capabilityFingerprint: canonicalBodySha256Digest(r.capabilityFingerprint, p),
        policyHashes: (() => {
          const hashes = canonicalBodyArray(
            r.policyHashes,
            p,
            npAgentContractLimits.jsonSchemaMaxItems,
            state(),
          ).map((v) => canonicalBodySha256Digest(v, p));
          if (hashes.some((h, i) => i > 0 && h <= (hashes[i - 1] ?? "")))
            failCanonicalBody("order", p, "Policy hashes must be sorted and unique");
          return hashes;
        })(),
        requiresLivePreview: (() => {
          if (typeof r.requiresLivePreview !== "boolean")
            failCanonicalBody("invalid-field", p, "Preview requirement must be boolean");
          return r.requiresLivePreview;
        })(),
        requiredScopes,
        requester,
      };
    },
    [
      "schemaVersion",
      "approval",
      "version",
      "target",
      "intendedOperation",
      "scheduledFor",
      "statementHash",
      "reauthentication",
      "allowedDecisions",
      "risk",
      "capabilityId",
      "capabilityContractVersion",
      "capabilityFingerprint",
      "policyHashes",
      "requiresLivePreview",
      "requiredScopes",
      "requester",
      "reviewSummary",
    ],
  );
}
export const npRequireAgentApprovalListItemV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentApprovalListItemV1(v), "Invalid approval item");
export function npAnalyzeAgentApprovalDetailV1(v: unknown) {
  return analyze(
    "agent.approval.detail",
    v,
    (r, p): NpAgentApprovalDetailV1 => {
      const item = npRequireAgentApprovalListItemV1(r.item);
      const review = r.review === null ? null : npRequireAgentChangeSetReviewV1(r.review);
      if (
        review &&
        (item.target.kind !== "changeset" ||
          review.changeSet.id !== item.target.changeSetId ||
          review.changeSet.planHash !== item.target.planHash)
      )
        failCanonicalBody("invalid-field", p, "Review must match target");
      return {
        schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-detail.v1"]),
        item,
        review,
      };
    },
    ["schemaVersion", "item", "review"],
  );
}
export const npRequireAgentApprovalDetailV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentApprovalDetailV1(v), "Invalid approval detail");
export function npAnalyzeAgentApprovalPageV1(v: unknown) {
  return analyze(
    "agent.approval.page",
    v,
    (r, p): NpAgentApprovalPageV1 => {
      const items = canonicalBodyArray(r.items, p, 100, state()).map(
        npRequireAgentApprovalListItemV1,
      );
      if (new Set(items.map((i) => i.approval.id)).size !== items.length)
        failCanonicalBody("duplicate", p, "Duplicate approvals");
      const risks = { reversible: 0, sensitive: 1, destructive: 2 };
      for (let i = 1; i < items.length; i++) {
        const previous = items[i - 1],
          current = items[i];
        const date = previous.approval.expiresAt.localeCompare(current.approval.expiresAt);
        const risk = risks[current.risk] - risks[previous.risk];
        if (
          date > 0 ||
          (date === 0 && (risk > 0 || (risk === 0 && previous.approval.id >= current.approval.id)))
        )
          failCanonicalBody(
            "order",
            p,
            "Approvals must follow expiry, descending risk and id order",
          );
      }
      return {
        schemaVersion: enumeration(r.schemaVersion, p, ["np.agent-approval-page.v1"]),
        items,
        nextCursor:
          r.nextCursor === null ? null : text(r.nextCursor, p, 4096, /^[A-Za-z0-9._-]+$/u),
      };
    },
    ["schemaVersion", "items", "nextCursor"],
  );
}
export const npRequireAgentApprovalPageV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentApprovalPageV1(v), "Invalid approval page");
export function npAnalyzeAgentApprovalQueryV1(v: unknown) {
  return analyzeCanonicalBody("agent.approval.query", (): NpAgentApprovalQueryV1 => {
    const p = "agent.approval.query";
    const keys = [
      "state",
      "risk",
      "targetKind",
      "requesterKind",
      "requesterId",
      "requiredHumanCapability",
      "createdAfter",
      "createdBefore",
      "expiresAfter",
      "expiresBefore",
      "limit",
      "cursor",
    ];
    const r = canonicalBodyRecord(cloneCanonicalRuntimeInput(v, p, 8192), p, keys, [], state());
    const optional = <T>(k: string, parse: (v: unknown, p: string) => T) =>
      r[k] === undefined || r[k] === null ? null : parse(r[k], `${p}.${k}`);
    const result: NpAgentApprovalQueryV1 = {
      state:
        r.state === undefined
          ? "pending"
          : optional("state", (v, p) =>
              enumeration(v, p, [
                "pending",
                "approved",
                "rejected",
                "expired",
                "consumed",
                "revoked",
              ]),
            ),
      risk: optional("risk", (v, p) =>
        enumeration(v, p, ["reversible", "sensitive", "destructive"]),
      ),
      targetKind: optional("targetKind", (v, p) =>
        enumeration(v, p, ["changeset", "changeset_rollback", "action"]),
      ),
      requesterKind: optional("requesterKind", (v, p) => enumeration(v, p, ["staff", "principal"])),
      requesterId: optional("requesterId", canonicalBodyUuid),
      requiredHumanCapability: optional(
        "requiredHumanCapability",
        (v, p) => canonicalBodyCapabilities([v], p, state())[0],
      ),
      createdAfter: optional("createdAfter", canonicalBodyUtc),
      createdBefore: optional("createdBefore", canonicalBodyUtc),
      expiresAfter: optional("expiresAfter", canonicalBodyUtc),
      expiresBefore: optional("expiresBefore", canonicalBodyUtc),
      limit: r.limit === undefined ? 25 : canonicalBodyInteger(r.limit, p, 1, 100),
      cursor: optional("cursor", (v, p) => text(v, p, 4096, /^[A-Za-z0-9._-]+$/u)),
    };
    if (result.requesterId && !result.requesterKind)
      failCanonicalBody("invalid-field", p, "Requester kind required");
    for (const [a, b] of [
      [result.createdAfter, result.createdBefore],
      [result.expiresAfter, result.expiresBefore],
    ])
      if (a && b && a >= b) failCanonicalBody("invalid-field", p, "Date range must increase");
    return result;
  });
}
export const npRequireAgentApprovalQueryV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentApprovalQueryV1(v), "Invalid approval query");

const int = { type: "integer", minimum: 1, maximum: 2_147_483_647 };
const digest = { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", maxLength: 54 };
const idem = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$", maxLength: 256 };
const utc = { type: "string", format: "date-time", maxLength: 32 };
const nullable = (s: unknown) => ({ anyOf: [s, { type: "null" }] });
function schema(properties: Record<string, unknown>): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: JSON.parse(JSON.stringify(properties)) as Record<string, unknown>,
    required: Object.keys(properties),
  } as NpAgentJsonSchema;
}
export const npAgentChangeSetRequestApprovalInputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-changeset-request-approval-input.v1" },
  expectedDraftVersion: int,
  planHash: digest,
  intendedOperation: { enum: ["apply", "schedule"] },
  scheduledFor: nullable(utc),
  idempotencyKey: idem,
});
// The conditional branches keep discovery faithful to the runtime operation/time pair.
npAgentChangeSetRequestApprovalInputSchemaV1.oneOf = [
  {
    properties: { intendedOperation: { const: "apply" }, scheduledFor: { type: "null" } },
    required: ["intendedOperation", "scheduledFor"],
  },
  {
    properties: { intendedOperation: { const: "schedule" }, scheduledFor: { ...utc } },
    required: ["intendedOperation", "scheduledFor"],
  },
];
export const npAgentApprovalChallengeRequestSchemaV1 = schema({
  schemaVersion: { const: "np.agent-approval-challenge-request.v1" },
  purpose: { enum: ["approve", "reject", "revoke"] },
  expectedApprovalVersion: int,
  statementHash: digest,
  idempotencyKey: idem,
});
export const npAgentApprovalDecisionInputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-approval-decision-input.v1" },
  expectedApprovalVersion: int,
  statementHash: digest,
  challengeGeneration: int,
  challenge: {
    type: "string",
    pattern: "^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$",
    minLength: 43,
    maxLength: 43,
  },
  idempotencyKey: idem,
  reason: nullable({ type: "string", minLength: 1, maxLength: 2000 }),
});
export const npAgentApprovalChallengeOutputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-approval-challenge.v1" },
  approvalId: { type: "string", format: "uuid", maxLength: 36 },
  approvalVersion: int,
  purpose: { enum: ["approve", "reject", "revoke"] },
  challengeGeneration: int,
  challenge: {
    type: "string",
    pattern: "^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$",
    minLength: 43,
    maxLength: 43,
  },
  reauthentication: {
    oneOf: [
      schema({ mode: { const: "none" } }),
      schema({
        mode: { const: "recent" },
        maxAgeSeconds: { type: "integer", minimum: 1, maximum: 300 },
        assurance: { const: "staff-primary" },
      }),
    ],
  },
  expiresAt: utc,
});

/** HTTP discovery composes the same approval summary and ChangeSet review schema sources. */
const {
  $schema: approvalReviewDialect,
  $defs: approvalReviewDefinitions,
  ...approvalReviewNode
} = npAgentChangeSetReviewSchemaV1;
const approvalUuidSchema = { type: "string", format: "uuid", maxLength: 36 };
const approvalTargetSchema = {
  oneOf: [
    schema({
      kind: { const: "changeset" },
      changeSetId: approvalUuidSchema,
      planHash: digest,
      scheduledFor: nullable(utc),
    }),
    schema({
      kind: { const: "changeset_rollback" },
      changeSetId: approvalUuidSchema,
      rollbackPlanId: approvalUuidSchema,
      planHash: digest,
    }),
    schema({
      kind: { const: "action" },
      actionId: approvalUuidSchema,
      runId: nullable(approvalUuidSchema),
      agentId: nullable(approvalUuidSchema),
      proposalHash: digest,
    }),
  ],
};
const approvalItemSchema = schema({
  schemaVersion: { const: "np.agent-approval-list-item.v1" },
  approval: npAgentApprovalWireSchemaV1,
  version: int,
  target: approvalTargetSchema,
  intendedOperation: { enum: ["apply", "schedule", null] },
  scheduledFor: nullable(utc),
  statementHash: digest,
  reauthentication: (npAgentApprovalChallengeOutputSchemaV1.properties as Record<string, unknown>)
    .reauthentication,
  allowedDecisions: {
    type: "array",
    maxItems: 3,
    uniqueItems: true,
    items: { enum: ["approve", "reject", "revoke"] },
  },
  risk: { enum: ["reversible", "sensitive", "destructive"] },
  capabilityId: { enum: [...npAgentCapabilityIds] },
  capabilityContractVersion: int,
  capabilityFingerprint: digest,
  policyHashes: {
    type: "array",
    maxItems: npAgentContractLimits.jsonSchemaMaxItems,
    uniqueItems: true,
    items: digest,
  },
  requiresLivePreview: { type: "boolean" },
  requiredScopes: {
    type: "array",
    maxItems: npAgentScopes.length,
    uniqueItems: true,
    items: { enum: [...npAgentScopes] },
  },
  requester: {
    oneOf: [
      schema({ kind: { const: "staff" }, id: nullable(approvalUuidSchema) }),
      schema({ kind: { const: "principal" }, id: approvalUuidSchema }),
    ],
  },
  reviewSummary: schema({
    operationCount: { type: "integer", minimum: 1, maximum: npAgentChangeSetLimits.operations },
    targetCount: { type: "integer", minimum: 1, maximum: npAgentChangeSetLimits.operations },
    previewState: { enum: ["queued", "rendering", "ready", "failed", "expired", null] },
    checksRun: nullable({ type: "integer", minimum: 0, maximum: 1000 }),
    rollbackPlan: { const: "unavailable" },
  }),
});
const approvalDetailSchemaSource = JSON.parse(
  JSON.stringify({
    ...schema({
      schemaVersion: { const: "np.agent-approval-detail.v1" },
      item: approvalItemSchema,
      review: nullable({ $ref: "#/$defs/approvalReview" }),
    }),
    $schema: approvalReviewDialect,
    $defs: {
      ...(approvalReviewDefinitions as Record<string, unknown>),
      approvalReview: approvalReviewNode,
    },
  }),
) as NpAgentJsonSchema;

// Reuse repeated schema nodes through local refs so composing the existing full review
// remains within the unchanged framework schema node bound.
export const npAgentApprovalDetailSchemaV1 = npCompactAgentWireSchemaV1(approvalDetailSchemaSource);
