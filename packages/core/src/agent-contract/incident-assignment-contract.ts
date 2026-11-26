import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyUuid,
  canonicalBodyAscii,
  canonicalBodyArray,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentConfigurationStatusesV1,
  type NpAgentConfigurationStatusV1,
} from "./runtime-contract.js";
import type { NpAgentJsonSchema } from "./types.js";
export interface NpAgentIncidentAssignmentInputV1 {
  schemaVersion: "np.agent-incident-assignment-input.v1";
  expectedVersion: number;
  agentId: string | null;
  idempotencyKey: string;
}
export interface NpAgentIncidentAssignmentEntryV1 {
  fromAgentId: string | null;
  toAgentId: string | null;
}
export interface NpAgentIncidentAssignmentV1 {
  schemaVersion: "np.agent-incident-assignment.v1";
  incidentId: string;
  incidentVersion: number;
  assignedAgentId: string | null;
  current: null | {
    id: string;
    name: string;
    status: NpAgentConfigurationStatusV1;
    eligible: boolean;
  };
  candidates: Array<{ id: string; name: string; status: "active" | "paused" }>;
  canAssign: boolean;
}
const p = "incident.assignment";
function record(value: unknown, keys: string[]) {
  return canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
}
const id = (value: unknown) => (value === null ? null : canonicalBodyUuid(value, p));
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") failCanonicalBody("invalid-field", p, "Expected boolean");
  return value;
}
function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    failCanonicalBody("invalid-field", p, "Invalid name");
  return value;
}
export function npRequireAgentIncidentAssignmentEntryV1(
  value: unknown,
): NpAgentIncidentAssignmentEntryV1 {
  const r = record(value, ["fromAgentId", "toAgentId"]);
  const result = { fromAgentId: id(r.fromAgentId), toAgentId: id(r.toAgentId) };
  if (result.fromAgentId === result.toAgentId)
    failCanonicalBody("invalid-field", p, "Assignment must change");
  return result;
}
export function npRequireAgentIncidentAssignmentInputV1(
  value: unknown,
): NpAgentIncidentAssignmentInputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody(p, () => {
      const r = record(cloneCanonicalRuntimeInput(value, p, 4096), [
        "schemaVersion",
        "expectedVersion",
        "agentId",
        "idempotencyKey",
      ]);
      if (r.schemaVersion !== "np.agent-incident-assignment-input.v1")
        failCanonicalBody("invalid-field", p, "Invalid schema");
      const key = canonicalBodyAscii(r.idempotencyKey, p, 128);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(key))
        failCanonicalBody("invalid-field", p, "Invalid key");
      return {
        schemaVersion: "np.agent-incident-assignment-input.v1" as const,
        expectedVersion: canonicalBodyInteger(r.expectedVersion, p, 1, 2147483646),
        agentId: id(r.agentId),
        idempotencyKey: key,
      };
    }),
  );
}
export function npRequireAgentIncidentAssignmentV1(value: unknown): NpAgentIncidentAssignmentV1 {
  const r = record(cloneCanonicalRuntimeInput(value, p, 65536), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "assignedAgentId",
    "current",
    "candidates",
    "canAssign",
  ]);
  if (r.schemaVersion !== "np.agent-incident-assignment.v1")
    failCanonicalBody("invalid-field", p, "Invalid schema");
  const assignedAgentId = id(r.assignedAgentId);
  const c = r.current === null ? null : record(r.current, ["id", "name", "status", "eligible"]);
  const current =
    c === null
      ? null
      : {
          id: canonicalBodyUuid(c.id, p),
          name: name(c.name),
          status: canonicalBodyEnum<NpAgentConfigurationStatusV1>(
            c.status,
            p,
            new Set(npAgentConfigurationStatusesV1),
          ),
          eligible: boolean(c.eligible),
        };
  const candidates = canonicalBodyArray(r.candidates, p, 100, { seen: new WeakSet<object>() }).map(
    (value) => {
      const x = record(value, ["id", "name", "status"]);
      return {
        id: canonicalBodyUuid(x.id, p),
        name: name(x.name),
        status: canonicalBodyEnum<"active" | "paused">(
          x.status,
          p,
          new Set(["active", "paused"] as const),
        ),
      };
    },
  );
  if (
    (current && current.id !== assignedAgentId) ||
    new Set(candidates.map((x) => x.id)).size !== candidates.length ||
    (current && current.eligible !== candidates.some((x) => x.id === current.id)) ||
    (!current && assignedAgentId !== null && candidates.some((x) => x.id === assignedAgentId))
  )
    failCanonicalBody("invalid-field", p, "Invalid assignment binding");
  return {
    schemaVersion: "np.agent-incident-assignment.v1",
    incidentId: canonicalBodyUuid(r.incidentId, p),
    incidentVersion: canonicalBodyInteger(r.incidentVersion, p, 1, 2147483647),
    assignedAgentId,
    current,
    candidates,
    canAssign: boolean(r.canAssign),
  };
}
export const npAgentIncidentAssignmentInputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "expectedVersion", "agentId", "idempotencyKey"],
  properties: {
    schemaVersion: { const: "np.agent-incident-assignment-input.v1" },
    expectedVersion: { type: "integer", minimum: 1, maximum: 2147483646 },
    agentId: {
      anyOf: [
        { type: "null" },
        {
          type: "string",
          minLength: 36,
          maxLength: 36,
          format: "uuid",
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
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
