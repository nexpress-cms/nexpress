import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyInteger,
  canonicalBodySha256Digest,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
} from "./canonical-runtime-primitives.js";
import {
  npRequireAgentOpsPlanOutputV1,
  type NpAgentOpsPlanOutputV1,
} from "./operator-capability-contract.js";

/** Current-viewer-authorized metadata only. Private artifacts and recovery snapshots stay server-owned. */
export interface NpAgentOperatorReviewV1 {
  schemaVersion: "np.agent-operator-review.v1";
  capabilityId: "ops.status" | "audit.run" | "ops.plan" | "ops.execute";
  checks: Array<{ id: string; state: "pass" | "warn" | "fail" | "unknown" }>;
  plan: NpAgentOpsPlanOutputV1 | null;
  queue: { observedAt: string; paused: boolean | null; ready: number; active: number } | null;
  recovery: {
    monitorId: string;
    state: "monitoring" | "recovered" | "paused" | "unknown" | "timed-out";
    reason:
      | "waiting"
      | "backlog-decreased-with-live-worker"
      | "intentional-pause"
      | "incomplete-evidence"
      | "window-expired";
    startedAt: string;
    sampledAt: string;
    deadline: string;
    beforePending: number | null;
    afterPending: number | null;
  } | null;
  execution: { state: "succeeded" | "failed" | "conflicted"; resultDigest: string } | null;
}
export function npRequireAgentOperatorReviewV1(value: unknown): NpAgentOperatorReviewV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("operator.review", () => {
      const record = (v: unknown, keys: string[]) =>
        canonicalBodyRecord(v, "operator.review", keys, keys, { seen: new WeakSet() });
      const r = record(cloneCanonicalRuntimeInput(value, "operator.review", 65536), [
        "schemaVersion",
        "capabilityId",
        "checks",
        "plan",
        "queue",
        "recovery",
        "execution",
      ]);
      const count = (v: unknown) => canonicalBodyInteger(v, "count", 0, 2147483647);
      const checks = r.checks;
      if (!Array.isArray(checks) || checks.length > 128)
        throw new Error("Invalid Operator review checks.");
      const parsed: NpAgentOperatorReviewV1["checks"] = checks.map((c) => {
        const v = record(c, ["id", "state"]);
        return {
          id: canonicalRuntimeText(v.id, "check.id", 128, { requireTrimmed: true }),
          state: canonicalBodyEnum(
            v.state,
            "state",
            new Set(["pass", "warn", "fail", "unknown"] as const),
          ),
        };
      });
      if (new Set(parsed.map((c) => c.id)).size !== parsed.length)
        throw new Error("Duplicate Operator review checks.");
      let queue: NpAgentOperatorReviewV1["queue"] = null;
      if (r.queue !== null) {
        const q = record(r.queue, ["observedAt", "paused", "ready", "active"]);
        if (q.paused !== true && q.paused !== false && q.paused !== null)
          throw new Error("Invalid queue pause.");
        queue = {
          observedAt: canonicalBodyUtc(q.observedAt, "observedAt"),
          paused: q.paused,
          ready: count(q.ready),
          active: count(q.active),
        };
      }
      let recovery: NpAgentOperatorReviewV1["recovery"] = null;
      if (r.recovery !== null) {
        const m = record(r.recovery, [
          "monitorId",
          "state",
          "reason",
          "startedAt",
          "sampledAt",
          "deadline",
          "beforePending",
          "afterPending",
        ]);
        recovery = {
          monitorId: canonicalBodyUuid(m.monitorId, "monitorId"),
          state: canonicalBodyEnum(
            m.state,
            "state",
            new Set(["monitoring", "recovered", "paused", "unknown", "timed-out"] as const),
          ),
          reason: canonicalBodyEnum(
            m.reason,
            "reason",
            new Set([
              "waiting",
              "backlog-decreased-with-live-worker",
              "intentional-pause",
              "incomplete-evidence",
              "window-expired",
            ] as const),
          ),
          startedAt: canonicalBodyUtc(m.startedAt, "startedAt"),
          sampledAt: canonicalBodyUtc(m.sampledAt, "sampledAt"),
          deadline: canonicalBodyUtc(m.deadline, "deadline"),
          beforePending: m.beforePending === null ? null : count(m.beforePending),
          afterPending: m.afterPending === null ? null : count(m.afterPending),
        };
      }
      let execution: NpAgentOperatorReviewV1["execution"] = null;
      if (r.execution !== null) {
        const e = record(r.execution, ["state", "resultDigest"]);
        execution = {
          state: canonicalBodyEnum(
            e.state,
            "state",
            new Set(["succeeded", "failed", "conflicted"] as const),
          ),
          resultDigest: canonicalBodySha256Digest(e.resultDigest, "resultDigest"),
        };
      }
      const review: NpAgentOperatorReviewV1 = {
        schemaVersion: canonicalBodyEnum(
          r.schemaVersion,
          "schemaVersion",
          new Set(["np.agent-operator-review.v1"] as const),
        ),
        capabilityId: canonicalBodyEnum(
          r.capabilityId,
          "capabilityId",
          new Set(["ops.status", "audit.run", "ops.plan", "ops.execute"] as const),
        ),
        checks: parsed,
        plan: r.plan === null ? null : npRequireAgentOpsPlanOutputV1(r.plan),
        queue,
        recovery,
        execution,
      };
      if (
        (review.plan !== null && review.capabilityId !== "ops.plan") ||
        ((review.queue !== null || review.recovery !== null) && review.plan === null) ||
        (review.execution !== null && review.capabilityId !== "ops.execute")
      )
        throw new Error("Invalid Operator review relationship.");
      if (
        review.recovery &&
        (review.recovery.monitorId !== review.plan?.planId ||
          review.recovery.sampledAt < review.recovery.startedAt ||
          review.recovery.deadline <= review.recovery.startedAt ||
          (review.recovery.state === "recovered" &&
            (review.recovery.reason !== "backlog-decreased-with-live-worker" ||
              review.recovery.beforePending === null ||
              review.recovery.afterPending === null ||
              review.recovery.afterPending >= review.recovery.beforePending)))
      )
        throw new Error("Invalid recovery evidence.");
      return review;
    }),
  );
}
