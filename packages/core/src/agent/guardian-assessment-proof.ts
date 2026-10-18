import { createHash } from "node:crypto";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentGuardianAssessmentEvidenceV1,
  type NpAgentGuardianAssessmentEvidenceV1,
} from "../agent-contract/guardian-assessment-contract.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
const hash = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(purpose).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_ASSESSMENT_UNAVAILABLE",
    409,
    "Guardian assessment evidence is unavailable.",
  );
}
export function npDigestAgentGuardianAssessmentSourcesV1(
  value: NpAgentGuardianAssessmentEvidenceV1,
): string {
  return hash(
    "np.agent-guardian-assessment-sources.v1",
    npRequireAgentGuardianAssessmentEvidenceV1(value),
  );
}
export function npDigestAgentGuardianAssessmentObservationV1(
  value: Pick<
    NpAgentGuardianAssessmentEvidenceV1["sources"][number],
    "signalId" | "signalDigest" | "fact"
  >,
): string {
  return hash("np.agent-guardian-assessment-observation.v1", value);
}
/** Immutable classification metadata survives diagnostic text pruning. */
export function npRequireAgentGuardianAssessmentSourceProofV1(
  call: { classificationManifest: NpAgentJsonObject; classificationManifestDigest: string },
  value: unknown,
): NpAgentGuardianAssessmentEvidenceV1 {
  const evidence = npRequireAgentGuardianAssessmentEvidenceV1(value);
  const manifest = call.classificationManifest;
  if (
    Object.keys(manifest).length !== 1 ||
    !Array.isArray(manifest.components) ||
    manifest.components.length > 100 ||
    hash("np.agent-runtime-classification-manifest.v1", manifest) !==
      call.classificationManifestDigest
  )
    unavailable();
  const components = manifest.components;
  const valid = (v: unknown, id: string, kind: string, digest: string) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const row = v as Record<string, unknown>;
    return (
      row.id === id &&
      row.kind === kind &&
      row.sourceDigest === digest &&
      row.dataClass === "sensitive-approved" &&
      row.classifierId === "framework.runtime-context" &&
      row.classifierVersion === 1
    );
  };
  const metadata = components.filter(
    (v) => v && typeof v === "object" && !Array.isArray(v) && v.id === "guardian-assessment",
  );
  if (
    metadata.length !== 1 ||
    !valid(
      metadata[0],
      "guardian-assessment",
      "server-fact",
      hash("np.agent-runtime-guardian-assessment.v1", evidence),
    )
  )
    unavailable();
  const observations = components.filter(
    (v) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof v.id === "string" &&
      v.id.startsWith("guardian-assessment-"),
  );
  if (observations.length !== evidence.sources.length) unavailable();
  for (const source of evidence.sources) {
    const { signalId, signalDigest, fact } = source;
    if (
      npDigestAgentGuardianAssessmentObservationV1({ signalId, signalDigest, fact }) !==
        source.digest ||
      observations.filter((v) => valid(v, source.id, "content", source.digest)).length !== 1
    )
      unavailable();
  }
  return evidence;
}
