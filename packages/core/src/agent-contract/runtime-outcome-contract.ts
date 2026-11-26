export const NP_AGENT_RUNTIME_OUTCOME_STATES = [
  "succeeded",
  "failed",
  "cancelled",
  "policy_blocked",
  "budget_blocked",
] as const;

/** Host-wide retained Runtime facts; not readiness, progress or tenant attribution. */
export interface NpAgentRuntimeOutcomeV1 {
  schemaVersion: "np.agent-runtime-outcome.v1";
  source: "runtime-records";
  generatedAt: string;
  windowStart: string;
  state: "observed" | "unsupported" | "unavailable";
  outcomes: {
    state: (typeof NP_AGENT_RUNTIME_OUTCOME_STATES)[number];
    count: number | null;
    lastFinishedAt: string | null;
  }[];
  active: {
    unfinished: number | null;
    deadlineElapsed: number | null;
    executing: number | null;
    leaseElapsed: number | null;
    leaseMissing: number | null;
  };
}

export function npRequireAgentRuntimeOutcomeV1(value: unknown): NpAgentRuntimeOutcomeV1 {
  const fail = (): never => {
    throw new Error("Invalid Runtime outcome evidence.");
  };
  const object = (v: unknown, keys: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== keys)
      return fail();
    return v as Record<string, unknown>;
  };
  const instant = (v: unknown): string => {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString() !== v
    )
      return fail();
    return v;
  };
  const row = object(value, "active,generatedAt,outcomes,schemaVersion,source,state,windowStart");
  if (
    row.schemaVersion !== "np.agent-runtime-outcome.v1" ||
    row.source !== "runtime-records" ||
    (row.state !== "observed" && row.state !== "unsupported" && row.state !== "unavailable")
  )
    return fail();
  const generatedAt = instant(row.generatedAt),
    windowStart = instant(row.windowStart);
  if (Date.parse(generatedAt) - Date.parse(windowStart) !== 86_400_000) return fail();
  const count = (v: unknown): number | null => {
    if (row.state !== "observed") return v === null ? null : fail();
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return fail();
    return v;
  };
  if (
    !Array.isArray(row.outcomes) ||
    row.outcomes.length !== NP_AGENT_RUNTIME_OUTCOME_STATES.length
  )
    return fail();
  const outcomes = row.outcomes.map((v, i) => {
    const item = object(v, "count,lastFinishedAt,state");
    if (item.state !== NP_AGENT_RUNTIME_OUTCOME_STATES[i]) return fail();
    const n = count(item.count),
      lastFinishedAt = item.lastFinishedAt === null ? null : instant(item.lastFinishedAt);
    if (
      (n === null || n === 0) !== (lastFinishedAt === null) ||
      (lastFinishedAt !== null && (lastFinishedAt < windowStart || lastFinishedAt > generatedAt))
    )
      return fail();
    return { state: NP_AGENT_RUNTIME_OUTCOME_STATES[i], count: n, lastFinishedAt };
  });
  const a = object(row.active, "deadlineElapsed,executing,leaseElapsed,leaseMissing,unfinished");
  const active = {
    unfinished: count(a.unfinished),
    deadlineElapsed: count(a.deadlineElapsed),
    executing: count(a.executing),
    leaseElapsed: count(a.leaseElapsed),
    leaseMissing: count(a.leaseMissing),
  };
  if (
    row.state === "observed" &&
    ((active.deadlineElapsed ?? 0) > (active.unfinished ?? 0) ||
      (active.executing ?? 0) > (active.unfinished ?? 0) ||
      (active.leaseElapsed ?? 0) + (active.leaseMissing ?? 0) > (active.executing ?? 0))
  )
    return fail();
  return {
    schemaVersion: "np.agent-runtime-outcome.v1",
    source: "runtime-records",
    generatedAt,
    windowStart,
    state: row.state,
    outcomes,
    active,
  };
}
