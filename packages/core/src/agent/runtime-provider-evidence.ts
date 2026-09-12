import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import type { npAgentProviderCalls } from "../db/schema/agent.js";
import {
  npRequireAgentProviderResponseCanonical,
  npDigestAgentProviderResponseCanonical,
} from "../agent-contract/canonical-provider.js";
import type {
  NpAgentProviderTaskOutputV1,
  NpAgentProviderInvokeOutcomeV1,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";

/** Reconstruct the stored success receipt before treating its decision as a checkpoint. */
export async function npRequireAgentRuntimeProviderDecisionV1(
  call: Pick<
    typeof npAgentProviderCalls.$inferSelect,
    | "state"
    | "dispatchState"
    | "decision"
    | "finishedAt"
    | "responseDigest"
    | "siteId"
    | "id"
    | "runId"
    | "requestDigest"
    | "provider"
    | "model"
    | "providerRequestId"
    | "inputTokens"
    | "cachedInputTokens"
    | "outputTokens"
    | "usageSource"
    | "costMicros"
    | "costSource"
    | "finishReason"
    | "latencyMs"
  >,
): Promise<NpAgentProviderTaskOutputV1> {
  try {
    if (
      call.state !== "succeeded" ||
      call.dispatchState !== "dispatched" ||
      !call.decision ||
      !call.finishedAt ||
      !call.responseDigest
    )
      throw new Error();
    const response = npRequireAgentProviderResponseCanonical({
      schemaVersion: "np.agent-provider-response.v1",
      siteId: call.siteId,
      providerCallId: call.id,
      runId: call.runId,
      requestDigest: call.requestDigest,
      dispatchState: "dispatched",
      outcome: {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "succeeded",
        provider: call.provider,
        model: call.model,
        providerRequestId: call.providerRequestId,
        output: structuredClone(call.decision),
        usage: {
          inputTokens: call.inputTokens,
          cachedInputTokens: call.cachedInputTokens,
          outputTokens: call.outputTokens,
          tokenSource: call.usageSource,
          costMicros: call.costMicros,
          costSource: call.costSource,
        },
        finishReason: call.finishReason,
        latencyMs: call.latencyMs,
      },
      decision: call.decision,
      observedAt: call.finishedAt.toISOString(),
    });
    if (
      (await npDigestAgentProviderResponseCanonical(response)) !== call.responseDigest ||
      !response.decision
    )
      throw new Error();
    return response.decision;
  } catch {
    throw new NpAgentGatewayError(
      "RUNTIME_PROVIDER_EVIDENCE_INVALID",
      409,
      "Agent runtime provider evidence is unavailable.",
    );
  }
}

type NpAgentRuntimeFailureRowV1 = Parameters<typeof npRequireAgentRuntimeProviderDecisionV1>[0] &
  Pick<
    typeof npAgentProviderCalls.$inferSelect,
    "errorClass" | "retryable" | "usageReservationId" | "costCurrency"
  >;
type NpAgentRuntimeFailureOutcomeV1 = Extract<NpAgentProviderInvokeOutcomeV1, { status: "failed" }>;

/** Codec only: authority callers must obtain safeCode through the matching persisted audit receipt. */
export async function npRequireAgentRuntimeProviderFailureReceiptV1(
  call: NpAgentRuntimeFailureRowV1,
  safeCode: unknown,
): Promise<NpAgentRuntimeFailureOutcomeV1> {
  try {
    if (
      !["failed", "cancelled"].includes(call.state) ||
      !call.finishedAt ||
      !call.responseDigest ||
      call.decision !== null ||
      (call.state === "cancelled") !== (call.errorClass === "cancelled")
    )
      throw new Error();
    const known = call.inputTokens !== null;
    if (
      known
        ? call.costCurrency !== "USD"
        : [
            call.cachedInputTokens,
            call.outputTokens,
            call.usageSource,
            call.costMicros,
            call.costSource,
            call.costCurrency,
          ].some((value) => value !== null)
    )
      throw new Error();
    const response = npRequireAgentProviderResponseCanonical({
      schemaVersion: "np.agent-provider-response.v1",
      siteId: call.siteId,
      providerCallId: call.id,
      runId: call.runId,
      requestDigest: call.requestDigest,
      dispatchState: call.dispatchState,
      outcome: {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "failed",
        provider: call.provider,
        model: call.model,
        providerRequestId: call.providerRequestId,
        output: null,
        errorClass: call.errorClass,
        safeCode,
        retryable: call.retryable,
        dispatchState: call.dispatchState,
        usage: known
          ? {
              inputTokens: call.inputTokens,
              cachedInputTokens: call.cachedInputTokens,
              outputTokens: call.outputTokens,
              tokenSource: call.usageSource,
              costMicros: call.costMicros,
              costSource: call.costSource,
            }
          : null,
        finishReason: call.finishReason,
        latencyMs: call.latencyMs,
      },
      decision: null,
      observedAt: call.finishedAt.toISOString(),
    });
    if (
      response.outcome.status !== "failed" ||
      (await npDigestAgentProviderResponseCanonical(response)) !== call.responseDigest
    )
      throw new Error();
    return response.outcome;
  } catch {
    throw new NpAgentGatewayError(
      "RUNTIME_PROVIDER_EVIDENCE_INVALID",
      409,
      "Agent runtime provider evidence is unavailable.",
    );
  }
}

/** Legacy missing/multiple audit facts never authorize a failed-call retry. Caller owns the site lock. */
export async function npRequireAgentRuntimeProviderFailureV1(input: {
  db: ReturnType<typeof getDb>;
  call: NpAgentRuntimeFailureRowV1;
}): Promise<NpAgentRuntimeFailureOutcomeV1> {
  const { db, call } = input;
  const receipts = await db
    .select({ payload: npAuditEvents.payload, createdAt: npAuditEvents.createdAt })
    .from(npAuditEvents)
    .where(
      and(
        eq(npAuditEvents.siteId, call.siteId),
        eq(npAuditEvents.action, "agent.runtime.usage"),
        eq(npAuditEvents.actorKind, "system"),
        eq(npAuditEvents.targetType, "agent-provider-call"),
        eq(npAuditEvents.targetId, call.id),
        sql`${npAuditEvents.payload}->>'responseDigest'=${call.responseDigest}`,
        sql`${npAuditEvents.payload}->>'transition' in ('reconciled','expired-unsent')`,
      ),
    )
    .limit(2);
  if (
    receipts.length !== 1 ||
    !receipts[0].payload ||
    typeof receipts[0].payload !== "object" ||
    Array.isArray(receipts[0].payload) ||
    receipts[0].payload.reservationId !== call.usageReservationId ||
    !call.finishedAt ||
    receipts[0].createdAt < call.finishedAt
  ) {
    throw new NpAgentGatewayError(
      "RUNTIME_PROVIDER_EVIDENCE_INVALID",
      409,
      "Agent runtime provider evidence is unavailable.",
    );
  }
  return npRequireAgentRuntimeProviderFailureReceiptV1(call, receipts[0].payload.outcomeSafeCode);
}
