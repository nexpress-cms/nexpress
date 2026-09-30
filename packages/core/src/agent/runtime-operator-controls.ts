import { and, eq } from "drizzle-orm";
import { npAgentOperatorExecutions } from "../db/schema/agent.js";
import type { NpAgentExecutableOpsPlanInputV1 } from "../agent-contract/operator-capability-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";
import {
  npRequireAgentRuntimePreCommitV1,
  type NpAgentRuntimeExecutionStoreV1,
} from "./runtime-execution-store.js";
import type {
  NpAgentOperatorExecutionResultV1,
  NpAgentOperatorHostV1,
  NpAgentOperatorPlanArtifactV1,
} from "./operator-service.js";
import { NpAgentGatewayError } from "./admin-admission.js";

const contractId = "runtime.operator-controls.v1";
function unavailable(): never {
  throw new NpAgentGatewayError(
    "OPERATOR_RUN_CONFLICT",
    409,
    "The requested Runtime operation is unavailable.",
  );
}
function runInput(input: NpAgentExecutableOpsPlanInputV1) {
  if (input.action === "cache.revalidate") unavailable();
  return input;
}
/** Explicitly installed Runtime owner only. Gateway jobs and raw queue operations stay unavailable. */
export function npCreateAgentRuntimeOperatorControlsV1(options: {
  admission: NpAgentRuntimeAdmissionV1;
  store: NpAgentRuntimeExecutionStoreV1;
}) {
  async function evidence(request: Parameters<NonNullable<NpAgentOperatorHostV1["execute"]>>[0]) {
    const input = runInput(request.input);
    return options.admission.withRunAuthority(
      {
        db: request.db,
        siteId: request.siteId,
        runId: input.target.runId,
        allowTerminal: input.action === "agent.run.retry",
      },
      async ({ db, run }) => {
        if (input.action === "agent.run.retry") {
          if (run.state !== "failed" || !run.finishedAt) unavailable();
        } else {
          await npRequireAgentRuntimePreCommitV1({
            db,
            siteId: run.siteId,
            runId: run.id,
            executionId: request.executionId,
          });
        }
        return {
          schemaVersion: "np.agent-runtime-operator-plan.v1",
          siteId: run.siteId,
          action: input.action,
          runId: run.id,
          admissionFingerprint: run.admissionFingerprint,
        };
      },
    );
  }
  return {
    async plan(
      request: Parameters<NonNullable<NpAgentOperatorHostV1["plan"]>>[0],
    ): Promise<NpAgentOperatorPlanArtifactV1> {
      if (request.input.action !== "agent.run.retry" && request.input.action !== "agent.run.cancel")
        unavailable();
      const artifact = await evidence({
        ...request,
        input: request.input,
        executionId: request.planId,
        artifact: {},
        contractId,
      });
      return {
        artifact,
        contractId,
        projectCommand: "",
        checks: [
          { id: "runtime.current-authority", status: "pass" },
          { id: "runtime.operation-state", status: "pass" },
        ],
      };
    },
    async execute(
      request: Parameters<NonNullable<NpAgentOperatorHostV1["execute"]>>[0],
    ): Promise<NpAgentOperatorExecutionResultV1> {
      if (request.abortSignal.aborted) unavailable();
      return request.db.transaction(
        async (transaction): Promise<NpAgentOperatorExecutionResultV1> => {
          request = { ...request, db: transaction };
          const input = runInput(request.input);
          const current = await evidence(request);
          if (
            request.contractId !== contractId ||
            serializeAgentCanonicalJson(current) !== serializeAgentCanonicalJson(request.artifact)
          )
            unavailable();
          if (request.abortSignal.aborted) unavailable();
          if (input.action === "agent.run.retry") {
            const result = await options.admission.retry({
              db: request.db,
              siteId: request.siteId,
              failedRunId: input.target.runId,
              idempotencyKey: `operator-retry-${request.executionId}`,
            });
            const linked = await request.db
              .update(npAgentOperatorExecutions)
              .set({ sourceRunId: input.target.runId, resultRunId: result.runId })
              .where(
                and(
                  eq(npAgentOperatorExecutions.siteId, request.siteId),
                  eq(npAgentOperatorExecutions.id, request.executionId),
                  eq(npAgentOperatorExecutions.state, "dispatching"),
                ),
              )
              .returning({ id: npAgentOperatorExecutions.id });
            if (linked.length !== 1) unavailable();
            return {
              state: "succeeded" as const,
              evidence: { sourceRunId: input.target.runId, resultRunId: result.runId },
              verificationRefs: [`agent-run:${result.runId}`],
            };
          }
          const result = await options.store.cancelBeforeCommit({
            db: request.db,
            siteId: request.siteId,
            runId: input.target.runId,
            executionId: request.executionId,
          });
          if (result.state !== "cancelled") unavailable();
          const linked = await request.db
            .update(npAgentOperatorExecutions)
            .set({ sourceRunId: input.target.runId })
            .where(
              and(
                eq(npAgentOperatorExecutions.siteId, request.siteId),
                eq(npAgentOperatorExecutions.id, request.executionId),
                eq(npAgentOperatorExecutions.state, "dispatching"),
              ),
            )
            .returning({ id: npAgentOperatorExecutions.id });
          if (linked.length !== 1) unavailable();
          return {
            state: "succeeded" as const,
            evidence: { runId: input.target.runId, state: "cancelled" },
            verificationRefs: [`agent-run:${input.target.runId}`],
          };
        },
      );
    },
  };
}
