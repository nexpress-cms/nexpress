import { npAuthUuidPattern } from "../auth-contract/index.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodyAscii,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentJsonSchema } from "./types.js";

export interface NpAgentIncidentFeedbackInputV1 {
  schemaVersion: "np.agent-incident-feedback-input.v1";
  expectedVersion: number;
  signalId: string;
  label: "confirmed-spam" | "false-positive";
  supersedesId: string | null;
  idempotencyKey: string;
}
export function npAnalyzeAgentIncidentFeedbackInputV1(value: unknown) {
  return analyzeCanonicalBody("agent.incident.feedback", (): NpAgentIncidentFeedbackInputV1 => {
    const p = "agent.incident.feedback";
    const keys = [
      "schemaVersion",
      "expectedVersion",
      "signalId",
      "label",
      "supersedesId",
      "idempotencyKey",
    ];
    const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, p, 4096), p, keys, keys, {
      seen: new WeakSet<object>(),
    });
    const idempotencyKey = canonicalBodyAscii(row.idempotencyKey, `${p}.idempotencyKey`, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(idempotencyKey))
      failCanonicalBody("invalid-field", `${p}.idempotencyKey`, "Invalid idempotency key");
    return {
      schemaVersion: canonicalBodyEnum(
        row.schemaVersion,
        `${p}.schemaVersion`,
        new Set(["np.agent-incident-feedback-input.v1"] as const),
      ),
      expectedVersion: canonicalBodyInteger(
        row.expectedVersion,
        `${p}.expectedVersion`,
        1,
        2147483647,
      ),
      signalId: canonicalBodyUuid(row.signalId, `${p}.signalId`),
      label: canonicalBodyEnum(
        row.label,
        `${p}.label`,
        new Set(["confirmed-spam", "false-positive"] as const),
      ),
      supersedesId:
        row.supersedesId === null ? null : canonicalBodyUuid(row.supersedesId, `${p}.supersedesId`),
      idempotencyKey,
    };
  });
}
export const npRequireAgentIncidentFeedbackInputV1 = (
  value: unknown,
): NpAgentIncidentFeedbackInputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentFeedbackInputV1(value));
export const npAgentIncidentFeedbackInputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "expectedVersion",
    "signalId",
    "label",
    "supersedesId",
    "idempotencyKey",
  ],
  properties: {
    schemaVersion: { const: "np.agent-incident-feedback-input.v1" },
    expectedVersion: { type: "integer", minimum: 1, maximum: 2147483647 },
    signalId: {
      type: "string",
      pattern: npAuthUuidPattern,
      minLength: 36,
      maxLength: 36,
    },
    label: { enum: ["confirmed-spam", "false-positive"] },
    supersedesId: {
      anyOf: [
        { type: "null" },
        {
          type: "string",
          pattern: npAuthUuidPattern,
          minLength: 36,
          maxLength: 36,
        },
      ],
    },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    },
  },
};
