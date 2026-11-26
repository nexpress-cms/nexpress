import { npCollectAgentOperatorEventObservationV1 } from "@nexpress/core/agents";
import type {
  NpAgentOperatorHostContextV1,
  NpAgentOperatorPlanArtifactV1,
} from "@nexpress/core/agents";
import type { NpAgentJsonObject, NpAgentOpsPlanInputV1 } from "@nexpress/core/agent-contract";
import { buildRunbookJson } from "../../scripts/runbook-core";

/** Concrete read-only runbook owner. It never invokes a command or changes queue state. */
export async function collectOperatorQueuePlanV1(
  request: Pick<NpAgentOperatorHostContextV1, "abortSignal"> & { input: NpAgentOpsPlanInputV1 },
): Promise<NpAgentOperatorPlanArtifactV1> {
  if (request.input.action !== "queue.global.plan")
    throw new Error("Operator queue plan unavailable.");
  request.abortSignal.throwIfAborted();
  const observation = await npCollectAgentOperatorEventObservationV1();
  request.abortSignal.throwIfAborted();
  const snapshot = observation.snapshot;
  const selected = snapshot.queues.filter(
    (q) =>
      request.input.action === "queue.global.plan" &&
      (request.input.target.jobName === null || q.name === request.input.target.jobName),
  );
  if (!snapshot.complete || selected.length === 0)
    throw new Error("Operator queue plan evidence is unavailable.");
  const pending = selected.reduce((n, q) => n + q.ready, 0),
    active = selected.reduce((n, q) => n + q.active, 0);
  const failed = observation.failures.filter(
    (f) =>
      request.input.action === "queue.global.plan" &&
      (request.input.target.jobName === null || f.handlerName === request.input.target.jobName),
  ).length;
  const report = buildRunbookJson({
    runbook: "worker-not-draining",
    evidence: [
      {
        id: "ops.jobs",
        command: "nexpress ops jobs status --json",
        ok: true,
        status: snapshot.paused === true || pending > 0 || failed > 0 ? "attention" : "ready",
        schemaVersion: snapshot.schemaVersion,
        summary: {
          created: pending,
          active,
          retry: 0,
          failed,
          failureWindowSeconds: 900,
          failuresComplete: observation.failuresComplete,
          paused: snapshot.paused,
        },
      },
    ],
  });
  return {
    artifact: JSON.parse(
      JSON.stringify({
        ...report,
        queueTarget: request.input.target,
        observation: snapshot,
        execution: "local-cli-handoff-only",
        limitations:
          "A current snapshot is not recovery or worker failure evidence. Commands remain local review handoffs; queue pause/drain are deployment-wide. Retained failures cover 15 minutes only.",
      }),
    ) as NpAgentJsonObject,
    contractId: "runbook",
    projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
    checks: [
      { id: "queue.current-observation", status: "pass" },
      { id: "queue.local-handoff-only", status: "pass" },
      { id: "queue.pause", status: snapshot.paused ? "warn" : "pass" },
    ],
  };
}
