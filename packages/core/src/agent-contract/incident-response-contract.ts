import {
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyAscii,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npRequireAgentQuarantineProposalV1,
  npRequireAgentRestoreProposalV1,
  npAgentQuarantineProposalSchemaV1,
  npAgentRestoreProposalSchemaV1,
  type NpAgentQuarantineProposalV1,
  type NpAgentRestoreProposalV1,
} from "./moderator-contract.js";
import type { NpAgentJsonSchema } from "./types.js";
export type NpAgentIncidentResponseCapabilityV1 = "moderation.quarantine" | "moderation.restore";
export interface NpAgentIncidentResponsePlanInputV1 {
  schemaVersion: "np.agent-incident-response-plan-input.v1";
  expectedVersion: number;
  capabilityId: NpAgentIncidentResponseCapabilityV1;
  proposal: NpAgentQuarantineProposalV1 | NpAgentRestoreProposalV1;
  idempotencyKey: string;
}
export interface NpAgentIncidentResponseExecuteInputV1 {
  schemaVersion: "np.agent-incident-response-execute-input.v1";
  expectedVersion: number;
  actionId: string;
  approvalId: string;
  proposalHash: string;
  idempotencyKey: string;
}
export interface NpAgentIncidentResponseChoiceV1 {
  capabilityId: NpAgentIncidentResponseCapabilityV1;
  target: NpAgentQuarantineProposalV1["target"];
  expectedVersionDigest: string;
  containmentId: string | null;
}
export interface NpAgentIncidentResponsePlanV1 extends NpAgentIncidentResponseChoiceV1 {
  actionId: string;
  proposalHash: string;
  state:
    | "proposed"
    | "approval_pending"
    | "approved"
    | "executing"
    | "succeeded"
    | "failed"
    | "compensated";
  approvalId: string;
  approvalResource: string;
  expiresAt: string;
  policyHashes: string[];
  reversibility: "compensatable" | "none";
  canExecute: boolean;
}
export interface NpAgentIncidentResponseV1 {
  choices: NpAgentIncidentResponseChoiceV1[];
  plans: NpAgentIncidentResponsePlanV1[];
  truncated: boolean;
}
const record = (v: unknown, p: string, keys: string[]) =>
  canonicalBodyRecord(v, p, keys, keys, { seen: new WeakSet<object>() });
const capability = (v: unknown) =>
  canonicalBodyEnum<NpAgentIncidentResponseCapabilityV1>(
    v,
    "response.capabilityId",
    new Set(["moderation.quarantine", "moderation.restore"]),
  );
const key = (v: unknown) => {
  const s = canonicalBodyAscii(v, "response.idempotencyKey", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(s))
    failCanonicalBody("invalid-field", "response.idempotencyKey", "Invalid key");
  return s;
};
export function npRequireAgentIncidentResponsePlanInputV1(
  value: unknown,
): NpAgentIncidentResponsePlanInputV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "response", 16384), "response", [
    "schemaVersion",
    "expectedVersion",
    "capabilityId",
    "proposal",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      "response.schemaVersion",
      new Set(["np.agent-incident-response-plan-input.v1"] as const),
    ),
    expectedVersion: canonicalBodyInteger(
      r.expectedVersion,
      "response.expectedVersion",
      1,
      2147483647,
    ),
    capabilityId: capability(r.capabilityId),
    proposal:
      r.capabilityId === "moderation.quarantine"
        ? npRequireAgentQuarantineProposalV1(r.proposal)
        : npRequireAgentRestoreProposalV1(r.proposal),
    idempotencyKey: key(r.idempotencyKey),
  };
}
export function npRequireAgentIncidentResponseExecuteInputV1(
  value: unknown,
): NpAgentIncidentResponseExecuteInputV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "response", 16384), "response", [
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
      "response.schemaVersion",
      new Set(["np.agent-incident-response-execute-input.v1"] as const),
    ),
    expectedVersion: canonicalBodyInteger(
      r.expectedVersion,
      "response.expectedVersion",
      1,
      2147483647,
    ),
    actionId: canonicalBodyUuid(r.actionId, "response.actionId"),
    approvalId: canonicalBodyUuid(r.approvalId, "response.approvalId"),
    proposalHash: canonicalBodySha256Digest(r.proposalHash, "response.proposalHash"),
    idempotencyKey: key(r.idempotencyKey),
  };
}
export function npRequireAgentIncidentResponseV1(value: unknown): NpAgentIncidentResponseV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "response", 131072), "response", [
    "choices",
    "plans",
    "truncated",
  ]);
  if (
    !Array.isArray(r.choices) ||
    r.choices.length > 100 ||
    !Array.isArray(r.plans) ||
    r.plans.length > 50 ||
    typeof r.truncated !== "boolean"
  )
    failCanonicalBody("invalid-field", "response", "Invalid bounds");
  const choice = (v: unknown, extra: string[] = []) => {
    const c = record(v, "response.choice", [
      "capabilityId",
      "target",
      "expectedVersionDigest",
      "containmentId",
      ...extra,
    ]);
    const p = npRequireAgentQuarantineProposalV1({
      target: c.target,
      incidentId: null,
      expectedVersionDigest: c.expectedVersionDigest,
      reasonCode: "REVIEWED",
    });
    const id = capability(c.capabilityId);
    const containmentId =
      c.containmentId === null
        ? null
        : canonicalBodyUuid(c.containmentId, "response.containmentId");
    if ((id === "moderation.restore") !== (containmentId !== null))
      failCanonicalBody("invalid-field", "response.containmentId", "Restore requires containment");
    return {
      capabilityId: id,
      target: p.target,
      expectedVersionDigest: p.expectedVersionDigest,
      containmentId,
    };
  };
  const choices = r.choices.map((v) => choice(v));
  const seenChoices = new Set(
    choices.map((c) =>
      JSON.stringify([
        c.capabilityId,
        c.target.kind,
        c.target.collection,
        c.target.id,
        c.containmentId,
      ]),
    ),
  );
  if (seenChoices.size !== choices.length)
    failCanonicalBody("duplicate", "response.choices", "Duplicate response target");
  const seenActions = new Set<string>();
  return {
    choices,
    plans: r.plans.map((v) => {
      const p = record(v, "response.plan", [
        "capabilityId",
        "target",
        "expectedVersionDigest",
        "containmentId",
        "actionId",
        "proposalHash",
        "state",
        "approvalId",
        "approvalResource",
        "expiresAt",
        "policyHashes",
        "reversibility",
        "canExecute",
      ]);
      const c = choice(v, [
        "actionId",
        "proposalHash",
        "state",
        "approvalId",
        "approvalResource",
        "expiresAt",
        "policyHashes",
        "reversibility",
        "canExecute",
      ]);
      const approvalId = canonicalBodyUuid(p.approvalId, "response.approvalId");
      if (
        p.approvalResource !== `/admin/agents/approvals/${approvalId}` ||
        typeof p.canExecute !== "boolean" ||
        !Array.isArray(p.policyHashes) ||
        p.policyHashes.length > 20 ||
        new Set(p.policyHashes).size !== p.policyHashes.length ||
        (p.canExecute && p.state !== "approved") ||
        p.reversibility !== (c.capabilityId === "moderation.quarantine" ? "compensatable" : "none")
      )
        failCanonicalBody("invalid-field", "response.plan", "Invalid plan");
      const actionId = canonicalBodyUuid(p.actionId, "response.actionId");
      if (seenActions.has(actionId))
        failCanonicalBody("duplicate", "response.actionId", "Duplicate response plan");
      seenActions.add(actionId);
      return {
        ...c,
        actionId,
        proposalHash: canonicalBodySha256Digest(p.proposalHash, "response.proposalHash"),
        state: canonicalBodyEnum<NpAgentIncidentResponsePlanV1["state"]>(
          p.state,
          "response.state",
          new Set([
            "proposed",
            "approval_pending",
            "approved",
            "executing",
            "succeeded",
            "failed",
            "compensated",
          ]),
        ),
        approvalId,
        approvalResource: p.approvalResource,
        expiresAt: canonicalBodyUtc(p.expiresAt, "response.expiresAt"),
        policyHashes: p.policyHashes.map((h) =>
          canonicalBodySha256Digest(h, "response.policyHash"),
        ),
        reversibility: canonicalBodyEnum<NpAgentIncidentResponsePlanV1["reversibility"]>(
          p.reversibility,
          "response.reversibility",
          new Set(["compensatable", "none"]),
        ),
        canExecute: p.canExecute,
      };
    }),
    truncated: r.truncated,
  };
}
const common = {
  schemaVersion: { const: "np.agent-incident-response-plan-input.v1" },
  expectedVersion: { type: "integer", minimum: 1, maximum: 2147483647 },
  idempotencyKey: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  },
};
const uuid = { type: "string", format: "uuid", maxLength: 36 };
const hash = { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", maxLength: 54 };
export const npAgentIncidentResponsePlanInputSchemaV1: NpAgentJsonSchema = JSON.parse(
  JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "expectedVersion", "capabilityId", "proposal", "idempotencyKey"],
    properties: {
      ...common,
      capabilityId: { enum: ["moderation.quarantine", "moderation.restore"] },
      proposal: { oneOf: [npAgentQuarantineProposalSchemaV1(), npAgentRestoreProposalSchemaV1()] },
    },
  }),
);
export const npAgentIncidentResponseExecuteInputSchemaV1: NpAgentJsonSchema = JSON.parse(
  JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "expectedVersion",
      "actionId",
      "approvalId",
      "proposalHash",
      "idempotencyKey",
    ],
    properties: {
      ...common,
      schemaVersion: { const: "np.agent-incident-response-execute-input.v1" },
      actionId: uuid,
      approvalId: uuid,
      proposalHash: hash,
    },
  }),
);

npAgentIncidentResponsePlanInputSchemaV1.oneOf = [
  {
    properties: {
      capabilityId: { const: "moderation.quarantine" },
      proposal: npAgentQuarantineProposalSchemaV1(),
    },
  },
  {
    properties: {
      capabilityId: { const: "moderation.restore" },
      proposal: npAgentRestoreProposalSchemaV1(),
    },
  },
];
