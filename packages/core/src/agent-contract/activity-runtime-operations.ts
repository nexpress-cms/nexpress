import {
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import type { NpAgentRunV1 } from "./wire-contract.js";

const operations = ["agent.run.cancel", "agent.run.retry"] as const;
const states = [
  "pending",
  "approved",
  "reserved",
  "dispatching",
  "unknown",
  "failed",
  "conflicted",
  "succeeded",
] as const;
export type NpAgentActivityUnresolvedRuntimeExecutionV1 = "reserved" | "dispatching" | "unknown";
export type NpAgentActivityRuntimeOperationV1 =
  | {
      operation: (typeof operations)[number];
      state: "pending" | "approved";
      approvalId: string;
      expiresAt: string;
    }
  | {
      operation: (typeof operations)[number];
      state: NpAgentActivityUnresolvedRuntimeExecutionV1;
    }
  | { operation: (typeof operations)[number]; state: "failed" | "conflicted"; actionId: string }
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
    const approval = state === "pending" || state === "approved";
    const unresolved = state === "reserved" || state === "dispatching" || state === "unknown";
    const keys = approval
      ? ["operation", "state", "approvalId", "expiresAt"]
      : unresolved
        ? ["operation", "state"]
        : state === "succeeded" && operation === "agent.run.retry"
          ? ["operation", "state", "actionId", "resultRunId"]
          : ["operation", "state", "actionId"];
    canonicalBodyRecord(entry, path, keys, keys, { seen: new WeakSet() });
    const id = unresolved
      ? `${operation}:${state}`
      : canonicalBodyUuid(approval ? row.approvalId : row.actionId, path);
    if (identities.has(id))
      return failCanonicalBody("invalid-field", path, "contains a duplicate reference");
    identities.add(id);
    if (approval)
      return { operation, state, approvalId: id, expiresAt: canonicalBodyUtc(row.expiresAt, path) };
    if (unresolved) return { operation, state };
    if (state !== "succeeded") return { operation, state, actionId: id };
    if (operation === "agent.run.cancel") return { operation, state, actionId: id };
    const resultRunId = canonicalBodyUuid(row.resultRunId, path);
    if (resultRunId === run.id)
      return failCanonicalBody("invalid-field", path, "must identify a new Run");
    return { operation, state, actionId: id, resultRunId };
  });
}
