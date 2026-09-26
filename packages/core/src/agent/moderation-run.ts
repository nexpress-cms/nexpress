import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentActions, npAgentRuns } from "../db/schema/agent.js";
import {
  npRequireAgentRunLimitsCanonical,
  npDigestAgentRunLimitsCanonical,
} from "../agent-contract/canonical-bodies.js";
import {
  npRequireAgentBudgetSnapshotCanonical,
  npDigestAgentBudgetSnapshotCanonical,
} from "../agent-contract/canonical-budget-snapshot.js";
import {
  npRequireAgentRunAdmissionCanonical,
  npDigestAgentRunAdmissionCanonical,
} from "../agent-contract/canonical-run-admission.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeUsageKnownV1,
  npRequireAgentRuntimeBudgetCapacityV1,
} from "./runtime-budget.js";
import {
  npResolveAgentBudgetV1,
  type NpAgentConcreteBudgetV1,
} from "../agent-contract/runtime-budget.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentJsonObject, NpAgentTargetRef } from "../agent-contract/types.js";

/** Caller already holds the shared site quota lock before principal authority locks. */
export async function npMeasureModerationBudgetV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  now: Date;
  target: NpAgentTargetRef;
  budget: NpAgentConcreteBudgetV1;
  reserveRun: boolean;
}) {
  const { db, siteId, now } = input;
  await npRequireAgentRuntimeUsageKnownV1({ db, siteId });
  const measured = await npMeasureAgentRuntimeBudgetV1({ db, siteId, now });
  const since = new Date(now.getTime() - 3600000);
  const [actions] = await db
    .select({
      total: sql<number>`count(*)::int`,
      subject: sql<number>`count(*) filter (where ${npAgentActions.targetRefs} @> ${serializeAgentCanonicalJson([input.target])}::jsonb)::int`,
    })
    .from(npAgentActions)
    .where(
      and(
        eq(npAgentActions.siteId, siteId),
        sql`${npAgentActions.effectProfileId}<>'domain.read' and ${npAgentActions.state} in ('executing','succeeded','failed','compensated') and coalesce(${npAgentActions.startedAt},${npAgentActions.createdAt})>=${since}`,
      ),
    );
  const counters = {
    ...measured,
    directActionsRollingHour: actions?.total ?? 0,
    directActionsSubjectRollingHour: actions?.subject ?? 0,
  };
  const budget = npResolveAgentBudgetV1(input.budget);
  npRequireAgentRuntimeBudgetCapacityV1({
    budget,
    counters,
    reservation: {
      runs: input.reserveRun ? 1 : 0,
      providerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    },
  });
  if (
    budget.attemptsPerRun < 1 ||
    budget.capabilityCallsPerRun < 1 ||
    counters.directActionsRollingHour + 1 > budget.directActionsPerHour ||
    counters.directActionsSubjectRollingHour + 1 > budget.directActionsPerSubjectPerHour
  )
    throw new NpAgentGatewayError(
      "MODERATION_BUDGET_BLOCKED",
      409,
      "Moderation budget is exhausted.",
    );
  return counters;
}

/** A real one-action Gateway run; no provider, worker or Runtime identity is created. */
export async function npCreateModerationGatewayRunV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  principalId: string;
  invocationId: string;
  capabilityId: string;
  now: Date;
  target: NpAgentTargetRef;
  budget: NpAgentConcreteBudgetV1;
}) {
  const { db, siteId, principalId, now } = input;
  const id = randomUUID();
  const limits = npRequireAgentRunLimitsCanonical({
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: 1,
    maxProviderCalls: 1,
    maxCapabilityCalls: 1,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    maxCostMicros: 0,
    maxWallClockSeconds: 900,
  });
  const since = new Date(now.getTime() - 3600000);
  const counters = await npMeasureModerationBudgetV1({ ...input, reserveRun: true });
  const budget = npRequireAgentBudgetSnapshotCanonical({
    schemaVersion: "np.agent-budget-snapshot.v1",
    siteId,
    principalId,
    agentId: null,
    recipe: null,
    capturedAt: now.toISOString(),
    sourceRefs: [],
    limits,
    counters,
    windows: {
      rollingHourStartedAt: since.toISOString(),
      utcDay: now.toISOString().slice(0, 10),
      utcMonth: now.toISOString().slice(0, 7),
    },
    reservation: { runs: 1, providerCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
  });
  const runLimitsHash = await npDigestAgentRunLimitsCanonical(limits);
  const budgetSnapshotHash = await npDigestAgentBudgetSnapshotCanonical(budget);
  const deadlineAt = new Date(now.getTime() + 900000);
  const admission = npRequireAgentRunAdmissionCanonical({
    schemaVersion: "np.agent-run-admission.v1",
    siteId,
    origin: "gateway",
    principalId,
    invocationId: input.invocationId,
    triggerId: null,
    agent: null,
    lineage: {
      rootRunId: id,
      parentRunId: null,
      causalDepth: 0,
      causalEventId: null,
      causalActionId: null,
    },
    recipe: null,
    goal: input.capabilityId,
    eventRef: null,
    policyRefs: [],
    runLimitsHash,
    budgetSnapshotHash,
    idempotencyKey: `invocation:${input.invocationId}`,
    connection: null,
    admittedAt: now.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  });
  const fingerprint = await npDigestAgentRunAdmissionCanonical(admission);
  await db.insert(npAgentRuns).values({
    id,
    siteId,
    origin: "gateway",
    principalId,
    invocationId: input.invocationId,
    admissionFingerprint: fingerprint,
    rootRunId: id,
    causalDepth: 0,
    state: "waiting_approval",
    goal: input.capabilityId,
    policyRefs: [],
    runLimits: limits,
    runLimitsHash,
    budgetSnapshot: budget as unknown as NpAgentJsonObject,
    budgetSnapshotHash,
    idempotencyKey: `invocation:${input.invocationId}`,
    attempt: 1,
    usage: {
      providerCalls: 0,
      capabilityCalls: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    },
    queuedAt: now,
    startedAt: now,
    deadlineAt,
  });
  return { id, fingerprint, deadlineAt };
}
