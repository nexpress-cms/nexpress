import { npAgentSchemaObjectV1 } from "./changeset-capability-schema.js";
import { npCollectionContractLimits } from "../collection-contract/contract.js";
import { npAgentChangeSetLimits } from "./changeset-wire-contract.js";
import type { NpAgentJsonValue } from "./types.js";
import {
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyInteger,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { canonicalRuntimeText } from "./canonical-runtime-primitives.js";
const state = () => ({ seen: new WeakSet<object>() });
const record = (v: unknown, p: string, k: string[]) => canonicalBodyRecord(v, p, k, k, state());
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
export function npRequireAgentChangeSetReviewOperationsV1(input: unknown) {
  const path = "agent.changeset.review";
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
    input,
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
  return operations;
}

const reviewValueSchema = npAgentSchemaObjectV1({
  presence: { enum: ["present", "absent", "redacted"] },
  value: { $ref: "#/$defs/json" },
});
export const npAgentChangeSetReviewOperationSchemaV1 = npAgentSchemaObjectV1({
  ordinal: { type: "integer", minimum: 1, maximum: npAgentChangeSetLimits.operations },
  evidence: { enum: ["available", "not_validated", "redacted", "expired"] },
  fields: {
    type: "array",
    maxItems: npCollectionContractLimits.jsonKeys,
    items: npAgentSchemaObjectV1({
      path: { type: "string", minLength: 1, maxLength: 512 },
      before: reviewValueSchema,
      after: reviewValueSchema,
    }),
  },
});
