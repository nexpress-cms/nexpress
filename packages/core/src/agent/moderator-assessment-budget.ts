import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { npDigestAgentProviderRequestCanonical } from "../agent-contract/canonical-provider.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV1,
  type NpAgentModeratorAssessmentEvidenceV1,
} from "../agent-contract/moderator-assessment-contract.js";
import { npAgentProviderCalls, npAgentRuns } from "../db/schema/agent.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentModeratorAssessmentContextV1 } from "./moderator-assessment-context.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";

const TEMPLATE = "moderator.semantic-assessment";
const PENDING = ["reserved", "in_flight", "ambiguous"] as const;
function unavailable(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_BUDGET_UNAVAILABLE",
    409,
    "Moderator analysis budget is unavailable.",
  );
}
function blocked(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_BUDGET_BLOCKED",
    409,
    "Moderator analysis budget is exhausted.",
  );
}
function requestEvidence(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentProviderRequestCanonicalV1,
): NpAgentModeratorAssessmentEvidenceV1 {
  npAssertAgentModeratorAssessmentContextV1(context);
  const entries = request.trustedContext.filter((entry) => entry.id === "moderator-assessment");
  if (
    request.task !== "moderation-classification" ||
    request.siteId !== context.siteId ||
    request.runId !== context.run.id ||
    request.recipe.id !== context.run.recipeId ||
    request.recipe.version !== context.run.recipeVersion ||
    request.recipe.fingerprint !== context.run.recipeFingerprint ||
    request.instruction.templateId !== TEMPLATE ||
    request.instruction.templateVersion !== 1 ||
    request.instruction.digest !== context.run.instructionDigest ||
    entries.length !== 1 ||
    entries[0].kind !== "server-fact" ||
    entries[0].classification.dataClass !== "sensitive-approved"
  )
    return unavailable();
  let metadata: NpAgentModeratorAssessmentEvidenceV1;
  try {
    metadata = npRequireAgentModeratorAssessmentEvidenceV1(JSON.parse(entries[0].text));
  } catch {
    return unavailable();
  }
  const digest = `cj1:sha256:${createHash("sha256").update("np.agent-runtime-moderator-assessment.v1\0").update(serializeAgentCanonicalJson(metadata)).digest("base64url")}`;
  if (
    digest !== entries[0].digest ||
    digest !== entries[0].classification.sourceDigest ||
    Date.parse(metadata.observedAt) > context.now.getTime()
  )
    return unavailable();
  return metadata;
}
interface Analysis {
  runId: string;
  agentId: string;
  fingerprint: string | null;
  startedAt: number;
  pending: boolean;
  ambiguous: boolean;
}
async function analysisHistory(context: NpAgentRuntimeRunContextV1) {
  npAssertAgentModeratorAssessmentContextV1(context);
  const now = context.now.getTime();
  if (!Number.isFinite(now) || !context.run.agentId) unavailable();
  const budgets = [context.siteBudget, context.agentBudget];
  for (const budget of budgets) {
    if (
      !Number.isSafeInteger(budget.incidentAnalysesPerFingerprintPerDay) ||
      budget.incidentAnalysesPerFingerprintPerDay < 0 ||
      !Number.isSafeInteger(budget.incidentAnalysisCooldownSeconds) ||
      budget.incidentAnalysisCooldownSeconds < 0 ||
      budget.incidentAnalysisCooldownSeconds > 86400
    )
      unavailable();
  }
  const day = Date.parse(`${context.now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const since = new Date(
    Math.min(
      day,
      now - Math.max(...budgets.map((budget) => budget.incidentAnalysisCooldownSeconds)) * 1000,
    ),
  );
  const rows = await context.db
    .select({
      id: npAgentProviderCalls.id,
      runId: npAgentProviderCalls.runId,
      agentId: npAgentRuns.agentId,
      state: npAgentProviderCalls.state,
      dispatchState: npAgentProviderCalls.dispatchState,
      sequence: npAgentProviderCalls.sequence,
      retryOfId: npAgentProviderCalls.retryOfId,
      retryable: npAgentProviderCalls.retryable,
      createdAt: npAgentProviderCalls.createdAt,
      requestDigest: npAgentProviderCalls.requestDigest,
      diagnostic: sql<NpAgentJsonObject | null>`case when octet_length(${npAgentProviderCalls.requestRedacted}::text)<=20000 then ${npAgentProviderCalls.requestRedacted} else null end`,
      templateVersion: npAgentProviderCalls.instructionTemplateVersion,
      instructionDigest: npAgentProviderCalls.instructionDigest,
      startedAt: sql<Date>`(select min(anchor.created_at) from np_agent_provider_calls anchor where anchor.site_id=${context.siteId} and anchor.run_id=${npAgentProviderCalls.runId} and anchor.instruction_template_id=${TEMPLATE})`,
    })
    .from(npAgentProviderCalls)
    .innerJoin(
      npAgentRuns,
      and(
        eq(npAgentRuns.siteId, npAgentProviderCalls.siteId),
        eq(npAgentRuns.id, npAgentProviderCalls.runId),
      ),
    )
    .where(
      and(
        eq(npAgentProviderCalls.siteId, context.siteId),
        eq(npAgentProviderCalls.instructionTemplateId, TEMPLATE),
        or(
          gte(npAgentProviderCalls.createdAt, since),
          inArray(npAgentProviderCalls.state, [...PENDING]),
          eq(npAgentProviderCalls.runId, context.run.id),
        ),
      ),
    )
    .orderBy(asc(npAgentProviderCalls.createdAt), asc(npAgentProviderCalls.id))
    .limit(1001);
  if (rows.length > 1000) unavailable();
  const analyses = new Map<string, Analysis>();
  const evidences = new Map<string, NpAgentModeratorAssessmentEvidenceV1>();
  for (const row of rows) {
    // Do not interpret a missing/expired/unknown diagnostic as a different or zero-cost target.
    if (
      !row.agentId ||
      row.templateVersion !== 1 ||
      row.instructionDigest !== context.run.instructionDigest ||
      !row.diagnostic ||
      row.diagnostic.schemaVersion !== "np.agent-moderator-assessment-diagnostic.v1" ||
      row.diagnostic.requestDigest !== row.requestDigest ||
      Object.keys(row.diagnostic).length !== 3
    )
      unavailable();
    let evidence: NpAgentModeratorAssessmentEvidenceV1;
    try {
      evidence = npRequireAgentModeratorAssessmentEvidenceV1(row.diagnostic.assessmentEvidence);
    } catch {
      return unavailable();
    }
    const created = new Date(row.createdAt).getTime(),
      started = new Date(row.startedAt).getTime();
    if (
      !Number.isFinite(created) ||
      !Number.isFinite(started) ||
      created > now ||
      started > created
    )
      unavailable();
    const fingerprint = evidence.incident?.fingerprint ?? null;
    const prior = analyses.get(row.runId);
    if (
      prior &&
      (prior.fingerprint !== fingerprint ||
        prior.agentId !== row.agentId ||
        prior.startedAt !== started)
    )
      unavailable();
    analyses.set(row.runId, {
      runId: row.runId,
      agentId: row.agentId,
      fingerprint,
      startedAt: started,
      pending: (prior?.pending ?? false) || PENDING.some((state) => state === row.state),
      ambiguous: (prior?.ambiguous ?? false) || row.state === "ambiguous",
    });
    evidences.set(row.id, evidence);
  }
  return { now, day, budgets, rows, analyses, evidences };
}
/** Selection uses the same retained, fail-closed accounting as reservation. The
 * final reservation still rechecks under the owning site quota lock. */
export async function npReadAgentModeratorAssessmentEligibilityV1(
  context: NpAgentRuntimeRunContextV1,
): Promise<(fingerprint: string) => boolean> {
  const { now, day, budgets, analyses } = await analysisHistory(context);
  return (fingerprint) =>
    budgets.every((budget, index) => {
      const others = [...analyses.values()].filter(
        (entry) =>
          entry.runId !== context.run.id &&
          entry.fingerprint === fingerprint &&
          (index === 0 || entry.agentId === context.run.agentId),
      );
      return (
        others.filter((entry) => entry.startedAt >= day || entry.pending).length + 1 <=
          budget.incidentAnalysesPerFingerprintPerDay &&
        !others.some(
          (entry) =>
            entry.ambiguous ||
            now - entry.startedAt < budget.incidentAnalysisCooldownSeconds * 1000,
        )
      );
    });
}
/** Caller owns the existing site quota lock and verifies the request through the owning context.
 * This read-only pre-dispatch check never creates an analysis, provider call, or other authority.
 * One explicit retry chain consumes one logical analysis, while ordinary provider/token limits
 * still charge every attempt. Reserved, ambiguous and dispatched attempts never free capacity. */
export async function npRequireAgentModeratorAssessmentBudgetV1(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentProviderRequestCanonicalV1,
  options: { existingCallId?: string } = {},
): Promise<void> {
  const metadata = requestEvidence(context, request);
  const { now, day, budgets, rows, analyses, evidences } = await analysisHistory(context);
  if (options.existingCallId !== undefined) {
    canonicalBodyUuid(options.existingCallId, "moderator.assessment.budget.callId");
    if (options.existingCallId !== request.providerCallId) unavailable();
  }
  const own = rows.filter((row) => row.runId === context.run.id);
  const ownOtherCalls = own.filter((row) => row.id !== options.existingCallId);
  if (options.existingCallId !== undefined) {
    const existing = own.find((row) => row.id === options.existingCallId);
    if (
      !existing ||
      existing.state !== "reserved" ||
      existing.sequence !== request.sequence ||
      existing.retryOfId !== request.retryOfId ||
      existing.requestDigest !== (await npDigestAgentProviderRequestCanonical(request)) ||
      serializeAgentCanonicalJson(evidences.get(existing.id)) !==
        serializeAgentCanonicalJson(metadata)
    )
      unavailable();
  }
  if (ownOtherCalls.length) {
    // A second classification turn is not a free retry. Only the retained owning failure may retry.
    const parent = ownOtherCalls.find((row) => row.id === request.retryOfId);
    if (
      !parent ||
      parent.state !== "failed" ||
      parent.retryable !== true ||
      !["not-dispatched", "dispatched"].includes(parent.dispatchState) ||
      parent.sequence >= request.sequence ||
      ownOtherCalls.some((row) => row.sequence >= request.sequence) ||
      ownOtherCalls.some(
        (row) =>
          serializeAgentCanonicalJson(evidences.get(row.id)?.incident) !==
          serializeAgentCanonicalJson(metadata.incident),
      )
    )
      blocked();
  } else if (
    request.retryOfId !== null ||
    (options.existingCallId === undefined && request.sequence !== 1)
  )
    unavailable();
  if (metadata.incident === null) return; // No Incident means an uncertainty-only turn, still charged by provider/token ceilings.
  const current = analyses.get(context.run.id);
  const currentStarted = current?.startedAt ?? now;
  const fingerprint = metadata.incident.fingerprint;
  for (let index = 0; index < budgets.length; index++) {
    const budget = budgets[index];
    const others = [...analyses.values()].filter(
      (entry) =>
        entry.runId !== context.run.id &&
        entry.fingerprint === fingerprint &&
        (index === 0 || entry.agentId === context.run.agentId),
    );
    const charged = others.filter((entry) => entry.startedAt >= day || entry.pending).length;
    // The current reservation also counts when an explicit retry crosses UTC midnight.
    if (charged + 1 > budget.incidentAnalysesPerFingerprintPerDay) blocked();
    if (
      others.some(
        (entry) =>
          entry.ambiguous ||
          currentStarted - entry.startedAt < budget.incidentAnalysisCooldownSeconds * 1000,
      )
    )
      blocked();
  }
}
