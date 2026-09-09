import { getCollectionConfig } from "../collections/registry.js";
import { npProjectAgentEditableDocumentV1 } from "./changeset-resources.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetSnapshotCanonicalV1,
  NpAgentJsonValue,
} from "../agent-contract/types.js";
import type {
  NpAgentChangeSetReviewOperationV1,
  NpAgentChangeSetReviewValueV1,
} from "../agent-contract/changeset-review-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";

function record(value: NpAgentJsonValue | null): Record<string, NpAgentJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}
const value = (v: NpAgentJsonValue | undefined): NpAgentChangeSetReviewValueV1 =>
  v === undefined ? { presence: "absent", value: null } : { presence: "present", value: v };

/** Called only after the service verifies the sealed snapshot and every current target ACL. */
export function npProjectAgentChangeSetReviewOperationV1(input: {
  ordinal: number;
  operation: NpAgentChangeSetOperationInput;
  snapshot: NpAgentChangeSetSnapshotCanonicalV1 | null;
  expired: boolean;
}): NpAgentChangeSetReviewOperationV1 {
  const { ordinal, operation: op, snapshot } = input;
  if (input.expired) return { ordinal, evidence: "expired", fields: [] };
  if (!snapshot) return { ordinal, evidence: "not_validated", fields: [] };
  const stored = record(snapshot.value);
  let before: Record<string, NpAgentJsonValue> = {};
  let after: Record<string, NpAgentJsonValue> = {};
  if (op.kind === "document") {
    const config = getCollectionConfig(op.resource.collection);
    const proposed =
      op.operation === "create"
        ? op.input.document
        : op.operation === "update"
          ? op.input.patch
          : {};
    const keys = Object.keys(proposed);
    // Select only fields changed by the proposal; actor ids and internal snapshot metadata never enter.
    before = Object.fromEntries(
      keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]]),
    );
    after = { ...proposed };
    if (
      op.operation === "create" ||
      (op.operation === "update" && op.input.targetStatus !== null) ||
      op.operation === "publish" ||
      op.operation === "archive"
    ) {
      if (snapshot.presence === "present") before.status = stored.status;
      after.status =
        op.operation === "create" || op.operation === "update"
          ? op.input.targetStatus!
          : op.operation === "publish"
            ? "published"
            : "archived";
    }
    if (op.operation === "schedule") {
      if (Object.hasOwn(stored, "publishedAt")) before.publishedAt = stored.publishedAt;
      if (Object.hasOwn(stored, "status")) before.status = stored.status;
      after.publishedAt = op.input.publishAt;
      after.status = "scheduled";
    }
    before = npProjectAgentEditableDocumentV1(config.fields, before) as Record<
      string,
      NpAgentJsonValue
    >;
    after = npProjectAgentEditableDocumentV1(config.fields, after) as Record<
      string,
      NpAgentJsonValue
    >;
  } else if (op.kind === "navigation") {
    before = { items: stored.items };
    after = { items: op.input.items as unknown as NpAgentJsonValue };
  } else if (op.kind === "theme_tokens") {
    if (snapshot.presence === "present") before = { tokens: stored.value };
    after = { tokens: op.input.tokens as unknown as NpAgentJsonValue };
  } else if (op.kind === "setting") {
    if (snapshot.presence === "present") before = { value: stored.value };
    if (op.operation === "replace") after = { value: op.input.value };
  } else {
    before = { attached: stored.attached };
    after = { attached: op.operation === "attach" };
  }
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((path) => {
      const b = value(before[path]),
        a = value(after[path]);
      return serializeAgentCanonicalJson(b) === serializeAgentCanonicalJson(a)
        ? []
        : [{ path, before: b, after: a }];
    });
  return { ordinal, evidence: "available", fields };
}
