import { and, eq, sql } from "drizzle-orm";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import {
  npDigestAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonical,
} from "../agent-contract/canonical-recipe-registry.js";
import { npIsAgentModeratorAssessmentRecipeV1 } from "../agent-contract/moderator-assessment-recipe-contract.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV1,
  npRequireAgentModeratorAssessmentV1,
  type NpAgentModeratorAssessmentV1,
} from "../agent-contract/moderator-assessment-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentVersions,
} from "../db/schema/agent.js";
import type { getDb } from "../db/runtime.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentServiceV1 } from "./incident-service.js";
import {
  npAgentModeratorAssessmentIncidentContextV1,
  npAssertAgentModeratorAssessmentContextV1,
  npDigestAgentModeratorAssessmentSourcesV1,
  npIsAgentModeratorAssessmentSourceV1,
  npRequireAgentModeratorAssessmentSourceProofV1,
  type NpAgentModeratorAssessmentSourceV1,
} from "./moderator-assessment-source.js";
import {
  npRuntimeRunAdmissionBodyV1,
  type NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "./runtime-provider-evidence.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";

export interface NpAgentIncidentAssessmentRecordResultV1 {
  recorded: boolean;
  replayed: boolean;
  assessment: NpAgentModeratorAssessmentV1 | null;
}
export interface NpAgentIncidentAssessmentServiceV1 {
  /** Called only inside the live Runtime authority transaction after a confirmed provider success. */
  record(
    context: NpAgentRuntimeRunContextV1,
    input: { providerCallId: string },
  ): Promise<NpAgentIncidentAssessmentRecordResultV1>;
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "INCIDENT_ASSESSMENT_UNAVAILABLE",
    409,
    "Incident assessment is unavailable.",
  );
}

/** Read-only stored proof. The caller independently authorizes the current Incident and all sources. */
export async function npRequireAgentIncidentAssessmentEntryV1(
  db: ReturnType<typeof getDb>,
  row: typeof npAgentIncidentTimeline.$inferSelect,
): Promise<NpAgentModeratorAssessmentV1> {
  const assessment = npRequireAgentModeratorAssessmentV1(row.details);
  if (
    row.kind !== "agent_assessment" ||
    row.sourceKind !== "agent" ||
    !row.runId ||
    !row.providerCallId ||
    row.incidentId !== assessment.incidentId ||
    row.runId !== assessment.provenance.runId ||
    row.providerCallId !== assessment.provenance.providerCallId ||
    row.sourceFingerprint !== assessment.provenance.responseDigest
  )
    unavailable();
  const [call] = await db
    .select()
    .from(npAgentProviderCalls)
    .where(
      and(
        eq(npAgentProviderCalls.siteId, row.siteId),
        eq(npAgentProviderCalls.runId, row.runId),
        eq(npAgentProviderCalls.id, row.providerCallId),
      ),
    )
    .limit(1);
  const [run] = await db
    .select()
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, row.siteId), eq(npAgentRuns.id, row.runId)))
    .limit(1);
  if (
    !call ||
    !run ||
    !run.agentVersionId ||
    row.sourceId !== run.agentId ||
    run.origin !== "runtime" ||
    call.instructionTemplateId !== "moderator.semantic-assessment" ||
    call.instructionTemplateVersion !== 1 ||
    call.recipeId !== "moderator.repeated-link-spam" ||
    call.recipeVersion !== 1 ||
    call.recipeFingerprint !== run.recipeFingerprint ||
    call.instructionDigest !== run.instructionDigest ||
    call.responseSchemaDigest !== run.responseSchemaDigest ||
    call.connectionId !== run.connectionId ||
    call.connectionConfigSnapshotId !== run.connectionConfigSnapshotId ||
    call.providerDataClassCeiling !== "sensitive-approved" ||
    call.requestDataClass !== "sensitive-approved"
  )
    unavailable();
  const [version] = await db
    .select()
    .from(npAgentVersions)
    .where(and(eq(npAgentVersions.siteId, row.siteId), eq(npAgentVersions.id, run.agentVersionId)))
    .limit(1);
  if (!version || version.agentId !== run.agentId || version.configHash !== run.agentConfigHash)
    unavailable();
  const registry = npRequireAgentRecipeRegistryCanonical(version.recipeRegistryBody);
  const recipe = registry.recipes.find(
    (entry) => entry.id === call.recipeId && entry.version === call.recipeVersion,
  );
  if (
    !recipe ||
    !npIsAgentModeratorAssessmentRecipeV1(recipe) ||
    (await npDigestAgentRecipeRegistryCanonical(registry, registry.recipes)) !==
      version.recipeRegistryFingerprint ||
    (await npDigestAgentRecipeRegistryCanonical(
      { ...registry, projection: "definition", recipes: [recipe] },
      registry.recipes,
    )) !== run.recipeFingerprint
  )
    unavailable();
  const admission = npRuntimeRunAdmissionBodyV1(run);
  if ((await npDigestAgentRunAdmissionCanonical(admission)) !== run.admissionFingerprint)
    unavailable();
  const output = await npRequireAgentRuntimeProviderDecisionV1(call);
  if (output.task !== "moderation-classification" || output.decision.kind !== "classification")
    unavailable();
  const decision = output.decision;
  const { evidence, provenance } = assessment;
  npRequireAgentModeratorAssessmentSourceProofV1(call, evidence);
  const admitted = [...new Set(evidence.sources.map((source) => source.excerptDigest))].sort();
  if (
    provenance.provider !== call.provider ||
    provenance.model !== call.model ||
    provenance.recipeFingerprint !== call.recipeFingerprint ||
    provenance.instructionDigest !== call.instructionDigest ||
    provenance.requestDigest !== call.requestDigest ||
    provenance.responseDigest !== call.responseDigest ||
    provenance.sourceDigest !== npDigestAgentModeratorAssessmentSourcesV1(evidence) ||
    serializeAgentCanonicalJson(provenance.policyDigests) !==
      serializeAgentCanonicalJson(
        [...new Set(admission.policyRefs.map((ref) => ref.digest))].sort(),
      ) ||
    assessment.label !== decision.label ||
    assessment.confidenceBasisPoints !== decision.confidenceBasisPoints ||
    assessment.summary !== decision.summary ||
    serializeAgentCanonicalJson(assessment.reasonCodes) !==
      serializeAgentCanonicalJson(decision.reasonCodes) ||
    serializeAgentCanonicalJson(assessment.evidenceDigests) !==
      serializeAgentCanonicalJson(decision.evidenceDigests) ||
    decision.evidenceDigests.some((entry) => !admitted.includes(entry)) ||
    (decision.label !== "uncertain" &&
      (evidence.truncated ||
        admitted.length === 0 ||
        serializeAgentCanonicalJson(decision.evidenceDigests) !==
          serializeAgentCanonicalJson(admitted))) ||
    (decision.label === "uncertain" && !decision.reasonCodes.includes("insufficient-evidence"))
  )
    unavailable();
  if (call.requestRedacted !== null) {
    const diagnostic = call.requestRedacted;
    if (
      Object.keys(diagnostic).length !== 3 ||
      diagnostic.schemaVersion !== "np.agent-moderator-assessment-diagnostic.v1" ||
      diagnostic.requestDigest !== call.requestDigest ||
      serializeAgentCanonicalJson(
        npRequireAgentModeratorAssessmentEvidenceV1(diagnostic.assessmentEvidence),
      ) !== serializeAgentCanonicalJson(evidence)
    )
      unavailable();
  } else if (!call.diagnosticExpiresAt || call.diagnosticExpiresAt.getTime() > Date.now())
    unavailable();
  return assessment;
}

/** Records a separately labelled model judgment; never an effect, approval, verdict replacement or notification. */
export function createAgentIncidentAssessmentServiceV1(options: {
  source: NpAgentModeratorAssessmentSourceV1;
  incidents: NpAgentIncidentServiceV1;
}): NpAgentIncidentAssessmentServiceV1 {
  if (!npIsAgentModeratorAssessmentSourceV1(options.source))
    throw new Error("Framework assessment source is required.");
  return Object.freeze({
    async record(context, input) {
      npAssertAgentPreviewEffectsAllowed();
      npAssertAgentModeratorAssessmentContextV1(context);
      canonicalBodyUuid(input.providerCallId, "moderator.assessment.providerCallId");
      await npWithAgentRuntimeControlTransactionV1(context.siteId, async () => {}, context.db);
      const [call] = await context.db
        .select()
        .from(npAgentProviderCalls)
        .where(
          and(
            eq(npAgentProviderCalls.siteId, context.siteId),
            eq(npAgentProviderCalls.runId, context.run.id),
            eq(npAgentProviderCalls.id, input.providerCallId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !call ||
        call.recipeId !== context.run.recipeId ||
        call.recipeVersion !== context.run.recipeVersion ||
        call.recipeFingerprint !== context.run.recipeFingerprint ||
        call.instructionTemplateId !== context.run.instructionTemplateId ||
        call.instructionTemplateVersion !== context.run.instructionTemplateVersion ||
        call.instructionDigest !== context.run.instructionDigest ||
        call.responseSchemaDigest !== context.run.responseSchemaDigest ||
        call.connectionId !== context.run.connectionId ||
        call.connectionConfigSnapshotId !== context.run.connectionConfigSnapshotId ||
        call.providerDataClassCeiling !== "sensitive-approved" ||
        call.requestDataClass !== "sensitive-approved"
      )
        unavailable();
      const output = await npRequireAgentRuntimeProviderDecisionV1(call);
      if (output.task !== "moderation-classification" || output.decision.kind !== "classification")
        unavailable();
      const decision = output.decision;
      const diagnostic = call.requestRedacted;
      if (
        !diagnostic ||
        Object.keys(diagnostic).length !== 3 ||
        diagnostic.schemaVersion !== "np.agent-moderator-assessment-diagnostic.v1" ||
        diagnostic.requestDigest !== call.requestDigest ||
        !Object.hasOwn(diagnostic, "assessmentEvidence")
      )
        unavailable();
      const metadata = npRequireAgentModeratorAssessmentEvidenceV1(diagnostic.assessmentEvidence);
      npRequireAgentModeratorAssessmentSourceProofV1(call, metadata);
      const admittedDigests = [
        ...new Set(metadata.sources.map((source) => source.excerptDigest)),
      ].sort();
      if (
        decision.evidenceDigests.some((entry) => !admittedDigests.includes(entry)) ||
        (decision.label !== "uncertain" &&
          (metadata.truncated ||
            metadata.incident === null ||
            admittedDigests.length === 0 ||
            serializeAgentCanonicalJson(decision.evidenceDigests) !==
              serializeAgentCanonicalJson(admittedDigests))) ||
        (decision.label === "uncertain" && !decision.reasonCodes.includes("insufficient-evidence"))
      )
        unavailable();
      if (metadata.incident === null) return { recorded: false, replayed: false, assessment: null };
      const readContext = npAgentModeratorAssessmentIncidentContextV1(context);
      await options.incidents.get({ incidentId: metadata.incident.id }, readContext);
      const provenance = {
        runId: context.run.id,
        providerCallId: call.id,
        provider: call.provider,
        model: call.model,
        recipeFingerprint: call.recipeFingerprint,
        instructionDigest: call.instructionDigest,
        policyDigests: [
          ...new Set(npRuntimeRunAdmissionBodyV1(context.run).policyRefs.map((ref) => ref.digest)),
        ].sort(),
        requestDigest: call.requestDigest,
        responseDigest: call.responseDigest!,
        sourceDigest: npDigestAgentModeratorAssessmentSourcesV1(metadata),
      };
      const assessment = npRequireAgentModeratorAssessmentV1({
        schemaVersion: "np.agent-moderator-assessment.v1",
        incidentId: metadata.incident.id,
        incidentVersion: metadata.incident.versionNumber,
        observedAt: metadata.observedAt,
        label: decision.label,
        confidenceBasisPoints: decision.confidenceBasisPoints,
        reasonCodes: decision.reasonCodes,
        evidenceDigests: decision.evidenceDigests,
        summary: decision.summary,
        evidence: metadata,
        provenance,
      });
      const existing = await context.db
        .select()
        .from(npAgentIncidentTimeline)
        .where(
          and(
            eq(npAgentIncidentTimeline.siteId, context.siteId),
            eq(npAgentIncidentTimeline.incidentId, metadata.incident.id),
            eq(npAgentIncidentTimeline.providerCallId, call.id),
            eq(npAgentIncidentTimeline.kind, "agent_assessment"),
          ),
        )
        .limit(2);
      if (existing.length) {
        if (
          existing.length !== 1 ||
          existing[0].runId !== context.run.id ||
          existing[0].sourceId !== context.run.agentId ||
          existing[0].sourceKind !== "agent" ||
          existing[0].sourceFingerprint !== call.responseDigest ||
          serializeAgentCanonicalJson(npRequireAgentModeratorAssessmentV1(existing[0].details)) !==
            serializeAgentCanonicalJson(assessment)
        )
          unavailable();
        // Visibility was checked above. Replay returns the immutable original
        // assessment even after its own version increment or later source edits.
        return { recorded: true, replayed: true, assessment };
      }
      // The source owner locks content parents/comments before this Incident,
      // preserving the existing collection/moderation writer lock order.
      const current = await options.source.read(context, metadata.observedAt);
      if (serializeAgentCanonicalJson(current.metadata) !== serializeAgentCanonicalJson(metadata))
        unavailable();
      const [incident] = await context.db
        .select()
        .from(npAgentIncidents)
        .where(
          and(
            eq(npAgentIncidents.siteId, context.siteId),
            eq(npAgentIncidents.id, metadata.incident.id),
          ),
        )
        .limit(1)
        .for("update");
      if (!incident) unavailable();
      if (
        incident.versionNumber !== metadata.incident.versionNumber ||
        incident.fingerprint !== metadata.incident.fingerprint ||
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
        sourceFingerprint: call.responseDigest!,
        runId: context.run.id,
        providerCallId: call.id,
        summary: "Read-only model assessment recorded; human review remains separate.",
        details: JSON.parse(serializeAgentCanonicalJson(assessment)) as NpAgentJsonObject,
        createdAt: context.now,
      });
      return { recorded: true, replayed: false, assessment };
    },
  } satisfies NpAgentIncidentAssessmentServiceV1);
}
