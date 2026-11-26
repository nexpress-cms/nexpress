/** Source-owned observations. These facts never authorize a queue mutation. */
export interface NpAgentOperatorMonitorSnapshotV1 {
  schemaVersion: "np.agent-operator-monitor-snapshot.v1";
  observedAt: string;
  complete: boolean;
  paused: boolean | null;
  queues: Array<{
    name: string;
    ready: number;
    active: number;
    oldestReadyAgeSeconds: number | null;
  }>;
  workers: Array<{
    id: string;
    lastHeartbeatAt: string;
    state: "active" | "paused" | "stopped" | "unknown";
    queues: string[];
  }>;
}
export type NpAgentOperatorRecoveryStateV1 =
  "monitoring" | "recovered" | "paused" | "unknown" | "timed-out";
export interface NpAgentOperatorRecoveryAssessmentV1 {
  state: NpAgentOperatorRecoveryStateV1;
  reason:
    | "waiting"
    | "backlog-decreased-with-live-worker"
    | "intentional-pause"
    | "incomplete-evidence"
    | "window-expired";
  beforePending: number | null;
  afterPending: number | null;
}
export function npRequireAgentOperatorMonitorSnapshotV1(
  value: NpAgentOperatorMonitorSnapshotV1,
): NpAgentOperatorMonitorSnapshotV1 {
  const time = (v: unknown): v is string =>
    typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const token = (v: unknown): v is string =>
    typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
  const queue = (v: unknown): v is string =>
    typeof v === "string" && v.length >= 1 && v.length <= 96 && /^[A-Za-z0-9_.\-/]+$/.test(v);
  const count = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
  if (
    !value ||
    value.schemaVersion !== "np.agent-operator-monitor-snapshot.v1" ||
    !time(value.observedAt) ||
    typeof value.complete !== "boolean" ||
    ![true, false, null].includes(value.paused) ||
    !Array.isArray(value.queues) ||
    value.queues.length > 100 ||
    !Array.isArray(value.workers) ||
    value.workers.length > 100
  )
    throw new Error("Invalid Operator monitor snapshot.");
  if (
    new Set(value.queues.map((q) => q.name)).size !== value.queues.length ||
    value.queues.some(
      (q) =>
        !queue(q.name) ||
        !count(q.ready) ||
        !count(q.active) ||
        (q.oldestReadyAgeSeconds !== null && !count(q.oldestReadyAgeSeconds)) ||
        (q.ready === 0) !== (q.oldestReadyAgeSeconds === null),
    ) ||
    new Set(value.workers.map((w) => w.id)).size !== value.workers.length ||
    value.workers.some(
      (w) =>
        !token(w.id) ||
        !time(w.lastHeartbeatAt) ||
        Date.parse(w.lastHeartbeatAt) > Date.parse(value.observedAt) ||
        !["active", "paused", "stopped", "unknown"].includes(w.state) ||
        !Array.isArray(w.queues) ||
        w.queues.length > 100 ||
        new Set(w.queues).size !== w.queues.length ||
        w.queues.some((q) => !queue(q)),
    )
  )
    throw new Error("Invalid Operator monitor facts.");
  return {
    schemaVersion: "np.agent-operator-monitor-snapshot.v1",
    observedAt: value.observedAt,
    complete: value.complete,
    paused: value.paused,
    queues: value.queues.map((q) => ({
      name: q.name,
      ready: q.ready,
      active: q.active,
      oldestReadyAgeSeconds: q.oldestReadyAgeSeconds,
    })),
    workers: value.workers.map((w) => ({
      id: w.id,
      lastHeartbeatAt: w.lastHeartbeatAt,
      state: w.state,
      queues: [...w.queues],
    })),
  };
}
/** A queue becoming smaller is not sufficient without a current confirmed subscription. */
export function npAssessAgentOperatorRecoveryV1(input: {
  before: NpAgentOperatorMonitorSnapshotV1;
  after: NpAgentOperatorMonitorSnapshotV1;
  queue: string | null;
  now: string;
  deadline: string;
  heartbeatFreshSeconds: number;
}): NpAgentOperatorRecoveryAssessmentV1 {
  const before = npRequireAgentOperatorMonitorSnapshotV1(input.before);
  const after = npRequireAgentOperatorMonitorSnapshotV1(input.after);
  const now = Date.parse(input.now),
    deadline = Date.parse(input.deadline);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(deadline) ||
    !Number.isSafeInteger(input.heartbeatFreshSeconds) ||
    input.heartbeatFreshSeconds < 1 ||
    input.heartbeatFreshSeconds > 86400 ||
    deadline <= Date.parse(before.observedAt) ||
    now < Date.parse(before.observedAt)
  )
    throw new Error("Invalid Operator recovery window.");
  const selected = (snapshot: NpAgentOperatorMonitorSnapshotV1) =>
    snapshot.queues.filter((q) => input.queue === null || q.name === input.queue);
  const b = selected(before),
    a = selected(after);
  const valid =
    before.complete &&
    after.complete &&
    b.length > 0 &&
    a.length === b.length &&
    b.every((q) => a.some((v) => v.name === q.name)) &&
    Date.parse(after.observedAt) > Date.parse(before.observedAt) &&
    Date.parse(after.observedAt) <= now &&
    now - Date.parse(after.observedAt) <= input.heartbeatFreshSeconds * 1000;
  const total = (qs: typeof b) => qs.reduce((n, q) => n + q.ready + q.active, 0);
  const counts = { beforePending: valid ? total(b) : null, afterPending: valid ? total(a) : null };
  // Expired observations cannot retroactively prove that recovery occurred in the window.
  if (now >= deadline) return { ...counts, state: "timed-out", reason: "window-expired" };
  if (after.paused === true) return { ...counts, state: "paused", reason: "intentional-pause" };
  if (!valid || before.paused !== false || after.paused !== false)
    return { ...counts, state: "unknown", reason: "incomplete-evidence" };
  const live = a
    .filter(
      (q) => q.ready + q.active > 0 || b.some((v) => v.name === q.name && v.ready + v.active > 0),
    )
    .every((q) =>
      after.workers.some(
        (w) =>
          w.state === "active" &&
          w.queues.includes(q.name) &&
          now - Date.parse(w.lastHeartbeatAt) < input.heartbeatFreshSeconds * 1000,
      ),
    );
  if (live && total(a) < total(b))
    return { ...counts, state: "recovered", reason: "backlog-decreased-with-live-worker" };
  return { ...counts, state: "monitoring", reason: "waiting" };
}
