import { describe, expect, it } from "vitest";
import {
  npAssessAgentOperatorRecoveryV1,
  npRequireAgentOperatorMonitorSnapshotV1,
  type NpAgentOperatorMonitorSnapshotV1,
} from "./operator-monitor-contract.js";
const baseline = (): NpAgentOperatorMonitorSnapshotV1 => ({
  schemaVersion: "np.agent-operator-monitor-snapshot.v1",
  observedAt: "2026-10-15T00:00:00.000Z",
  complete: true,
  paused: false,
  queues: [{ name: "agent.runExecute", ready: 10, active: 1, oldestReadyAgeSeconds: 600 }],
  workers: [
    {
      id: "worker:1",
      lastHeartbeatAt: "2026-10-14T23:50:00.000Z",
      state: "active",
      queues: ["agent.runExecute"],
    },
  ],
});
const after = (): NpAgentOperatorMonitorSnapshotV1 => ({
  ...baseline(),
  observedAt: "2026-10-15T00:01:00.000Z",
  workers: [
    {
      id: "worker:1",
      lastHeartbeatAt: "2026-10-15T00:01:00.000Z",
      state: "active" as const,
      queues: ["agent.runExecute"],
    },
  ],
});
const assess = (snapshot: NpAgentOperatorMonitorSnapshotV1, now = "2026-10-15T00:01:00.000Z") =>
  npAssessAgentOperatorRecoveryV1({
    before: baseline(),
    after: snapshot,
    queue: "agent.runExecute",
    now,
    deadline: "2026-10-15T00:15:00.000Z",
    heartbeatFreshSeconds: 90,
  });
describe("bounded Operator recovery evidence", () => {
  it("requires both lower pending backlog and a fresh worker subscribed to the selected queue", () => {
    const snapshot = after();
    expect(assess(snapshot).state).toBe("monitoring");
    snapshot.queues[0].ready = 8;
    expect(assess(snapshot)).toMatchObject({
      state: "recovered",
      beforePending: 11,
      afterPending: 9,
    });
    snapshot.workers[0].queues = ["agent.eventDispatch"];
    expect(assess(snapshot).state).toBe("monitoring");
    snapshot.workers[0] = { ...baseline().workers[0] };
    expect(assess(snapshot).state).toBe("monitoring");
  });
  it("does not confuse movement from ready into active with completed work", () => {
    const snapshot = after();
    snapshot.queues[0].ready = 5;
    snapshot.queues[0].active = 6;
    expect(assess(snapshot).state).toBe("monitoring");
  });
  it("keeps intentional pause, missing evidence and deadline distinct", () => {
    const snapshot = after();
    snapshot.paused = true;
    expect(assess(snapshot)).toMatchObject({ state: "paused", reason: "intentional-pause" });
    snapshot.paused = null;
    expect(assess(snapshot).state).toBe("unknown");
    snapshot.paused = false;
    snapshot.complete = false;
    expect(assess(snapshot).state).toBe("unknown");
    expect(assess(snapshot, "2026-10-15T00:15:00.000Z").state).toBe("timed-out");
  });
  it("never upgrades stale, future, changed queue coverage or post-deadline samples", () => {
    const snapshot = after();
    snapshot.queues[0].ready = 0;
    snapshot.queues[0].oldestReadyAgeSeconds = null;
    expect(assess(snapshot, "2026-10-15T00:03:00.000Z").state).toBe("unknown");
    expect(assess(snapshot, "2026-10-15T00:00:30.000Z").state).toBe("unknown");
    snapshot.queues = [];
    expect(assess(snapshot).state).toBe("unknown");
    expect(assess(snapshot, "2026-10-15T00:15:00.000Z").state).toBe("timed-out");
  });
  it("rejects invalid measurements and discards unrelated owner fields", () => {
    const snapshot = baseline();
    snapshot.queues[0].ready = -1;
    expect(() => npRequireAgentOperatorMonitorSnapshotV1(snapshot)).toThrow("facts");
    const withPrivate = { ...baseline(), secret: "private owner field" };
    expect(JSON.stringify(npRequireAgentOperatorMonitorSnapshotV1(withPrivate))).not.toContain(
      "private owner field",
    );
    const future = baseline();
    future.workers[0].lastHeartbeatAt = "2026-10-15T00:01:00.000Z";
    expect(() => npRequireAgentOperatorMonitorSnapshotV1(future)).toThrow("facts");
  });
});
