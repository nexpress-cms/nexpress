import { and, asc, eq, sql } from "drizzle-orm";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import {
  npDigestAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonical,
} from "../agent-contract/canonical-recipe-registry.js";
import { npIsAgentModeratorAssessmentRecipeV2 } from "../agent-contract/moderator-assessment-recipe-contract.js";
import {
  npRequireAgentModeratorSegmentedAssessmentV2,
  type NpAgentModeratorSegmentedAssessmentV2,
} from "../agent-contract/moderator-segmented-assessment-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentVersions,
} from "../db/schema/agent.js";
import type { getDb } from "../db/runtime.js";
import { npAgentModeratorAssessmentIncidentContextV1 } from "./moderator-assessment-context.js";
import type { NpAgentModeratorAssessmentSourceV1 } from "./moderator-assessment-source.js";
import type { NpAgentIncidentServiceV1 } from "./incident-service.js";
import {
  npDigestAgentModeratorSegmentedEvidenceV2 as digest,
  npModeratorSegmentedAssessmentUnavailableV2 as unavailable,
  npReadAgentModeratorSegmentProgressV2,
} from "./moderator-segmented-assessment-proof.js";
import {
  npRuntimeRunAdmissionBodyV1,
  type NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";

function aggregate(
  progress: Awaited<ReturnType<typeof npReadAgentModeratorSegmentProgressV2>>,
  run: typeof npAgentRuns.$inferSelect,
): NpAgentModeratorSegmentedAssessmentV2 {
  const { anchor, completed } = progress;
  if (!anchor?.incident || !completed.length) unavailable();
  const incomplete =
    anchor.manifest.incomplete ||
    completed.some((entry) => entry.evidence.truncated || entry.evidence.sources.length === 0);
  const complete = completed.length === anchor.manifest.segmentCount && !incomplete;
  const first = completed[0].decision.label;
  const label =
    complete && first !== "uncertain" && completed.every((entry) => entry.decision.label === first)
      ? first
      : "uncertain";
  const provenance = {
    runId: run.id,
    provider: completed[0].call.provider,
    model: completed[0].call.model,
    recipeFingerprint: run.recipeFingerprint,
    instructionDigest: run.instructionDigest!,
    policyDigests: [
      ...new Set(npRuntimeRunAdmissionBodyV1(run).policyRefs.map((ref) => ref.digest)),
    ].sort(),
  };
  const proofs = completed.map(({ call, evidence }) => ({
    providerCallId: call.id,
    requestDigest: call.requestDigest,
    responseDigest: call.responseDigest,
    evidence,
  }));
  return npRequireAgentModeratorSegmentedAssessmentV2({
    schemaVersion: "np.agent-moderator-segmented-assessment.v2",
    incidentId: anchor.incident.id,
    incidentVersion: anchor.incident.versionNumber,
    observedAt: anchor.observedAt,
    label,
    confidenceBasisPoints:
      label === "uncertain"
        ? 0
        : Math.min(...completed.map((entry) => entry.decision.confidenceBasisPoints)),
    reasonCodes:
      label === "uncertain"
        ? ["insufficient-evidence"]
        : [...new Set(completed.flatMap((entry) => entry.decision.reasonCodes))].sort(),
    summary:
      label === "uncertain"
        ? "Segmented model review is uncertain because evidence is incomplete, uncertain, or conflicting. Human review remains separate."
        : "All admitted segments agree on this read-only model classification. Human review remains separate.",
    coverage: {
      manifestDigest: anchor.manifest.digest,
      signalCount: anchor.manifest.signalCount,
      eventCount: anchor.manifest.eventCount,
      targetCount: anchor.manifest.targetCount,
      segmentCount: anchor.manifest.segmentCount,
      incomplete,
      complete,
    },
    segmentProviderCallIds: completed.map((entry) => entry.call.id),
    proofDigest: digest("np.agent-moderator-segment-aggregate-proof.v2", proofs),
    provenance,
  });
}
async function validatedProgress(db: ReturnType<typeof getDb>, siteId: string, runId: string) {
  const [run] = await db
    .select()
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, siteId), eq(npAgentRuns.id, runId)))
    .limit(1);
  if (
    !run?.agentVersionId ||
    run.origin !== "runtime" ||
    run.instructionTemplateId !== "moderator.semantic-assessment" ||
    run.instructionTemplateVersion !== 2
  )
    unavailable();
  const [version] = await db
    .select()
    .from(npAgentVersions)
    .where(and(eq(npAgentVersions.siteId, siteId), eq(npAgentVersions.id, run.agentVersionId)))
    .limit(1);
  if (!version || version.agentId !== run.agentId || version.configHash !== run.agentConfigHash)
    unavailable();
  const registry = npRequireAgentRecipeRegistryCanonical(version.recipeRegistryBody);
  const recipe = registry.recipes.find(
    (entry) => entry.id === run.recipeId && entry.version === run.recipeVersion,
  );
  if (
    !recipe ||
    !npIsAgentModeratorAssessmentRecipeV2(recipe) ||
    (await npDigestAgentRecipeRegistryCanonical(registry, registry.recipes)) !==
      version.recipeRegistryFingerprint ||
    (await npDigestAgentRecipeRegistryCanonical(
      { ...registry, projection: "definition", recipes: [recipe] },
      registry.recipes,
    )) !== run.recipeFingerprint ||
    (await npDigestAgentRunAdmissionCanonical(npRuntimeRunAdmissionBodyV1(run))) !==
      run.admissionFingerprint
  )
    unavailable();
  const calls = await db
    .select()
    .from(npAgentProviderCalls)
    .where(and(eq(npAgentProviderCalls.siteId, siteId), eq(npAgentProviderCalls.runId, runId)))
    .orderBy(asc(npAgentProviderCalls.sequence))
    .limit(1001);
  if (
    calls.length > 1000 ||
    calls.some(
      (call) =>
        call.recipeId !== run.recipeId ||
        call.recipeVersion !== run.recipeVersion ||
        call.recipeFingerprint !== run.recipeFingerprint ||
        call.instructionTemplateId !== run.instructionTemplateId ||
        call.instructionTemplateVersion !== 2 ||
        call.instructionDigest !== run.instructionDigest ||
        call.responseSchemaDigest !== run.responseSchemaDigest ||
        call.connectionId !== run.connectionId ||
        call.connectionConfigSnapshotId !== run.connectionConfigSnapshotId ||
        call.providerDataClassCeiling !== "sensitive-approved" ||
        call.requestDataClass !== "sensitive-approved" ||
        call.provider !== calls[0].provider ||
        call.model !== calls[0].model,
    )
  )
    unavailable();
  return { run, progress: await npReadAgentModeratorSegmentProgressV2(calls) };
}
/** Independently verifies every successful segment and its exact immutable call/source proof. */
export async function npRequireAgentIncidentSegmentedAssessmentEntryV2(
  db: ReturnType<typeof getDb>,
  row: typeof npAgentIncidentTimeline.$inferSelect,
): Promise<NpAgentModeratorSegmentedAssessmentV2> {
  const assessment = npRequireAgentModeratorSegmentedAssessmentV2(row.details);
  if (
    row.kind !== "agent_assessment" ||
    row.sourceKind !== "agent" ||
    row.incidentId !== assessment.incidentId ||
    row.runId !== assessment.provenance.runId ||
    row.providerCallId !== assessment.segmentProviderCallIds.at(-1) ||
    row.sourceFingerprint !== assessment.proofDigest
  )
    unavailable();
  const { run, progress } = await validatedProgress(db, row.siteId, assessment.provenance.runId);
  if (
    row.sourceId !== run.agentId ||
    !progress.anchor ||
    progress.completed.length !== progress.anchor.manifest.segmentCount ||
    progress.latest?.state !== "succeeded" ||
    serializeAgentCanonicalJson(aggregate(progress, run)) !==
      serializeAgentCanonicalJson(assessment)
  )
    unavailable();
  return assessment;
}
export async function npRecordAgentModeratorSegmentedAssessmentV2(
  options: { source: NpAgentModeratorAssessmentSourceV1; incidents: NpAgentIncidentServiceV1 },
  context: NpAgentRuntimeRunContextV1,
  providerCallId: string,
) {
  const { progress } = await validatedProgress(context.db, context.siteId, context.run.id);
  const { anchor, completed, latest, latestEvidence } = progress;
  if (
    !latest ||
    latest.id !== providerCallId ||
    latest.state !== "succeeded" ||
    !anchor ||
    !latestEvidence
  )
    unavailable();
  if (!anchor.incident)
    return { recorded: false, replayed: false, assessment: null, complete: true };
  await options.incidents.get(
    { incidentId: anchor.incident.id },
    npAgentModeratorAssessmentIncidentContextV1(context),
  );
  const existing = await context.db
    .select()
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.siteId, context.siteId),
        eq(npAgentIncidentTimeline.runId, context.run.id),
        eq(npAgentIncidentTimeline.kind, "agent_assessment"),
      ),
    )
    .limit(2);
  if (existing.length) {
    if (existing.length !== 1) unavailable();
    const assessment = await npRequireAgentIncidentSegmentedAssessmentEntryV2(
      context.db,
      existing[0],
    );
    return {
      recorded: true,
      replayed: true,
      assessment: null,
      segmentedAssessment: assessment,
      complete: true,
    };
  }
  // Rebuild the complete canonical union under current authority and validate this exact segment.
  // Any ACL, Event, Signal, target/version or membership change fences further paid work and aggregation.
  const current = await options.source.read(
    context,
    anchor.observedAt,
    latestEvidence.segmentIndex,
  );
  if (serializeAgentCanonicalJson(current.metadata) !== serializeAgentCanonicalJson(latestEvidence))
    unavailable();
  if (completed.length < anchor.manifest.segmentCount)
    return { recorded: false, replayed: false, assessment: null, complete: false };
  const assessment = aggregate(progress, context.run);
  const [incident] = await context.db
    .select()
    .from(npAgentIncidents)
    .where(
      and(eq(npAgentIncidents.siteId, context.siteId), eq(npAgentIncidents.id, anchor.incident.id)),
    )
    .limit(1)
    .for("update");
  if (
    !incident ||
    incident.versionNumber !== anchor.incident.versionNumber ||
    incident.fingerprint !== anchor.incident.fingerprint ||
    !["open", "investigating"].includes(incident.status) ||
    incident.versionNumber >= 2147483647
  )
    unavailable();
  const [maximum] = await context.db
    .select({ value: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.siteId, context.siteId),
        eq(npAgentIncidentTimeline.incidentId, incident.id),
      ),
    );
  const sequence = Number(maximum?.value ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence > 2147483647) unavailable();
  const updated = await context.db
    .update(npAgentIncidents)
    .set({ versionNumber: incident.versionNumber + 1, updatedAt: context.now })
    .where(
      and(
        eq(npAgentIncidents.siteId, context.siteId),
        eq(npAgentIncidents.id, incident.id),
        eq(npAgentIncidents.versionNumber, incident.versionNumber),
      ),
    )
    .returning({ id: npAgentIncidents.id });
  if (updated.length !== 1) unavailable();
  await context.db.insert(npAgentIncidentTimeline).values({
    siteId: context.siteId,
    incidentId: incident.id,
    sequence,
    kind: "agent_assessment",
    sourceKind: "agent",
    sourceId: context.run.agentId,
    sourceFingerprint: assessment.proofDigest,
    runId: context.run.id,
    providerCallId,
    summary: "Segmented read-only model assessment recorded; human review remains separate.",
    details: JSON.parse(serializeAgentCanonicalJson(assessment)) as NpAgentJsonObject,
    createdAt: context.now,
  });
  return {
    recorded: true,
    replayed: false,
    assessment: null,
    segmentedAssessment: assessment,
    complete: true,
  };
}
