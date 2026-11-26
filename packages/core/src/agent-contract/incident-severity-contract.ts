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
export const npAgentIncidentSeverityOrderV1 = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type NpAgentIncidentEscalationSeverityV1 = "low" | "medium" | "high" | "critical";
export interface NpAgentIncidentSeverityInputV1 {
  schemaVersion: "np.agent-incident-severity-input.v1";
  expectedVersion: number;
  severity: NpAgentIncidentEscalationSeverityV1;
  note: string;
  idempotencyKey: string;
}
export interface NpAgentIncidentSeverityChangeV1 {
  fromSeverity: "info" | "low" | "medium" | "high";
  toSeverity: NpAgentIncidentEscalationSeverityV1;
  note: string;
}
function note(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2000 ||
    value !== value.trim() ||
    Array.from(value).some((c) => {
      const n = c.charCodeAt(0);
      return n === 127 || (n < 32 && ![9, 10, 13].includes(n));
    })
  )
    failCanonicalBody("invalid-field", "incident.severity.note", "Invalid note");
  return value;
}
export function npRequireAgentIncidentSeverityInputV1(
  value: unknown,
): NpAgentIncidentSeverityInputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("incident.severity", () => {
      const keys = ["schemaVersion", "expectedVersion", "severity", "note", "idempotencyKey"];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, "incident.severity", 16384),
        "incident.severity",
        keys,
        keys,
        { seen: new WeakSet<object>() },
      );
      if (row.schemaVersion !== "np.agent-incident-severity-input.v1")
        failCanonicalBody("invalid-field", "incident.severity", "Invalid schema");
      const idempotencyKey = canonicalBodyAscii(row.idempotencyKey, "incident.severity", 128);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(idempotencyKey))
        failCanonicalBody("invalid-field", "incident.severity", "Invalid idempotency key");
      return {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: canonicalBodyInteger(
          row.expectedVersion,
          "incident.severity",
          1,
          2147483646,
        ),
        severity: canonicalBodyEnum<NpAgentIncidentEscalationSeverityV1>(
          row.severity,
          "incident.severity",
          new Set(["low", "medium", "high", "critical"]),
        ),
        note: note(row.note),
        idempotencyKey,
      };
    }),
  );
}
export function npRequireAgentIncidentSeverityChangeV1(
  value: unknown,
): NpAgentIncidentSeverityChangeV1 {
  const keys = ["fromSeverity", "toSeverity", "note"];
  const row = canonicalBodyRecord(value, "incident.severityChange", keys, keys, {
    seen: new WeakSet<object>(),
  });
  const fromSeverity = canonicalBodyEnum<NpAgentIncidentSeverityChangeV1["fromSeverity"]>(
    row.fromSeverity,
    "incident.severityChange",
    new Set(["info", "low", "medium", "high"]),
  );
  const toSeverity = canonicalBodyEnum<NpAgentIncidentEscalationSeverityV1>(
    row.toSeverity,
    "incident.severityChange",
    new Set(["low", "medium", "high", "critical"]),
  );
  if (
    npAgentIncidentSeverityOrderV1.indexOf(fromSeverity) >=
    npAgentIncidentSeverityOrderV1.indexOf(toSeverity)
  )
    failCanonicalBody("invalid-field", "incident.severityChange", "Severity must increase");
  return { fromSeverity, toSeverity, note: note(row.note) };
}
export const npAgentIncidentSeverityInputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "expectedVersion", "severity", "note", "idempotencyKey"],
  properties: {
    schemaVersion: { const: "np.agent-incident-severity-input.v1" },
    expectedVersion: { type: "integer", minimum: 1, maximum: 2147483646 },
    severity: { enum: ["low", "medium", "high", "critical"] },
    note: { type: "string", minLength: 1, maxLength: 2000 },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    },
  },
};
