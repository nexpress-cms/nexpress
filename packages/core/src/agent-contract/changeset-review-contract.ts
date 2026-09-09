import {
  npAgentChangeSetWireSchemaV1,
  npAgentApprovalWireSchemaV1,
  npAgentSchemaObjectV1,
} from "./changeset-capability-schema.js";
import type { NpAgentJsonSchema, NpAgentJsonObject } from "./types.js";
import type { NpCapability } from "../auth/capabilities.js";
import { npCollectionContractLimits } from "../collection-contract/contract.js";
import type { NpAgentJsonValue } from "./types.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyCapabilities,
  canonicalBodyEnum,
  canonicalBodyInteger,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
} from "./canonical-runtime-primitives.js";
import {
  npAgentChangeSetLimits,
  npRequireAgentChangeSetWire,
  type NpAgentChangeSetWire,
} from "./changeset-wire-contract.js";

export interface NpAgentChangeSetReviewValueV1 {
  presence: "present" | "absent" | "redacted";
  value: NpAgentJsonValue;
}
export interface NpAgentChangeSetReviewOperationV1 {
  ordinal: number;
  evidence: "available" | "not_validated" | "redacted" | "expired";
  fields: Array<{
    path: string;
    before: NpAgentChangeSetReviewValueV1;
    after: NpAgentChangeSetReviewValueV1;
  }>;
}
export interface NpAgentChangeSetReviewV1 {
  schemaVersion: "np.agent-changeset-review.v1";
  changeSet: NpAgentChangeSetWire;
  requiredStaffCapabilities: NpCapability[];
  operations: NpAgentChangeSetReviewOperationV1[];
}
const state = () => ({ seen: new WeakSet<object>() });
function record(value: unknown, path: string, keys: string[]) {
  return canonicalBodyRecord(value, path, keys, keys, state());
}
export function npAnalyzeAgentChangeSetReviewV1(input: unknown) {
  return analyzeCanonicalBody("agent.changeset.review", () => {
    const path = "agent.changeset.review";
    const cloned = cloneCanonicalRuntimeInput(input, path, npAgentChangeSetLimits.wireBytes, {
      maximumDepth: npCollectionContractLimits.jsonDepth + 20,
      maximumNodes: npAgentChangeSetLimits.wireBytes,
      maximumArrayItems: npCollectionContractLimits.arrayRows,
      maximumObjectProperties: npCollectionContractLimits.jsonKeys,
      maximumStringCharacters: npCollectionContractLimits.stringLength,
    });
    const r = record(cloned, path, [
      "schemaVersion",
      "changeSet",
      "requiredStaffCapabilities",
      "operations",
    ]);
    const changeSet = npRequireAgentChangeSetWire(r.changeSet);
    const parseValue = (inputValue: unknown, p: string): NpAgentChangeSetReviewValueV1 => {
      const v = record(inputValue, p, ["presence", "value"]);
      const presence = canonicalBodyEnum<NpAgentChangeSetReviewValueV1["presence"]>(
        v.presence,
        `${p}.presence`,
        new Set(["present", "absent", "redacted"]),
      );
      if (presence !== "present" && v.value !== null)
        failCanonicalBody("invalid-field", p, "Unavailable values must be null");
      return { presence, value: v.value as NpAgentJsonValue };
    };
    const operations = canonicalBodyArray(
      r.operations,
      `${path}.operations`,
      npAgentChangeSetLimits.operations,
      state(),
    ).map((value, index): NpAgentChangeSetReviewOperationV1 => {
      const p = `${path}.operations[${index.toString()}]`;
      const op = record(value, p, ["ordinal", "evidence", "fields"]);
      const ordinal = canonicalBodyInteger(
        op.ordinal,
        `${p}.ordinal`,
        1,
        npAgentChangeSetLimits.operations,
      );
      if (ordinal !== index + 1)
        failCanonicalBody("order", p, "Operations must follow proposal order");
      const evidence = canonicalBodyEnum<NpAgentChangeSetReviewOperationV1["evidence"]>(
        op.evidence,
        `${p}.evidence`,
        new Set(["available", "not_validated", "redacted", "expired"]),
      );
      const fields = canonicalBodyArray(
        op.fields,
        `${p}.fields`,
        npCollectionContractLimits.jsonKeys,
        state(),
      ).map((field, fieldIndex) => {
        const f = `${p}.fields[${fieldIndex.toString()}]`;
        const item = record(field, f, ["path", "before", "after"]);
        return {
          path: canonicalRuntimeText(item.path, `${f}.path`, 512),
          before: parseValue(item.before, `${f}.before`),
          after: parseValue(item.after, `${f}.after`),
        };
      });
      if (new Set(fields.map((field) => field.path)).size !== fields.length)
        failCanonicalBody("duplicate", p, "Field paths must be unique");
      if (evidence !== "available" && fields.length)
        failCanonicalBody("invalid-field", p, "Unavailable evidence has no fields");
      return { ordinal, evidence, fields };
    });
    if (operations.length !== changeSet.operations.length)
      failCanonicalBody("invalid-field", path, "Review must cover every operation");
    return {
      schemaVersion: canonicalBodyEnum<"np.agent-changeset-review.v1">(
        r.schemaVersion,
        `${path}.schemaVersion`,
        new Set(["np.agent-changeset-review.v1"]),
      ),
      changeSet,
      requiredStaffCapabilities: canonicalBodyCapabilities(
        r.requiredStaffCapabilities,
        `${path}.requiredStaffCapabilities`,
        state(),
      ),
      operations,
    } satisfies NpAgentChangeSetReviewV1;
  });
}
export function npRequireAgentChangeSetReviewV1(value: unknown): NpAgentChangeSetReviewV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetReviewV1(value),
    "Invalid ChangeSet review",
  );
}

/** Closed review-only additions; the embedded ChangeSet retains its existing contract. */
export const npAgentChangeSetReviewInventoryV1 = Object.freeze({
  schemaVersion: "np.agent-changeset-review.v1",
  keys: ["schemaVersion", "changeSet", "requiredStaffCapabilities", "operations"],
  operationKeys: ["ordinal", "evidence", "fields"],
  fieldKeys: ["path", "before", "after"],
  valueKeys: ["presence", "value"],
  evidence: ["available", "not_validated", "redacted", "expired"],
  presence: ["present", "absent", "redacted"],
  maximumOperations: npAgentChangeSetLimits.operations,
  maximumFields: npCollectionContractLimits.jsonKeys,
  maximumPathCharacters: 512,
  maximumBytes: npAgentChangeSetLimits.wireBytes,
} as const);

/** Discovery projection of the existing safe review; canonical analyzers own semantic checks. */
const {
  $defs: reviewWireDefinitions,
  $schema: reviewWireDialect,
  ...reviewWireNode
} = npAgentChangeSetWireSchemaV1;
const reviewObject = npAgentSchemaObjectV1;
const reviewValueSchema = reviewObject({
  presence: { enum: [...npAgentChangeSetReviewInventoryV1.presence] },
  value: { $ref: "#/$defs/json" },
});
export const npAgentChangeSetReviewSchemaV1: NpAgentJsonSchema = JSON.parse(
  JSON.stringify({
    $schema: reviewWireDialect,
    ...reviewObject({
      schemaVersion: { const: npAgentChangeSetReviewInventoryV1.schemaVersion },
      changeSet: { $ref: "#/$defs/changeset" },
      requiredStaffCapabilities: (npAgentApprovalWireSchemaV1.properties as NpAgentJsonObject)
        .requiredHumanCapabilities,
      operations: {
        type: "array",
        maxItems: npAgentChangeSetReviewInventoryV1.maximumOperations,
        items: reviewObject({
          ordinal: {
            type: "integer",
            minimum: 1,
            maximum: npAgentChangeSetReviewInventoryV1.maximumOperations,
          },
          evidence: { enum: [...npAgentChangeSetReviewInventoryV1.evidence] },
          fields: {
            type: "array",
            maxItems: npAgentChangeSetReviewInventoryV1.maximumFields,
            items: reviewObject({
              path: {
                type: "string",
                minLength: 1,
                maxLength: npAgentChangeSetReviewInventoryV1.maximumPathCharacters,
              },
              before: reviewValueSchema,
              after: reviewValueSchema,
            }),
          },
        }),
      },
    }),
    $defs: { ...(reviewWireDefinitions as NpAgentJsonObject), changeset: reviewWireNode },
  }),
) as NpAgentJsonSchema;
