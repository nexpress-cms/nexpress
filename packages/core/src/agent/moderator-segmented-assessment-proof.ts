import { createHash } from "node:crypto";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV2,
  type NpAgentModeratorAssessmentEvidenceV2,
} from "../agent-contract/moderator-segmented-assessment-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type { npAgentProviderCalls } from "../db/schema/agent.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "./runtime-provider-evidence.js";
export function npDigestAgentModeratorSegmentedEvidenceV2(purpose: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(`${purpose}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
export function npModeratorSegmentedAssessmentUnavailableV2(): never {
  throw new NpAgentGatewayError(
    "MODERATOR_ASSESSMENT_UNAVAILABLE",
    409,
    "Segmented Moderator assessment evidence is unavailable.",
  );
}
export function npRequireAgentModeratorSegmentedSourceProofV2(
  call: { classificationManifest: NpAgentJsonObject; classificationManifestDigest: string },
  value: unknown,
): NpAgentModeratorAssessmentEvidenceV2 {
  const metadata = npRequireAgentModeratorAssessmentEvidenceV2(value);
  const manifest = call.classificationManifest;
  if (
    Object.keys(manifest).length !== 1 ||
    !Array.isArray(manifest.components) ||
    manifest.components.length > 100 ||
    npDigestAgentModeratorSegmentedEvidenceV2(
      "np.agent-runtime-classification-manifest.v1",
      manifest,
    ) !== call.classificationManifestDigest
  )
    npModeratorSegmentedAssessmentUnavailableV2();
  const components = manifest.components.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.kind !== "string"
    )
      return npModeratorSegmentedAssessmentUnavailableV2();
    return { ...entry, id: entry.id, kind: entry.kind };
  });
  if (new Set(components.map((entry) => `${entry.kind}:${entry.id}`)).size !== components.length)
    npModeratorSegmentedAssessmentUnavailableV2();
  const valid = (entry: NpAgentJsonObject, kind: string, digest: string) =>
    entry.kind === kind &&
    entry.sourceDigest === digest &&
    entry.dataClass === "sensitive-approved" &&
    entry.classifierId === "framework.runtime-context" &&
    entry.classifierVersion === 1;
  const facts = components.filter((entry) => entry.id === "moderator-assessment");
  const excerpts = components.filter((entry) => entry.id.startsWith("moderator-assessment-"));
  if (
    facts.length !== 1 ||
    !valid(
      facts[0],
      "server-fact",
      npDigestAgentModeratorSegmentedEvidenceV2(
        "np.agent-runtime-moderator-assessment.v1",
        metadata,
      ),
    ) ||
    excerpts.length !== metadata.sources.length ||
    metadata.sources.some((source) => {
      const matches = excerpts.filter((entry) => entry.id === source.id);
      return matches.length !== 1 || !valid(matches[0], "content", source.excerptDigest);
    })
  )
    npModeratorSegmentedAssessmentUnavailableV2();
  if (metadata.incident && !metadata.truncated) {
    const expectedCount = Math.min(
      10,
      Math.max(0, Math.min(metadata.manifest.targetCount, 1000) - metadata.segmentIndex * 10),
    );
    const projected = metadata.sources.map(({ id: _id, ...source }) => ({
      ...source,
      truncated: false,
    }));
    if (
      metadata.sources.length !== expectedCount ||
      npDigestAgentModeratorSegmentedEvidenceV2(
        "np.agent-moderator-segment-targets.v2",
        projected,
      ) !== metadata.manifest.segmentDigests[metadata.segmentIndex]
    )
      npModeratorSegmentedAssessmentUnavailableV2();
  }
  return metadata;
}
export function npReadAgentModeratorSegmentCallEvidenceV2(
  call: typeof npAgentProviderCalls.$inferSelect,
): NpAgentModeratorAssessmentEvidenceV2 {
  const diagnostic = call.requestRedacted;
  if (
    call.instructionTemplateId !== "moderator.semantic-assessment" ||
    call.instructionTemplateVersion !== 2 ||
    !diagnostic ||
    Object.keys(diagnostic).length !== 3 ||
    diagnostic.schemaVersion !== "np.agent-moderator-assessment-diagnostic.v2" ||
    diagnostic.requestDigest !== call.requestDigest
  )
    npModeratorSegmentedAssessmentUnavailableV2();
  return npRequireAgentModeratorSegmentedSourceProofV2(call, diagnostic.assessmentEvidence);
}
export async function npRequireAgentModeratorSegmentDecisionV2(
  call: typeof npAgentProviderCalls.$inferSelect,
  evidence: NpAgentModeratorAssessmentEvidenceV2,
) {
  const output = await npRequireAgentRuntimeProviderDecisionV1(call);
  if (output.task !== "moderation-classification" || output.decision.kind !== "classification")
    npModeratorSegmentedAssessmentUnavailableV2();
  const decision = output.decision;
  const admitted = [...new Set(evidence.sources.map((source) => source.excerptDigest))].sort();
  if (
    decision.evidenceDigests.some((digest) => !admitted.includes(digest)) ||
    (decision.label !== "uncertain" &&
      (evidence.truncated ||
        !evidence.incident ||
        admitted.length === 0 ||
        serializeAgentCanonicalJson(decision.evidenceDigests) !==
          serializeAgentCanonicalJson(admitted))) ||
    (decision.label === "uncertain" && !decision.reasonCodes.includes("insufficient-evidence"))
  )
    npModeratorSegmentedAssessmentUnavailableV2();
  return decision;
}
/** Existing call rows form the durable checkpoint. Never infer a successful missing segment. */
export async function npReadAgentModeratorSegmentProgressV2(
  calls: (typeof npAgentProviderCalls.$inferSelect)[],
) {
  let anchor: NpAgentModeratorAssessmentEvidenceV2 | undefined;
  const completed: {
    call: typeof npAgentProviderCalls.$inferSelect;
    evidence: NpAgentModeratorAssessmentEvidenceV2;
    decision: Awaited<ReturnType<typeof npRequireAgentModeratorSegmentDecisionV2>>;
  }[] = [];
  const coveredTargets = new Set<string>();
  let previous: typeof npAgentProviderCalls.$inferSelect | undefined;
  let previousEvidence: NpAgentModeratorAssessmentEvidenceV2 | undefined;
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index];
    const evidence = npReadAgentModeratorSegmentCallEvidenceV2(call);
    anchor ??= evidence;
    if (
      call.sequence !== index + 1 ||
      call.runId !== calls[0].runId ||
      call.recipeFingerprint !== calls[0].recipeFingerprint ||
      call.instructionDigest !== calls[0].instructionDigest ||
      call.responseSchemaDigest !== calls[0].responseSchemaDigest ||
      evidence.segmentIndex !== completed.length ||
      serializeAgentCanonicalJson({
        observedAt: evidence.observedAt,
        incident: evidence.incident,
        manifest: evidence.manifest,
      }) !==
        serializeAgentCanonicalJson({
          observedAt: anchor.observedAt,
          incident: anchor.incident,
          manifest: anchor.manifest,
        })
    )
      npModeratorSegmentedAssessmentUnavailableV2();
    if (previous && previous.state !== "succeeded") {
      if (
        previous.state !== "failed" ||
        !previous.retryable ||
        !["not-dispatched", "dispatched"].includes(previous.dispatchState) ||
        call.retryOfId !== previous.id ||
        serializeAgentCanonicalJson(previousEvidence) !== serializeAgentCanonicalJson(evidence)
      )
        npModeratorSegmentedAssessmentUnavailableV2();
    } else if (call.retryOfId !== null) npModeratorSegmentedAssessmentUnavailableV2();
    if (call.state === "succeeded") {
      for (const source of evidence.sources) {
        const key = serializeAgentCanonicalJson(source.subject);
        if (coveredTargets.has(key)) npModeratorSegmentedAssessmentUnavailableV2();
        coveredTargets.add(key);
      }
      completed.push({
        call,
        evidence,
        decision: await npRequireAgentModeratorSegmentDecisionV2(call, evidence),
      });
    } else if (index !== calls.length - 1 && call.state !== "failed")
      npModeratorSegmentedAssessmentUnavailableV2();
    previous = call;
    previousEvidence = evidence;
  }
  if (anchor && completed.length > anchor.manifest.segmentCount)
    npModeratorSegmentedAssessmentUnavailableV2();
  return {
    anchor,
    completed,
    latest: previous,
    latestEvidence: previousEvidence,
    nextIndex: completed.length,
  };
}
