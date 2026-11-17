import {
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import type { NpAgentRunV1 } from "./wire-contract.js";

const operations = ["agent.run.cancel", "agent.run.retry"] as const;
const states = ["pending", "approved", "succeeded"] as const;
export type NpAgentActivityRuntimeOperationV1 =
  | {
      operation: (typeof operations)[number];
      state: "pending" | "approved";
      approvalId: string;
      expiresAt: string;
    }
  | { operation: "agent.run.cancel"; state: "succeeded"; actionId: string }
  | { operation: "agent.run.retry"; state: "succeeded"; actionId: string; resultRunId: string };

export const npAgentActivityRuntimeOperationLimitV1 = 8;

export function parseActivityRuntimeOperationsV1(
  value: unknown,
  run: Pick<NpAgentRunV1, "id" | "origin">,
): NpAgentActivityRuntimeOperationV1[] {
  const path = "runtimeOperations";
  if (
    run.origin !== "runtime" ||
    !Array.isArray(value) ||
    value.length > npAgentActivityRuntimeOperationLimitV1
  )
    return failCanonicalBody("invalid-field", path, "must be a bounded Runtime operation list");
  const identities = new Set<string>();
  return value.map((entry) => {
    const inspection = { seen: new WeakSet<object>() };
    const row = canonicalBodyRecord(
      entry,
      path,
      ["operation", "state", "approvalId", "expiresAt", "actionId", "resultRunId"],
      ["operation", "state"],
      inspection,
    );
    const operation = canonicalBodyEnum<(typeof operations)[number]>(
      row.operation,
      path,
      new Set(operations),
    );
    const state = canonicalBodyEnum<(typeof states)[number]>(row.state, path, new Set(states));
    const keys =
      state !== "succeeded"
        ? ["operation", "state", "approvalId", "expiresAt"]
        : operation === "agent.run.retry"
          ? ["operation", "state", "actionId", "resultRunId"]
          : ["operation", "state", "actionId"];
    canonicalBodyRecord(entry, path, keys, keys, { seen: new WeakSet() });
    const id = canonicalBodyUuid(state === "succeeded" ? row.actionId : row.approvalId, path);
    if (identities.has(id))
      return failCanonicalBody("invalid-field", path, "contains a duplicate reference");
    identities.add(id);
    if (state !== "succeeded")
      return { operation, state, approvalId: id, expiresAt: canonicalBodyUtc(row.expiresAt, path) };
    if (operation === "agent.run.cancel") return { operation, state, actionId: id };
    const resultRunId = canonicalBodyUuid(row.resultRunId, path);
    if (resultRunId === run.id)
      return failCanonicalBody("invalid-field", path, "must identify a new Run");
    return { operation, state, actionId: id, resultRunId };
  });
}
