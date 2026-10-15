import {
  npCollectOperatorProgressObservationV1,
  type NpOperatorProgressObservationV1,
  type NpOperatorProgressScopeV1,
} from "@nexpress/core/jobs";
import type { NpOpsStatusV1 } from "@nexpress/core/agent-contract";

export interface OperatorProgressObservation {
  check: NpOpsStatusV1["checks"][number];
  targetCount: number;
  /** Internal audit budget only; never projected as a measured inspection count. */
  consumedTargets: number;
  evidenceRefs: string[];
}

/** Retained timestamps establish measured transitions, never full history or a worker diagnosis. */
export function projectOperatorProgressObservation(
  result: NpOperatorProgressObservationV1,
  reservedTargets = 0,
): OperatorProgressObservation {
  const progress =
    result.state === "observed" &&
    result.complete &&
    ((result.started ?? 0) > 0 || (result.completed ?? 0) > 0);
  const scope = result.scope.kind;
  return {
    targetCount: result.inspectedCount ?? 0,
    consumedTargets: result.inspectedCount ?? reservedTargets,
    check: {
      id: scope === "site" ? "operator.jobs.progress" : "operator.worker.progress",
      label:
        scope === "site"
          ? "Site job transition evidence"
          : "Deployment Agent job transition evidence",
      state: result.failed ? "warn" : progress ? "ok" : "warn",
      detail: `${scope === "site" ? "Site-attributed framework" : "Deployment Agent"} retained 15-minute window ${result.windowStart} to ${result.generatedAt}: started ${result.started ?? "unknown"}, completed ${result.completed ?? "unknown"}, failed ${result.failed ?? "unknown"}, cancelled ${result.cancelled ?? "unknown"}; ${result.complete ? "complete sample" : "partial or unavailable"}. ${progress ? "Actual transition timestamps establish sampled progress." : "Progress is unknown."} Retained rows only; zero or missing evidence does not prove stalled workers, draining, throughput or complete history.`,
    },
    evidenceRefs: [
      "observation:job-progress:v1",
      "basis:retained-pg-boss-transition-timestamps",
      `coverage:${scope === "site" ? "framework-site-payload" : "deployment-agent-queues"}`,
      `observed:${result.generatedAt}`,
      `window-start:${result.windowStart}`,
      "window-seconds:900",
      `state:${result.state}`,
      `complete:${result.complete}`,
      `progress:${progress ? "observed" : "unknown"}`,
      ...(["inspectedCount", "started", "completed", "failed", "cancelled"] as const).map(
        (key) => `fact:${key}:${result[key] ?? "unknown"}`,
      ),
      ...result.coveredQueues.map((queue) => `queue:${queue}`),
    ],
  };
}

export function unavailableOperatorProgressObservation(
  scope: NpOperatorProgressScopeV1,
): OperatorProgressObservation {
  const now = Date.now();
  return projectOperatorProgressObservation({
    schemaVersion: "np.operator-progress-observation.v1",
    source: "pg-boss",
    scope,
    state: "unavailable",
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(now - 900_000).toISOString(),
    windowSeconds: 900,
    coveredQueues: [],
    complete: false,
    inspectedCount: null,
    started: null,
    completed: null,
    failed: null,
    cancelled: null,
  });
}

/** Authorization is supplied by the host, independently for site and deployment evidence. */
export async function collectOperatorProgressObservation(options: {
  scope: NpOperatorProgressScopeV1;
  maxTargets: number;
  authorize(): Promise<void>;
  abortSignal: AbortSignal;
}): Promise<OperatorProgressObservation> {
  options.abortSignal.throwIfAborted();
  await options.authorize();
  options.abortSignal.throwIfAborted();
  const result = await npCollectOperatorProgressObservationV1({
    scope: options.scope,
    maxTargets: options.maxTargets,
  });
  options.abortSignal.throwIfAborted();
  await options.authorize();
  options.abortSignal.throwIfAborted();
  return projectOperatorProgressObservation(result, options.maxTargets);
}
