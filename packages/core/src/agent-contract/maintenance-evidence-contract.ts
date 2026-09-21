import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  canonicalBodyInteger,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const NP_AGENT_MAINTENANCE_RECEIPT_KEY = "agents.runtime.maintenance";
export interface NpAgentMaintenanceBatchV1 {
  startedAt: string;
  completedAt: string;
  examined: number;
  pruned: number;
}
/** Private processing metadata: expectedCursor must never be projected to Health. */
export interface NpAgentMaintenanceReceiptV1 {
  schemaVersion: "np.agent-maintenance-receipt.v1";
  lastBatch: NpAgentMaintenanceBatchV1;
  sweepStartedAt: string | null;
  expectedCursor: string | null;
  lastCompletedSweepAt: string | null;
}
const bad = (path: string): never =>
  failCanonicalBody("invalid-field", path, "invalid maintenance evidence");
const utc = (v: unknown, p: string) => canonicalBodyUtc(v, p);
const nullableUtc = (v: unknown, p: string) => (v === null ? null : utc(v, p));
function batch(value: unknown, path: string): NpAgentMaintenanceBatchV1 {
  const keys = ["startedAt", "completedAt", "examined", "pruned"];
  const row = canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
  const result = {
    startedAt: utc(row.startedAt, `${path}.startedAt`),
    completedAt: utc(row.completedAt, `${path}.completedAt`),
    examined: canonicalBodyInteger(row.examined, `${path}.examined`, 0, 100),
    pruned: canonicalBodyInteger(row.pruned, `${path}.pruned`, 0, 10000),
  };
  if (result.startedAt > result.completedAt) bad(path);
  return result;
}
export function npRequireAgentMaintenanceReceiptV1(value: unknown): NpAgentMaintenanceReceiptV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.maintenance.receipt", () => {
      const path = "agent.maintenance.receipt";
      const keys = [
        "schemaVersion",
        "lastBatch",
        "sweepStartedAt",
        "expectedCursor",
        "lastCompletedSweepAt",
      ];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, path, 2048),
        path,
        keys,
        keys,
        { seen: new WeakSet() },
      );
      if (row.schemaVersion !== "np.agent-maintenance-receipt.v1") bad(path);
      const lastBatch = batch(row.lastBatch, `${path}.lastBatch`);
      const sweepStartedAt = nullableUtc(row.sweepStartedAt, `${path}.sweepStartedAt`);
      const expectedCursor =
        row.expectedCursor === null
          ? null
          : canonicalBodyUuid(row.expectedCursor, `${path}.expectedCursor`);
      const lastCompletedSweepAt = nullableUtc(
        row.lastCompletedSweepAt,
        `${path}.lastCompletedSweepAt`,
      );
      if (
        (sweepStartedAt === null) !== (expectedCursor === null) ||
        (sweepStartedAt && sweepStartedAt > lastBatch.startedAt) ||
        (lastCompletedSweepAt && lastCompletedSweepAt > lastBatch.completedAt)
      )
        bad(path);
      return {
        schemaVersion: "np.agent-maintenance-receipt.v1" as const,
        lastBatch,
        sweepStartedAt,
        expectedCursor,
        lastCompletedSweepAt,
      };
    }),
    "Invalid Agent maintenance receipt",
  );
}
export function npNextAgentMaintenanceReceiptV1(
  previous: NpAgentMaintenanceReceiptV1 | null,
  input: NpAgentMaintenanceBatchV1 & { cursor: string | null; nextCursor: string | null },
): NpAgentMaintenanceReceiptV1 {
  const prior = previous === null ? null : npRequireAgentMaintenanceReceiptV1(previous);
  const cursor =
    input.cursor === null ? null : canonicalBodyUuid(input.cursor, "maintenance.cursor");
  const nextCursor =
    input.nextCursor === null
      ? null
      : canonicalBodyUuid(input.nextCursor, "maintenance.nextCursor");
  const lastBatch = batch(
    {
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      examined: input.examined,
      pruned: input.pruned,
    },
    "maintenance.batch",
  );
  if (prior && prior.lastBatch.completedAt > lastBatch.startedAt) bad("maintenance.clock");
  const start =
    cursor === null
      ? lastBatch.startedAt
      : prior?.expectedCursor === cursor
        ? prior.sweepStartedAt
        : null;
  return npRequireAgentMaintenanceReceiptV1({
    schemaVersion: "np.agent-maintenance-receipt.v1",
    lastBatch,
    sweepStartedAt: nextCursor === null ? null : start,
    expectedCursor: start && nextCursor ? nextCursor : null,
    lastCompletedSweepAt:
      start && nextCursor === null ? lastBatch.completedAt : (prior?.lastCompletedSweepAt ?? null),
  });
}

export interface NpAgentMaintenanceHealthV1 {
  schemaVersion: "np.agent-maintenance-health.v1";
  generatedAt: string;
  registration: "registered" | "not-registered" | "unknown";
  workers: {
    state: "observed" | "unavailable";
    aliveCount: number | null;
    totalCount: number | null;
    newestHeartbeat: string | null;
  };
  queue: { state: "supported" | "unsupported" | "unavailable"; retainedFailures: number | null };
  receipts: {
    state: "observed" | "never-recorded" | "unavailable";
    sampledSites: number | null;
    hasMore: boolean;
    completedSweepSites: number | null;
    latestBatch: NpAgentMaintenanceBatchV1 | null;
    latestSweepAt: string | null;
  };
}
export function npRequireAgentMaintenanceHealthV1(value: unknown): NpAgentMaintenanceHealthV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.maintenance.health", () => {
      const path = "agent.maintenance.health";
      const inspected = { seen: new WeakSet<object>() };
      const record = (v: unknown, p: string, keys: string[]) =>
        canonicalBodyRecord(v, p, keys, keys, inspected);
      const row = record(cloneCanonicalRuntimeInput(value, path, 8192), path, [
        "schemaVersion",
        "generatedAt",
        "registration",
        "workers",
        "queue",
        "receipts",
      ]);
      if (row.schemaVersion !== "np.agent-maintenance-health.v1") bad(path);
      const generatedAt = utc(row.generatedAt, `${path}.generatedAt`);
      const registration = row.registration;
      if (
        registration !== "registered" &&
        registration !== "not-registered" &&
        registration !== "unknown"
      )
        return bad(path);
      const w = record(row.workers, `${path}.workers`, [
        "state",
        "aliveCount",
        "totalCount",
        "newestHeartbeat",
      ]);
      const q = record(row.queue, `${path}.queue`, ["state", "retainedFailures"]);
      const r = record(row.receipts, `${path}.receipts`, [
        "state",
        "sampledSites",
        "hasMore",
        "completedSweepSites",
        "latestBatch",
        "latestSweepAt",
      ]);
      const number = (v: unknown) => canonicalBodyInteger(v, path, 0, 2147483647);
      const optionalNumber = (v: unknown) => (v === null ? null : number(v));
      if (w.state !== "observed" && w.state !== "unavailable") return bad(path);
      const workers: NpAgentMaintenanceHealthV1["workers"] = {
        state: w.state,
        aliveCount: optionalNumber(w.aliveCount),
        totalCount: optionalNumber(w.totalCount),
        newestHeartbeat: nullableUtc(w.newestHeartbeat, path),
      };
      if (
        workers.state === "unavailable"
          ? workers.aliveCount !== null ||
            workers.totalCount !== null ||
            workers.newestHeartbeat !== null
          : workers.aliveCount === null ||
            workers.totalCount === null ||
            workers.aliveCount > workers.totalCount ||
            (workers.totalCount === 0) !== (workers.newestHeartbeat === null)
      )
        bad(path);
      if (q.state !== "supported" && q.state !== "unsupported" && q.state !== "unavailable")
        return bad(path);
      const queue: NpAgentMaintenanceHealthV1["queue"] = {
        state: q.state,
        retainedFailures: optionalNumber(q.retainedFailures),
      };
      if ((queue.state === "supported") !== (queue.retainedFailures !== null)) bad(path);
      if (r.state !== "observed" && r.state !== "never-recorded" && r.state !== "unavailable")
        return bad(path);
      if (typeof r.hasMore !== "boolean") return bad(path);
      const receipts: NpAgentMaintenanceHealthV1["receipts"] = {
        state: r.state,
        sampledSites: optionalNumber(r.sampledSites),
        hasMore: r.hasMore,
        completedSweepSites: optionalNumber(r.completedSweepSites),
        latestBatch: r.latestBatch === null ? null : batch(r.latestBatch, path),
        latestSweepAt: nullableUtc(r.latestSweepAt, path),
      };
      if (receipts.state === "unavailable") {
        if (
          receipts.sampledSites !== null ||
          receipts.completedSweepSites !== null ||
          receipts.hasMore ||
          receipts.latestBatch ||
          receipts.latestSweepAt
        )
          bad(path);
      } else {
        if (
          receipts.sampledSites === null ||
          receipts.completedSweepSites === null ||
          receipts.sampledSites > 100 ||
          receipts.completedSweepSites > receipts.sampledSites ||
          (receipts.completedSweepSites === 0) !== (receipts.latestSweepAt === null)
        )
          bad(path);
        if (
          receipts.state === "never-recorded"
            ? receipts.sampledSites !== 0 || receipts.latestBatch !== null || receipts.hasMore
            : receipts.sampledSites === 0 || receipts.latestBatch === null
        )
          bad(path);
      }
      if (
        (workers.newestHeartbeat && workers.newestHeartbeat > generatedAt) ||
        (receipts.latestBatch && receipts.latestBatch.completedAt > generatedAt) ||
        (receipts.latestSweepAt &&
          (!receipts.latestBatch || receipts.latestSweepAt > receipts.latestBatch.completedAt))
      )
        bad(path);
      return {
        schemaVersion: "np.agent-maintenance-health.v1" as const,
        generatedAt,
        registration,
        workers,
        queue,
        receipts,
      };
    }),
    "Invalid Agent maintenance health",
  );
}
