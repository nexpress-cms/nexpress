import { npCollectAgentWorkerHealthV2 } from "@nexpress/core/agents";
import { getJobsPauseState, npCollectAgentQueueBacklogV1 } from "@nexpress/core/jobs";
import type { NpAgentWorkerHealthV2, NpOpsStatusV1 } from "@nexpress/core/agent-contract";
import type { NpAgentQueueBacklogV1 } from "@nexpress/core/jobs-contract";

export interface OperatorWorkerThresholds {
  staleAfterSeconds: number;
  minimumPendingJobs: number;
}
export interface OperatorWorkerFacts {
  paused: boolean | null;
  ready: number | null;
  scheduled: number | null;
  active: number | null;
  oldestReadyAgeSeconds: number | null;
  sampledWorkers: number | null;
  subscribedWorkers: number | null;
  /** The bounded worker sample is incomplete or contains unrecognized evidence. */
  partial: boolean;
  backlogObservedAt: string | null;
  workersObservedAt: string | null;
}
export interface OperatorWorkerObservation {
  schemaVersion: "np.operator-worker-observation.v1";
  scope: "deployment";
  classification: "paused" | "unknown" | "idle" | "attention" | "observed";
  facts: OperatorWorkerFacts;
  checks: NpOpsStatusV1["checks"];
}
function assertThresholds(value: OperatorWorkerThresholds) {
  if (
    !Number.isSafeInteger(value.staleAfterSeconds) ||
    value.staleAfterSeconds < 60 ||
    value.staleAfterSeconds > 86_400 ||
    !Number.isSafeInteger(value.minimumPendingJobs) ||
    value.minimumPendingJobs < 1 ||
    value.minimumPendingJobs > 100_000
  )
    throw new Error("Invalid Operator worker observation thresholds.");
}

/** A single deployment snapshot supports attention, never a claim of progress or failure. */
export function diagnoseOperatorWorkerObservation(
  thresholds: OperatorWorkerThresholds,
  input: {
    paused: boolean | null;
    backlog: NpAgentQueueBacklogV1 | null;
    workers: NpAgentWorkerHealthV2 | null;
  },
): OperatorWorkerObservation {
  assertThresholds(thresholds);
  const backlog = input.backlog?.state === "observed" ? input.backlog : null;
  const workers = input.workers?.summary.state === "observed" ? input.workers : null;
  const sum = (
    keys: Array<"createdReady" | "retryReady" | "createdScheduled" | "retryScheduled" | "active">,
  ) => {
    if (!backlog) return null;
    const values = backlog.queues.flatMap((queue) => keys.map((key) => queue[key]));
    if (values.some((value) => value === null)) return null;
    const total = values.reduce<number>((total, value) => total + (value ?? 0), 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  const ages =
    backlog?.queues.flatMap((queue) =>
      queue.oldestReadyAgeSeconds === null ? [] : [queue.oldestReadyAgeSeconds],
    ) ?? [];
  const facts: OperatorWorkerFacts = {
    paused: input.paused,
    ready: sum(["createdReady", "retryReady"]),
    scheduled: sum(["createdScheduled", "retryScheduled"]),
    active: sum(["active"]),
    oldestReadyAgeSeconds: ages.length ? Math.max(...ages) : null,
    sampledWorkers: workers?.summary.sampledWorkers ?? null,
    subscribedWorkers: workers?.summary.subscribedWorkers ?? null,
    backlogObservedAt: backlog?.generatedAt ?? null,
    workersObservedAt: workers?.summary.generatedAt ?? null,
    partial: !workers || workers.summary.hasMore !== false || workers.summary.unknownWorkers !== 0,
  };
  const agedPending =
    backlog?.queues.some(
      (queue) =>
        (queue.createdReady ?? 0) + (queue.retryReady ?? 0) >= thresholds.minimumPendingJobs &&
        (queue.oldestReadyAgeSeconds ?? -1) >= thresholds.staleAfterSeconds,
    ) ?? false;
  const classification: OperatorWorkerObservation["classification"] =
    input.paused === true
      ? "paused"
      : input.paused === null ||
          !backlog ||
          !workers ||
          facts.partial ||
          facts.ready === null ||
          facts.active === null ||
          facts.scheduled === null
        ? "unknown"
        : agedPending
          ? "attention"
          : facts.ready === 0 && facts.active === 0
            ? "idle"
            : "observed";
  const state =
    classification === "unknown" || classification === "attention" || classification === "paused"
      ? "warn"
      : "ok";
  return {
    schemaVersion: "np.operator-worker-observation.v1",
    scope: "deployment",
    classification,
    facts,
    checks: [
      {
        id: "operator.worker",
        state: facts.subscribedWorkers === 0 ? "warn" : state,
        label: "Agent worker observation",
        detail: `Deployment snapshot: ${classification}; ready ${facts.ready ?? "unknown"}, scheduled ${facts.scheduled ?? "unknown"}, active ${facts.active ?? "unknown"}, oldest ready age ${facts.oldestReadyAgeSeconds ?? "unknown"}s; subscribed workers ${facts.subscribedWorkers ?? "unknown"} of ${facts.sampledWorkers ?? "unknown"}; ${facts.partial ? "partial or unavailable" : "complete sample"}. Threshold: ${thresholds.minimumPendingJobs} ready jobs in one queue aged ${thresholds.staleAfterSeconds}s. Scheduled jobs are not due backlog. A heartbeat or single snapshot does not prove progress, readiness or failure.`,
      },
    ],
  };
}

/** Host must explicitly select pg-boss and provide current deployment authority. */
export async function collectOperatorWorkerObservation(
  options: OperatorWorkerThresholds & {
    authorize(): Promise<void>;
    abortSignal: AbortSignal;
  },
): Promise<OperatorWorkerObservation> {
  assertThresholds(options);
  options.abortSignal.throwIfAborted();
  await options.authorize();
  options.abortSignal.throwIfAborted();
  const [pause, backlog, workers] = await Promise.allSettled([
    getJobsPauseState(),
    npCollectAgentQueueBacklogV1(),
    npCollectAgentWorkerHealthV2(),
  ]);
  options.abortSignal.throwIfAborted();
  await options.authorize();
  options.abortSignal.throwIfAborted();
  return diagnoseOperatorWorkerObservation(options, {
    paused: pause.status === "fulfilled" ? pause.value.paused : null,
    backlog: backlog.status === "fulfilled" ? backlog.value : null,
    workers: workers.status === "fulfilled" ? workers.value : null,
  });
}
