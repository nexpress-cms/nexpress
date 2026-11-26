import type { NpAgentIncidentEscalationSeverityV1 } from "./incident-severity-contract.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyAscii,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentJsonSchema } from "./types.js";
export const npAgentIncidentTransitionsV1 = ["investigating", "resolved", "dismissed"] as const;
export const npAgentIncidentResolutionCodesV1 = [
  "REMEDIATED",
  "NO_FURTHER_ACTION",
  "FALSE_POSITIVE",
  "DUPLICATE",
  "OUT_OF_SCOPE",
] as const;
export type NpAgentIncidentTransitionV1 = (typeof npAgentIncidentTransitionsV1)[number];
export type NpAgentIncidentResolutionCodeV1 = (typeof npAgentIncidentResolutionCodesV1)[number];
export interface NpAgentIncidentTransitionInputV1 {
  schemaVersion: "np.agent-incident-transition-input.v1";
  expectedVersion: number;
  transition: NpAgentIncidentTransitionV1;
  resolutionCode: NpAgentIncidentResolutionCodeV1 | null;
  note: string;
  containmentReviewHash: string | null;
  containmentDisposition: "retain" | "acknowledge" | null;
  idempotencyKey: string;
}
export interface NpAgentIncidentWorkflowV1 {
  availableTransitions: NpAgentIncidentTransitionV1[];
  availableSeverities?: NpAgentIncidentEscalationSeverityV1[];
  containment: {
    reviewHash: string;
    total: number;
    active: number;
    restored: number;
    unresolved: number;
    pendingActions: number;
  };
}
export interface NpAgentIncidentDecisionV1 {
  fromStatus: "open" | "investigating" | "contained" | "monitoring";
  toStatus: NpAgentIncidentTransitionV1;
  resolutionCode: NpAgentIncidentResolutionCodeV1 | null;
  note: string;
  containmentDisposition: "retain" | "acknowledge" | null;
}
export function npRequireAgentIncidentDecisionV1(value: unknown): NpAgentIncidentDecisionV1 {
  const p = "incident.decision",
    keys = ["fromStatus", "toStatus", "resolutionCode", "note", "containmentDisposition"];
  const row = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
  const transition = canonicalBodyEnum<NpAgentIncidentTransitionV1>(
    row.toStatus,
    p,
    new Set(npAgentIncidentTransitionsV1),
  );
  const fromStatus = canonicalBodyEnum<NpAgentIncidentDecisionV1["fromStatus"]>(
    row.fromStatus,
    p,
    new Set(["open", "investigating", "contained", "monitoring"] as const),
  );
  if (transition === "investigating" && fromStatus !== "open")
    failCanonicalBody("invalid-field", p, "Invalid transition");
  const parsed = npRequireAgentIncidentTransitionInputV1({
    schemaVersion: "np.agent-incident-transition-input.v1",
    expectedVersion: 1,
    transition,
    resolutionCode: row.resolutionCode,
    note: row.note,
    containmentDisposition: row.containmentDisposition,
    containmentReviewHash: transition === "investigating" ? null : `cj1:sha256:${"A".repeat(43)}`,
    idempotencyKey: "decision",
  });
  return {
    fromStatus,
    toStatus: transition,
    resolutionCode: parsed.resolutionCode,
    note: parsed.note,
    containmentDisposition: parsed.containmentDisposition,
  };
}
export function npAnalyzeAgentIncidentTransitionInputV1(value: unknown) {
  return analyzeCanonicalBody("incident.transition", (): NpAgentIncidentTransitionInputV1 => {
    const p = "incident.transition",
      keys = [
        "schemaVersion",
        "expectedVersion",
        "transition",
        "resolutionCode",
        "note",
        "containmentReviewHash",
        "containmentDisposition",
        "idempotencyKey",
      ];
    const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, p, 16384), p, keys, keys, {
      seen: new WeakSet<object>(),
    });
    const transition = canonicalBodyEnum<NpAgentIncidentTransitionV1>(
      row.transition,
      p,
      new Set(npAgentIncidentTransitionsV1),
    );
    const resolutionCode =
      row.resolutionCode === null
        ? null
        : canonicalBodyEnum<NpAgentIncidentResolutionCodeV1>(
            row.resolutionCode,
            p,
            new Set(npAgentIncidentResolutionCodesV1),
          );
    const containmentDisposition =
      row.containmentDisposition === null
        ? null
        : canonicalBodyEnum<"retain" | "acknowledge">(
            row.containmentDisposition,
            p,
            new Set(["retain", "acknowledge"] as const),
          );
    const containmentReviewHash =
      row.containmentReviewHash === null
        ? null
        : canonicalBodyAscii(row.containmentReviewHash, p, 60);
    const idempotencyKey = canonicalBodyAscii(row.idempotencyKey, p, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(idempotencyKey))
      failCanonicalBody("invalid-field", p, "Invalid idempotency key");
    if (
      typeof row.note !== "string" ||
      row.note.length < 1 ||
      row.note.length > 2000 ||
      row.note !== row.note.trim() ||
      Array.from(row.note).some((character) => {
        const code = character.charCodeAt(0);
        return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
      })
    )
      failCanonicalBody("invalid-field", p, "Invalid note");
    if (
      transition === "investigating"
        ? resolutionCode !== null ||
          containmentDisposition !== null ||
          containmentReviewHash !== null
        : !resolutionCode ||
          !(
            transition === "resolved"
              ? ["REMEDIATED", "NO_FURTHER_ACTION"]
              : ["FALSE_POSITIVE", "DUPLICATE", "OUT_OF_SCOPE"]
          ).includes(resolutionCode) ||
          !containmentDisposition ||
          !containmentReviewHash ||
          !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(containmentReviewHash)
    )
      failCanonicalBody("invalid-field", p, "Invalid transition decision");
    return {
      schemaVersion: canonicalBodyEnum(
        row.schemaVersion,
        p,
        new Set(["np.agent-incident-transition-input.v1"] as const),
      ),
      expectedVersion: canonicalBodyInteger(row.expectedVersion, p, 1, 2147483646),
      transition,
      resolutionCode,
      note: row.note,
      containmentDisposition,
      containmentReviewHash,
      idempotencyKey,
    };
  });
}
export const npRequireAgentIncidentTransitionInputV1 = (
  value: unknown,
): NpAgentIncidentTransitionInputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentTransitionInputV1(value));
export const npAgentIncidentTransitionInputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "expectedVersion",
    "transition",
    "resolutionCode",
    "note",
    "containmentReviewHash",
    "containmentDisposition",
    "idempotencyKey",
  ],
  properties: {
    schemaVersion: { const: "np.agent-incident-transition-input.v1" },
    expectedVersion: { type: "integer", minimum: 1, maximum: 2147483646 },
    transition: { enum: [...npAgentIncidentTransitionsV1] },
    resolutionCode: { enum: [null, ...npAgentIncidentResolutionCodesV1] },
    note: { type: "string", minLength: 1, maxLength: 2000 },
    containmentReviewHash: {
      anyOf: [
        { type: "null" },
        { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", minLength: 54, maxLength: 54 },
      ],
    },
    containmentDisposition: { enum: [null, "retain", "acknowledge"] },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    },
  },
};

npAgentIncidentTransitionInputSchemaV1.oneOf = [
  {
    properties: {
      transition: { const: "investigating" },
      resolutionCode: { type: "null" },
      containmentReviewHash: { type: "null" },
      containmentDisposition: { type: "null" },
    },
  },
  {
    properties: {
      transition: { const: "resolved" },
      resolutionCode: { enum: ["REMEDIATED", "NO_FURTHER_ACTION"] },
      containmentReviewHash: {
        type: "string",
        minLength: 54,
        maxLength: 54,
        pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
      },
      containmentDisposition: { enum: ["retain", "acknowledge"] },
    },
  },
  {
    properties: {
      transition: { const: "dismissed" },
      resolutionCode: { enum: ["FALSE_POSITIVE", "DUPLICATE", "OUT_OF_SCOPE"] },
      containmentReviewHash: {
        type: "string",
        minLength: 54,
        maxLength: 54,
        pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
      },
      containmentDisposition: { enum: ["retain", "acknowledge"] },
    },
  },
];
