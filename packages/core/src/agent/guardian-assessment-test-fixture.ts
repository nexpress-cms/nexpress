import { createHash } from "node:crypto";
import { vi } from "vitest";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npCreateAgentGuardianAssessmentRecipeDefinitionV1 } from "../agent-contract/guardian-assessment-recipe-contract.js";
import { npRequireAgentGuardianAssessmentEvidenceV1 } from "../agent-contract/guardian-assessment-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { npDigestAgentGuardianAssessmentObservationV1 } from "./guardian-assessment-proof.js";

export const guardianAssessmentAt = "2026-10-18T00:05:00.000Z";
export const guardianAssessmentUuid = (n: number) =>
  `01900000-0000-7000-8000-${n.toString().padStart(12, "0")}`;
export const guardianAssessmentHash = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(purpose).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
export function guardianAssessmentEvidenceFixture() {
  const source = {
    signalId: guardianAssessmentUuid(1),
    signalDigest: guardianAssessmentHash("signal", 1),
    fact: {
      detectorId: "guardian.login-failures" as const,
      detectorVersion: 1 as const,
      category: "authentication" as const,
      severity: "medium" as const,
      window: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: "2026-10-18T00:01:00.000Z" },
      observedCount: 5,
      audience: "staff" as const,
      routeFamily: null,
      impact: "site" as const,
    },
  };
  return npRequireAgentGuardianAssessmentEvidenceV1({
    schemaVersion: "np.agent-guardian-assessment-evidence.v1",
    recipeId: "guardian.credential-stuffing",
    observedAt: guardianAssessmentAt,
    incident: {
      id: guardianAssessmentUuid(2),
      versionNumber: 1,
      fingerprint: guardianAssessmentHash("fingerprint", 1),
    },
    truncated: false,
    sources: [
      {
        id: "guardian-assessment-000",
        ...source,
        digest: npDigestAgentGuardianAssessmentObservationV1(source),
      },
    ],
  });
}
export function guardianAssessmentManifestFixture(evidence = guardianAssessmentEvidenceFixture()) {
  const component = (id: string, kind: string, sourceDigest: string) => ({
    id,
    kind,
    sourceDigest,
    dataClass: "sensitive-approved",
    classifierId: "framework.runtime-context",
    classifierVersion: 1,
  });
  const classificationManifest: NpAgentJsonObject = {
    components: [
      component(
        "guardian-assessment",
        "server-fact",
        guardianAssessmentHash("np.agent-runtime-guardian-assessment.v1", evidence),
      ),
      ...evidence.sources.map((source) => component(source.id, "content", source.digest)),
    ],
  };
  return {
    classificationManifest,
    classificationManifestDigest: guardianAssessmentHash(
      "np.agent-runtime-classification-manifest.v1",
      classificationManifest,
    ),
  };
}
export async function guardianAssessmentContextFixture() {
  const recipe = await npCreateAgentGuardianAssessmentRecipeDefinitionV1(
    "guardian.credential-stuffing",
  );
  const evidence = guardianAssessmentEvidenceFixture();
  const rows: unknown[] = [];
  const select = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }),
      }),
    }),
  }));
  const context = {
    siteId: "default",
    now: new Date(guardianAssessmentAt),
    db: { select },
    run: {
      id: guardianAssessmentUuid(3),
      siteId: "default",
      agentId: guardianAssessmentUuid(4),
      recipeId: recipe.id,
      recipeVersion: 1,
      recipeFingerprint: guardianAssessmentHash("recipe", 1),
      instructionTemplateId: recipe.instruction!.templateId,
      instructionTemplateVersion: 1,
      instructionDigest: recipe.instruction!.digest,
      providerDataClassCeiling: "sensitive-approved",
    },
    evidence: {
      principal: {
        id: guardianAssessmentUuid(5),
        siteId: "default",
        authorityKind: "user",
        authorityUserId: guardianAssessmentUuid(6),
      },
      definition: {
        template: "guardian",
        autonomy: "observe",
        scopes: ["incident:read", "site:read"],
        capabilityModes: [
          { capabilityId: "incident.get", mode: "observe" },
          { capabilityId: "incident.list", mode: "observe" },
        ],
      },
      registry: { recipes: [recipe] },
    },
    staffUser: { id: guardianAssessmentUuid(6) },
    policy: { effective: { providerDataMaximum: "sensitive-approved" } },
    siteBudget: { incidentAnalysesPerFingerprintPerDay: 1, incidentAnalysisCooldownSeconds: 3600 },
    agentBudget: { incidentAnalysesPerFingerprintPerDay: 1, incidentAnalysisCooldownSeconds: 3600 },
  } as unknown as NpAgentRuntimeRunContextV1;
  const digest = guardianAssessmentHash("np.agent-runtime-guardian-assessment.v1", evidence);
  const request = {
    siteId: "default",
    runId: context.run.id,
    providerCallId: guardianAssessmentUuid(7),
    recipe: { id: recipe.id, version: 1, fingerprint: context.run.recipeFingerprint },
    task: "guardian-assessment",
    instruction: recipe.instruction,
    tools: [],
    trustedContext: [
      {
        id: "guardian-assessment",
        kind: "server-fact",
        digest,
        classification: { dataClass: "sensitive-approved", sourceDigest: digest },
        text: serializeAgentCanonicalJson(evidence),
      },
    ],
    sequence: 1,
    retryOfId: null,
  } as unknown as NpAgentProviderRequestCanonicalV1;
  const row = () => ({
    id: guardianAssessmentUuid(8),
    runId: guardianAssessmentUuid(9),
    agentId: guardianAssessmentUuid(10),
    recipeId: recipe.id,
    state: "succeeded",
    sequence: 1,
    retryOfId: null,
    retryable: false,
    dispatchState: "dispatched",
    createdAt: new Date(guardianAssessmentAt),
    startedAt: new Date(guardianAssessmentAt),
    requestDigest: guardianAssessmentHash("request", 1),
    templateVersion: 1,
    instructionDigest: recipe.instruction!.digest,
    ...guardianAssessmentManifestFixture(evidence),
    diagnostic: {
      schemaVersion: "np.agent-guardian-assessment-diagnostic.v1",
      requestDigest: guardianAssessmentHash("request", 1),
      assessmentEvidence: evidence,
    },
  });
  return { context, request, evidence, recipe, rows, select, row };
}
