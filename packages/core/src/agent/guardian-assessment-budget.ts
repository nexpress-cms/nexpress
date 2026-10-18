import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentProviderRequestCanonical } from "../agent-contract/canonical-provider.js";
import {
  npRequireAgentGuardianAssessmentEvidenceV1,
  type NpAgentGuardianAssessmentEvidenceV1,
} from "../agent-contract/guardian-assessment-contract.js";
import {
  npAgentGuardianAssessmentInstructionV1,
  npAgentGuardianAssessmentRecipeIdsV1,
} from "../agent-contract/guardian-assessment-recipe-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";
import { npAgentProviderCalls, npAgentRuns } from "../db/schema/agent.js";
import { npAssertAgentGuardianAssessmentContextV1 } from "./guardian-assessment-context.js";
import { npRequireAgentGuardianAssessmentSourceProofV1 } from "./guardian-assessment-proof.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";

const template = "guardian.incident-assessment";
const pending = ["reserved", "in_flight", "ambiguous"] as const;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_BUDGET_UNAVAILABLE",
    409,
    "Guardian analysis budget is unavailable.",
  );
}
function blocked(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_BUDGET_BLOCKED",
    409,
    "Guardian analysis budget is exhausted.",
  );
}
const instructionDigest = `cj1:sha256:${createHash("sha256").update(npAgentGuardianAssessmentInstructionV1).digest("base64url")}`;
function requestEvidence(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentProviderRequestCanonicalV1,
): NpAgentGuardianAssessmentEvidenceV1 {
  npAssertAgentGuardianAssessmentContextV1(context);
  const entries = request.trustedContext.filter((entry) => entry.id === "guardian-assessment");
  if (
    request.task !== "guardian-assessment" ||
    request.siteId !== context.siteId ||
    request.runId !== context.run.id ||
    request.recipe.id !== context.run.recipeId ||
    request.recipe.fingerprint !== context.run.recipeFingerprint ||
    request.instruction.templateId !== template ||
    request.instruction.templateVersion !== 1 ||
    request.instruction.digest !== instructionDigest ||
    request.tools.length !== 0 ||
    entries.length !== 1 ||
    entries[0].kind !== "server-fact" ||
    entries[0].classification.dataClass !== "sensitive-approved"
  )
    unavailable();
  let evidence: NpAgentGuardianAssessmentEvidenceV1;
  try {
    evidence = npRequireAgentGuardianAssessmentEvidenceV1(JSON.parse(entries[0].text));
  } catch {
    return unavailable();
  }
  const digest = `cj1:sha256:${createHash("sha256").update("np.agent-runtime-guardian-assessment.v1\0").update(serializeAgentCanonicalJson(evidence)).digest("base64url")}`;
  if (
    evidence.recipeId !== context.run.recipeId ||
    Date.parse(evidence.observedAt) > context.now.getTime() ||
    digest !== entries[0].digest ||
    digest !== entries[0].classification.sourceDigest
  )
    unavailable();
  return evidence;
}
interface Analysis {
  agentId: string;
  fingerprint: string | null;
  startedAt: number;
  pending: boolean;
  ambiguous: boolean;
}
async function history(context: NpAgentRuntimeRunContextV1) {
  npAssertAgentGuardianAssessmentContextV1(context);
  const now = context.now.getTime(),
    budgets = [context.siteBudget, context.agentBudget];
  if (!Number.isFinite(now) || !context.run.agentId) unavailable();
  for (const b of budgets)
    if (
      !Number.isSafeInteger(b.incidentAnalysesPerFingerprintPerDay) ||
      b.incidentAnalysesPerFingerprintPerDay < 0 ||
      !Number.isSafeInteger(b.incidentAnalysisCooldownSeconds) ||
      b.incidentAnalysisCooldownSeconds < 0 ||
      b.incidentAnalysisCooldownSeconds > 86400
    )
      unavailable();
  const day = Date.parse(`${context.now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const since = new Date(
    Math.min(day, now - Math.max(...budgets.map((b) => b.incidentAnalysisCooldownSeconds)) * 1000),
  );
  const rows = await context.db
    .select({
      id: npAgentProviderCalls.id,
      runId: npAgentProviderCalls.runId,
      agentId: npAgentRuns.agentId,
      recipeId: npAgentProviderCalls.recipeId,
      state: npAgentProviderCalls.state,
      sequence: npAgentProviderCalls.sequence,
      retryOfId: npAgentProviderCalls.retryOfId,
      retryable: npAgentProviderCalls.retryable,
      dispatchState: npAgentProviderCalls.dispatchState,
      createdAt: npAgentProviderCalls.createdAt,
      requestDigest: npAgentProviderCalls.requestDigest,
      templateVersion: npAgentProviderCalls.instructionTemplateVersion,
      instructionDigest: npAgentProviderCalls.instructionDigest,
      classificationManifest: npAgentProviderCalls.classificationManifest,
      classificationManifestDigest: npAgentProviderCalls.classificationManifestDigest,
      diagnostic: sql<NpAgentJsonObject | null>`case when octet_length(${npAgentProviderCalls.requestRedacted}::text)<=32768 then ${npAgentProviderCalls.requestRedacted} else null end`,
      startedAt: sql<Date>`(select min(anchor.created_at) from np_agent_provider_calls anchor where anchor.site_id=${context.siteId} and anchor.run_id=${npAgentProviderCalls.runId} and anchor.instruction_template_id=${template})`,
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
        eq(npAgentProviderCalls.instructionTemplateId, template),
        or(
          gte(npAgentProviderCalls.createdAt, since),
          eq(npAgentProviderCalls.runId, context.run.id),
          inArray(npAgentProviderCalls.state, [...pending]),
        ),
      ),
    )
    .orderBy(asc(npAgentProviderCalls.createdAt), asc(npAgentProviderCalls.id))
    .limit(1001);
  if (rows.length > 1000) unavailable();
  const analyses = new Map<string, Analysis>(),
    evidences = new Map<string, NpAgentGuardianAssessmentEvidenceV1>();
  for (const row of rows) {
    const d = row.diagnostic;
    if (
      !row.agentId ||
      !npAgentGuardianAssessmentRecipeIdsV1.some((id) => id === row.recipeId) ||
      row.templateVersion !== 1 ||
      row.instructionDigest !== instructionDigest ||
      !d ||
      Object.keys(d).length !== 3 ||
      d.schemaVersion !== "np.agent-guardian-assessment-diagnostic.v1" ||
      d.requestDigest !== row.requestDigest
    )
      unavailable();
    const evidence = npRequireAgentGuardianAssessmentSourceProofV1(row, d.assessmentEvidence);
    if (evidence.recipeId !== row.recipeId) unavailable();
    const startedAt = new Date(row.startedAt).getTime(),
      createdAt = new Date(row.createdAt).getTime();
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(createdAt) ||
      startedAt > createdAt ||
      createdAt > now
    )
      unavailable();
    const fingerprint = evidence.incident?.fingerprint ?? null,
      prior = analyses.get(row.runId);
    if (
      prior &&
      (prior.agentId !== row.agentId ||
        prior.fingerprint !== fingerprint ||
        prior.startedAt !== startedAt)
    )
      unavailable();
    analyses.set(row.runId, {
      agentId: row.agentId,
      fingerprint,
      startedAt,
      pending: !!prior?.pending || pending.some((state) => state === row.state),
      ambiguous: !!prior?.ambiguous || row.state === "ambiguous",
    });
    evidences.set(row.id, evidence);
  }
  return { now, day, budgets, rows, analyses, evidences };
}
export async function npReadAgentGuardianAssessmentEligibilityV1(
  context: NpAgentRuntimeRunContextV1,
): Promise<(fingerprint: string) => boolean> {
  const { now, day, budgets, analyses } = await history(context);
  return (fingerprint) =>
    budgets.every((b, index) => {
      const others = [...analyses.entries()]
        .filter(
          ([id, a]) =>
            id !== context.run.id &&
            a.fingerprint === fingerprint &&
            (index === 0 || a.agentId === context.run.agentId),
        )
        .map(([, a]) => a);
      return (
        others.filter((a) => a.startedAt >= day || a.pending).length + 1 <=
          b.incidentAnalysesPerFingerprintPerDay &&
        !others.some(
          (a) => a.ambiguous || now - a.startedAt < b.incidentAnalysisCooldownSeconds * 1000,
        )
      );
    });
}
/** Called under the current Runtime site lock at reservation and dispatch. This creates no authority or ledger rows. */
export async function npRequireAgentGuardianAssessmentBudgetV1(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentProviderRequestCanonicalV1,
  options: { existingCallId?: string } = {},
): Promise<void> {
  const evidence = requestEvidence(context, request);
  const { day, budgets, rows, analyses, evidences, now } = await history(context);
  const own = rows.filter((r) => r.runId === context.run.id);
  if (options.existingCallId !== undefined) {
    canonicalBodyUuid(options.existingCallId, "guardian.assessment.budget.callId");
    const row = own.find((r) => r.id === options.existingCallId);
    if (
      options.existingCallId !== request.providerCallId ||
      !row ||
      row.state !== "reserved" ||
      row.sequence !== request.sequence ||
      row.retryOfId !== request.retryOfId ||
      row.requestDigest !== (await npDigestAgentProviderRequestCanonical(request)) ||
      !same(evidences.get(row.id), evidence)
    )
      unavailable();
  }
  const prior = own
    .filter((r) => r.id !== options.existingCallId)
    .sort((a, b) => a.sequence - b.sequence);
  if (prior.length) {
    const parent = prior.at(-1)!;
    if (
      parent.id !== request.retryOfId ||
      parent.state !== "failed" ||
      !parent.retryable ||
      !["not-dispatched", "dispatched"].includes(parent.dispatchState) ||
      parent.sequence + 1 !== request.sequence ||
      prior.some((r) => !same(evidences.get(r.id), evidence))
    )
      blocked();
  } else if (request.retryOfId !== null || request.sequence !== 1) unavailable();
  if (!evidence.incident) return;
  const started = analyses.get(context.run.id)?.startedAt ?? now;
  for (let index = 0; index < budgets.length; index++) {
    const b = budgets[index];
    const others = [...analyses.entries()]
      .filter(
        ([id, a]) =>
          id !== context.run.id &&
          a.fingerprint === evidence.incident!.fingerprint &&
          (index === 0 || a.agentId === context.run.agentId),
      )
      .map(([, a]) => a);
    if (
      others.filter((a) => a.startedAt >= day || a.pending).length + 1 >
        b.incidentAnalysesPerFingerprintPerDay ||
      others.some(
        (a) => a.ambiguous || started - a.startedAt < b.incidentAnalysisCooldownSeconds * 1000,
      )
    )
      blocked();
  }
}
