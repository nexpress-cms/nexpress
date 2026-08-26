import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  SIGNED_32_BIT_MAXIMUM,
  cloneCanonicalRuntimeInput,
  compareCanonicalJson,
  parseAgentTargetRef,
  parseCanonicalCapabilityId,
  parseCanonicalIdentifier,
  parseCanonicalInteger,
  parseCanonicalJsonObject,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  parseCanonicalUuid,
  parseCapabilityRisk,
  parseSortedScopes,
} from "./canonical-runtime-primitives.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  type NpAgentActionCanonicalV1,
  type NpAgentActionTargetVersionFactV1,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentTargetRef,
} from "./types.js";

const PURPOSE = "np.agent-action.v1" as const;
const MAXIMUM_BODY_BYTES = npAgentCanonicalBodyMaxBytesV1[PURPOSE];
const MAXIMUM_TARGETS = 500;

export const npAgentActionCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "actionId",
  "invocationFingerprint",
  "runFingerprint",
  "sequence",
  "capabilityId",
  "capabilityContractVersion",
  "capabilityFingerprint",
  "effectProfile",
  "risk",
  "requiredScopes",
  "targetRefs",
  "targetVersionFacts",
  "input",
] as const satisfies readonly (keyof NpAgentActionCanonicalV1)[];

export const npAgentActionCanonicalExcludedKeysV1 = [
  "proposalHash",
  "inputHash",
  "resultDigest",
  "outputRedacted",
  "outputHash",
  "effectDigest",
  "targetVersionDigest",
  "verificationState",
  "verificationResultDigest",
  "verificationEvidence",
  "verifiedAt",
  "undoRef",
  "compensationResultDigest",
  "compensationEvidence",
  "compensatedAt",
  "state",
  "errorCode",
  "approvalId",
  "containmentId",
  "auditEventId",
  "startedAt",
  "finishedAt",
  "createdAt",
  "integrityKeyId",
  "integrityMac",
] as const;

export const npAgentActionEffectProfileIncludedKeysV1 = ["id", "contractVersion"] as const;
export const npAgentActionTargetVersionFactIncludedKeysV1 = [
  "targetRef",
  "versionDigest",
] as const satisfies readonly (keyof NpAgentActionTargetVersionFactV1)[];

function parseTargets(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentTargetRef[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_TARGETS, state);
  const result: NpAgentTargetRef[] = [];
  let previous: NpAgentTargetRef | undefined;
  entries.forEach((entry, index) => {
    const current = parseAgentTargetRef(entry, `${path}[${index.toString()}]`, state);
    if (previous !== undefined) {
      const order = compareCanonicalJson(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          `${path}[${index.toString()}]`,
          "must be sorted unique by RFC 8785 target bytes",
        );
      }
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseTargetFacts(
  value: unknown,
  path: string,
  targets: readonly NpAgentTargetRef[],
  state: CanonicalBodyInspectionState,
): NpAgentActionTargetVersionFactV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_TARGETS, state);
  if (entries.length !== targets.length) {
    failCanonicalBody("invalid-field", path, "must contain exactly one fact for every target");
  }
  return entries.map((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      npAgentActionTargetVersionFactIncludedKeysV1,
      npAgentActionTargetVersionFactIncludedKeysV1,
      state,
    );
    const targetRef = parseAgentTargetRef(record.targetRef, `${entryPath}.targetRef`, state);
    if (compareCanonicalJson(targetRef, targets[index]) !== 0) {
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.targetRef`,
        "must repeat the target at the same canonical ordinal",
      );
    }
    return {
      targetRef,
      versionDigest: parseCanonicalSha256(record.versionDigest, `${entryPath}.versionDigest`),
    };
  });
}

function parseActionCanonical(value: unknown): NpAgentActionCanonicalV1 {
  const path = "agent.canonical.action";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, MAXIMUM_BODY_BYTES),
    path,
    npAgentActionCanonicalIncludedKeysV1,
    npAgentActionCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }
  const effectProfile = canonicalBodyRecord(
    record.effectProfile,
    `${path}.effectProfile`,
    npAgentActionEffectProfileIncludedKeysV1,
    npAgentActionEffectProfileIncludedKeysV1,
    state,
  );
  const targetRefs = parseTargets(record.targetRefs, `${path}.targetRefs`, state);
  const result: NpAgentActionCanonicalV1 = {
    schemaVersion: PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    actionId: parseCanonicalUuid(record.actionId, `${path}.actionId`),
    invocationFingerprint: parseCanonicalSha256(
      record.invocationFingerprint,
      `${path}.invocationFingerprint`,
    ),
    runFingerprint:
      record.runFingerprint === null
        ? null
        : parseCanonicalSha256(record.runFingerprint, `${path}.runFingerprint`),
    sequence: parseCanonicalInteger(record.sequence, `${path}.sequence`, 1, SIGNED_32_BIT_MAXIMUM),
    capabilityId: parseCanonicalCapabilityId(record.capabilityId, `${path}.capabilityId`),
    capabilityContractVersion: parseCanonicalInteger(
      record.capabilityContractVersion,
      `${path}.capabilityContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    capabilityFingerprint: parseCanonicalSha256(
      record.capabilityFingerprint,
      `${path}.capabilityFingerprint`,
    ),
    effectProfile: {
      id: parseCanonicalIdentifier(effectProfile.id, `${path}.effectProfile.id`),
      contractVersion: canonicalBodyInteger(
        effectProfile.contractVersion,
        `${path}.effectProfile.contractVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
    },
    risk: parseCapabilityRisk(record.risk, `${path}.risk`),
    requiredScopes: parseSortedScopes(record.requiredScopes, `${path}.requiredScopes`, state),
    targetRefs,
    targetVersionFacts: parseTargetFacts(
      record.targetVersionFacts,
      `${path}.targetVersionFacts`,
      targetRefs,
      state,
    ),
    input: parseCanonicalJsonObject(record.input, `${path}.input`),
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentActionCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentActionCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.action", () => parseActionCanonical(value));
}

export function npRequireAgentActionCanonical(value: unknown): NpAgentActionCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentActionCanonical(value),
    "Invalid Agent action canonical body",
  );
}

export function npBuildAgentActionCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-action.v1", NpAgentActionCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentActionCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<"np.agent-action.v1", NpAgentActionCanonicalV1>;
}

export async function npDigestAgentActionCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(npBuildAgentActionCanonicalBytes(value).domainSeparatedUtf8);
}
