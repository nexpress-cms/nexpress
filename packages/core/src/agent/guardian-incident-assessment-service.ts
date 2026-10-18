import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentVersions,
} from "../db/schema/agent.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentGuardianAssessmentV1,
  npRequireAgentGuardianAssessmentEvidenceV1,
  npRequireAgentGuardianAssessmentDecisionV1,
  type NpAgentGuardianAssessmentV1,
} from "../agent-contract/guardian-assessment-contract.js";
import {
  npIsAgentGuardianAssessmentRecipeV1,
  npGuardianAssessmentCodesForRecipeV1,
} from "../agent-contract/guardian-assessment-recipe-contract.js";
import {
  npDigestAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonical,
} from "../agent-contract/canonical-recipe-registry.js";
import { npDigestAgentRunAdmissionCanonical } from "../agent-contract/canonical-run-admission.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import {
  npAssertAgentGuardianAssessmentContextV1,
  npAgentGuardianAssessmentIncidentContextV1,
} from "./guardian-assessment-context.js";
import {
  npIsAgentGuardianAssessmentSourceV1,
  type NpAgentGuardianAssessmentSourceV1,
} from "./guardian-assessment-source.js";
import {
  npDigestAgentGuardianAssessmentSourcesV1,
  npRequireAgentGuardianAssessmentSourceProofV1,
} from "./guardian-assessment-proof.js";
import type { NpAgentIncidentServiceV1 } from "./incident-service.js";
import {
  npRuntimeRunAdmissionBodyV1,
  type NpAgentRuntimeRunContextV1,
} from "./runtime-admission.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "./runtime-provider-evidence.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";

type Db = ReturnType<typeof getDb>;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_ASSESSMENT_UNAVAILABLE",
    409,
    "Guardian assessment evidence is unavailable.",
  );
}
export interface NpAgentGuardianIncidentAssessmentRecordResultV1 {
  recorded: boolean;
  replayed: boolean;
  assessment: NpAgentGuardianAssessmentV1 | null;
}
export interface NpAgentGuardianIncidentAssessmentServiceV1 {
  record(
    context: NpAgentRuntimeRunContextV1,
    input: { providerCallId: string },
  ): Promise<NpAgentGuardianIncidentAssessmentRecordResultV1>;
}
/** Immutable model provenance only. Caller separately owns current viewer, Incident and source ACLs. */
export async function npRequireAgentGuardianIncidentAssessmentEntryV1(
  db: Db,
  row: typeof npAgentIncidentTimeline.$inferSelect,
): Promise<NpAgentGuardianAssessmentV1> {
  const assessment = npRequireAgentGuardianAssessmentV1(row.details);
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
    run.origin !== "runtime" ||
    row.sourceId !== run.agentId ||
    call.instructionTemplateId !== "guardian.incident-assessment" ||
    call.instructionTemplateVersion !== 1 ||
    call.recipeId !== run.recipeId ||
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
    !npIsAgentGuardianAssessmentRecipeV1(recipe) ||
    (await npDigestAgentRecipeRegistryCanonical(registry, registry.recipes)) !==
      version.recipeRegistryFingerprint ||
    (await npDigestAgentRecipeRegistryCanonical(
      { ...registry, projection: "definition", recipes: [recipe!] },
      registry.recipes,
    )) !== run.recipeFingerprint
  )
    unavailable();
  const admission = npRuntimeRunAdmissionBodyV1(run);
  if ((await npDigestAgentRunAdmissionCanonical(admission)) !== run.admissionFingerprint)
    unavailable();
  const output = await npRequireAgentRuntimeProviderDecisionV1(call);
  if (output.task !== "guardian-assessment" || output.decision.kind !== "assessment") unavailable();
  const decision = npRequireAgentGuardianAssessmentDecisionV1(output.decision),
    { evidence, provenance } = assessment;
  npRequireAgentGuardianAssessmentSourceProofV1(call, evidence);
  if (
    evidence.recipeId !== call.recipeId ||
    provenance.provider !== call.provider ||
    provenance.model !== call.model ||
    provenance.recipeFingerprint !== call.recipeFingerprint ||
    provenance.instructionDigest !== call.instructionDigest ||
    provenance.requestDigest !== call.requestDigest ||
    provenance.responseDigest !== call.responseDigest ||
    provenance.sourceDigest !== npDigestAgentGuardianAssessmentSourcesV1(evidence) ||
    !same(
      provenance.policyDigests,
      [...new Set(admission.policyRefs.map((ref) => ref.digest))].sort(),
    ) ||
    !same(
      {
        disposition: assessment.disposition,
        confidenceBasisPoints: assessment.confidenceBasisPoints,
        assessmentCodes: assessment.assessmentCodes,
        evidenceDigests: assessment.evidenceDigests,
        summary: assessment.summary,
      },
      {
        disposition: decision.disposition,
        confidenceBasisPoints: decision.confidenceBasisPoints,
        assessmentCodes: decision.assessmentCodes,
        evidenceDigests: decision.evidenceDigests,
        summary: decision.summary,
      },
    )
  )
    unavailable();
  if (call.requestRedacted !== null) {
    const d = call.requestRedacted;
    if (
      Object.keys(d).length !== 3 ||
      d.schemaVersion !== "np.agent-guardian-assessment-diagnostic.v1" ||
      d.requestDigest !== call.requestDigest ||
      !same(npRequireAgentGuardianAssessmentEvidenceV1(d.assessmentEvidence), evidence)
    )
      unavailable();
  } else if (!call.diagnosticExpiresAt || call.diagnosticExpiresAt.getTime() > Date.now())
    unavailable();
  return assessment;
}
/** Append one labelled advisory entry, without Actions, Approvals, notifications or deterministic state changes. */
export function createAgentGuardianIncidentAssessmentServiceV1(options: {
  source: NpAgentGuardianAssessmentSourceV1;
  incidents: NpAgentIncidentServiceV1;
}): NpAgentGuardianIncidentAssessmentServiceV1 {
  if (!npIsAgentGuardianAssessmentSourceV1(options.source))
    throw new Error("Framework Guardian assessment source is required.");
  return Object.freeze({
    async record(context: NpAgentRuntimeRunContextV1, input: { providerCallId: string }) {
      npAssertAgentPreviewEffectsAllowed();
      npAssertAgentGuardianAssessmentContextV1(context);
      canonicalBodyUuid(input.providerCallId, "guardian.assessment.providerCallId");
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
        !call.responseDigest ||
        call.providerDataClassCeiling !== "sensitive-approved" ||
        call.requestDataClass !== "sensitive-approved"
      )
        unavailable();
      const output = await npRequireAgentRuntimeProviderDecisionV1(call);
      if (output.task !== "guardian-assessment" || output.decision.kind !== "assessment")
        unavailable();
      const decision = npRequireAgentGuardianAssessmentDecisionV1(output.decision),
        d = call.requestRedacted;
      if (
        !d ||
        Object.keys(d).length !== 3 ||
        d.schemaVersion !== "np.agent-guardian-assessment-diagnostic.v1" ||
        d.requestDigest !== call.requestDigest
      )
        unavailable();
      const metadata = npRequireAgentGuardianAssessmentSourceProofV1(call, d.assessmentEvidence);
      if (metadata.recipeId !== context.run.recipeId) unavailable();
      if (
        decision.assessmentCodes.some(
          (code) =>
            !npGuardianAssessmentCodesForRecipeV1(metadata.recipeId).some(
              (allowed) => allowed === code,
            ),
        )
      )
        unavailable();
      const admitted = metadata.sources.map((source) => source.digest).sort();
      if (
        decision.evidenceDigests.some((digest) => !admitted.includes(digest)) ||
        (decision.disposition !== "inconclusive" &&
          (!metadata.incident ||
            metadata.truncated ||
            !admitted.length ||
            !same(admitted, decision.evidenceDigests))) ||
        (decision.disposition === "inconclusive" &&
          !decision.assessmentCodes.includes("inconclusive"))
      )
        unavailable();
      if (!metadata.incident) return { recorded: false, replayed: false, assessment: null };
      await options.incidents.get(
        { incidentId: metadata.incident.id },
        npAgentGuardianAssessmentIncidentContextV1(context),
      );
      const assessment = npRequireAgentGuardianAssessmentV1({
        schemaVersion: "np.agent-guardian-assessment.v1",
        incidentId: metadata.incident.id,
        incidentVersion: metadata.incident.versionNumber,
        observedAt: metadata.observedAt,
        disposition: decision.disposition,
        confidenceBasisPoints: decision.confidenceBasisPoints,
        assessmentCodes: decision.assessmentCodes,
        evidenceDigests: decision.evidenceDigests,
        summary: decision.summary,
        evidence: metadata,
        provenance: {
          runId: context.run.id,
          providerCallId: call.id,
          provider: call.provider,
          model: call.model,
          recipeFingerprint: call.recipeFingerprint,
          instructionDigest: call.instructionDigest,
          policyDigests: [
            ...new Set(
              npRuntimeRunAdmissionBodyV1(context.run).policyRefs.map((ref) => ref.digest),
            ),
          ].sort(),
          requestDigest: call.requestDigest,
          responseDigest: call.responseDigest,
          sourceDigest: npDigestAgentGuardianAssessmentSourcesV1(metadata),
        },
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
          !same(
            await npRequireAgentGuardianIncidentAssessmentEntryV1(context.db, existing[0]),
            assessment,
          )
        )
          unavailable();
        return { recorded: true, replayed: true, assessment };
      }
      const current = await options.source.read(context, metadata.observedAt);
      if (!same(current.metadata, metadata)) unavailable();
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
      if (
        !incident ||
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
        sourceFingerprint: call.responseDigest,
        runId: context.run.id,
        providerCallId: call.id,
        summary: "Read-only Guardian model assessment recorded; human review remains separate.",
        details: JSON.parse(serializeAgentCanonicalJson(assessment)) as NpAgentJsonObject,
        createdAt: context.now,
      });
      return { recorded: true, replayed: false, assessment };
    },
  });
}
