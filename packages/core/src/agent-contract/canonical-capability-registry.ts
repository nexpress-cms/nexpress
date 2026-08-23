import {
  NpAgentContractError,
  npAgentContractLimits,
  npAnalyzeAgentCapabilityDescriptor,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { npAnalyzeAgentEffectProfileCanonical } from "./canonical-bodies.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
  type AgentCanonicalJsonInspectionLimits,
} from "./canonical-foundation.js";
import type {
  NpAgentCanonicalBodyBytesV1,
  NpAgentCapabilityDescriptor,
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentCapabilityRegistryEntryCanonicalV1,
  NpAgentContractIssue,
  NpAgentContractResult,
  NpAgentEffectProfileCanonicalV1,
} from "./types.js";
import { npAgentCanonicalBodyMaxBytesV1 } from "./types.js";

const PURPOSE = "np.agent-capability-registry.v1" as const;
const PROJECTIONS = new Set<string>(["definition", "registry"]);
const MAXIMUM_EFFECT_PROFILES_PER_CAPABILITY = 16;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;

const STRUCTURAL_LIMITS: AgentCanonicalJsonInspectionLimits = {
  maximumDepth: npAgentContractLimits.jsonSchemaDepth + 16,
  maximumNodes:
    npAgentContractLimits.coreCapabilityDescriptors * npAgentContractLimits.jsonSchemaNodes * 2 +
    10_000,
  maximumArrayItems: npAgentContractLimits.jsonSchemaMaxItems,
  maximumObjectProperties: npAgentContractLimits.jsonSchemaObjectProperties,
  maximumStringCharacters: npAgentContractLimits.jsonSchemaMaxStringCharacters,
  maximumCanonicalBytes: npAgentCanonicalBodyMaxBytesV1[PURPOSE],
};

export const npAgentCapabilityRegistryCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "capabilities",
] as const satisfies readonly (keyof NpAgentCapabilityRegistryCanonicalV1)[];

export const npAgentCapabilityRegistryCanonicalExcludedKeysV1 = [
  "registryFingerprint",
  "capabilityFingerprint",
  "effectFingerprint",
  "registeredAt",
  "sourceFunction",
  "parseInput",
  "parseOutput",
  "deriveRequirements",
  "resolveEffectProfile",
  "execute",
  "verify",
  "deriveUndo",
  "compensate",
] as const;

export const npAgentCapabilityRegistryCanonicalEntryIncludedKeysV1 = [
  "descriptor",
  "implementationVersion",
  "effectProfiles",
] as const satisfies readonly (keyof NpAgentCapabilityRegistryEntryCanonicalV1)[];

export const npAgentCapabilityRegistryCanonicalDefinitionIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "capabilities",
] as const satisfies readonly (keyof NpAgentCapabilityRegistryCanonicalV1)[];

export const npAgentCapabilityRegistryCanonicalRegistryIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "capabilities",
] as const satisfies readonly (keyof NpAgentCapabilityRegistryCanonicalV1)[];

export const npAgentCapabilityRegistryCanonicalContextualSiblingPairsV1 = [
  {
    sourceCaseId: "np.agent-capability-registry.v1.projection.definition",
    siblingCaseId: "np.agent-capability-registry.v1.projection.registry",
    verification: "registry-completeness",
  },
  {
    sourceCaseId: "np.agent-capability-registry.v1.projection.registry",
    siblingCaseId: "np.agent-capability-registry.v1.projection.definition",
    verification: "registry-completeness",
  },
] as const;

export const npAgentCapabilityRegistryCanonicalDiscriminatorCasesV1 = [
  {
    caseId: "np.agent-capability-registry.v1.projection.definition",
    concreteDiscriminatorPath: "/projection",
    acceptedValue: "definition",
  },
  {
    caseId: "np.agent-capability-registry.v1.projection.registry",
    concreteDiscriminatorPath: "/projection",
    acceptedValue: "registry",
  },
] as const;

export const npAgentCapabilityRegistryCanonicalProjectionFixtureV1 = {
  purpose: PURPOSE,
  fixtureId: "capability-registry-projection-v1",
  definitionCaseId: "np.agent-capability-registry.v1.projection.definition",
  registryCaseId: "np.agent-capability-registry.v1.projection.registry",
  singletonDefinitionVectorId: "capability-registry-definition-singleton-v1",
  singletonRegistryVectorId: "capability-registry-registry-singleton-v1",
  multiMemberDefinitionVectorId: "capability-registry-definition-member-multi-v1",
  multiRegistryVectorId: "capability-registry-registry-multi-v1",
  expectedIncompleteRegistryErrorCode: "AGENT_CANONICAL_INCOMPLETE_REGISTRY",
} as const;

export const npAgentCanonicalIncompleteRegistryErrorCode =
  "AGENT_CANONICAL_INCOMPLETE_REGISTRY" as const;

export class NpAgentCanonicalIncompleteRegistryError extends Error {
  readonly code = npAgentCanonicalIncompleteRegistryErrorCode;
  readonly purpose = PURPOSE;

  constructor(message: string) {
    super(message);
    this.name = "NpAgentCanonicalIncompleteRegistryError";
  }
}

function remapIssues(
  issues: readonly NpAgentContractIssue[],
  sourceRoot: string,
  targetRoot: string,
): NpAgentContractIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path.startsWith(sourceRoot)
      ? `${targetRoot}${issue.path.slice(sourceRoot.length)}`
      : targetRoot,
  }));
}

function requireNestedResult<T>(
  result: NpAgentContractResult<T>,
  sourceRoot: string,
  targetRoot: string,
): T {
  if (result.ok) return result.value;
  throw new NpAgentContractError(
    "Invalid Agent capability-registry canonical body",
    remapIssues(result.issues, sourceRoot, targetRoot),
  );
}

function cloneInput(value: unknown): unknown {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(
      value,
      "agent.canonical.capabilityRegistry",
      STRUCTURAL_LIMITS,
    ),
    "Invalid Agent capability-registry canonical body",
  );
}

function parseDescriptor(value: unknown, path: string): NpAgentCapabilityDescriptor {
  return requireNestedResult(npAnalyzeAgentCapabilityDescriptor(value), "agent.capability", path);
}

function parseEffectProfile(value: unknown, path: string): NpAgentEffectProfileCanonicalV1 {
  return requireNestedResult(
    npAnalyzeAgentEffectProfileCanonical(value),
    "agent.canonical.effectProfile",
    path,
  );
}

function requireEqualBinding(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must equal descriptor value ${JSON.stringify(expected)}`,
    );
  }
}

function validateEffectProfileBinding(
  descriptor: NpAgentCapabilityDescriptor,
  implementationVersion: number,
  effectProfile: NpAgentEffectProfileCanonicalV1,
  index: number,
  path: string,
): void {
  const descriptorProfile = descriptor.effectProfiles[index];
  if (!descriptorProfile) {
    failCanonicalBody("invalid-field", path, "does not have a matching descriptor effect profile");
  }

  requireEqualBinding(effectProfile.capabilityId, descriptor.id, `${path}.capabilityId`);
  requireEqualBinding(
    effectProfile.capabilityContractVersion,
    descriptor.contractVersion,
    `${path}.capabilityContractVersion`,
  );
  requireEqualBinding(
    effectProfile.implementationVersion,
    implementationVersion,
    `${path}.implementationVersion`,
  );
  requireEqualBinding(effectProfile.profileId, descriptorProfile.id, `${path}.profileId`);
  requireEqualBinding(effectProfile.kind, descriptorProfile.kind, `${path}.kind`);
  requireEqualBinding(
    effectProfile.reversibility,
    descriptorProfile.reversibility,
    `${path}.reversibility`,
  );
  requireEqualBinding(
    effectProfile.minimumGatewayExposure,
    descriptorProfile.minimumGatewayExposure,
    `${path}.minimumGatewayExposure`,
  );
  requireEqualBinding(effectProfile.verifierId, descriptorProfile.verifierId, `${path}.verifierId`);
  requireEqualBinding(
    effectProfile.compensatorId,
    descriptorProfile.compensatorId,
    `${path}.compensatorId`,
  );
}

function parseCapabilityEntry(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentCapabilityRegistryEntryCanonicalV1 {
  const entry = canonicalBodyRecord(
    value,
    path,
    npAgentCapabilityRegistryCanonicalEntryIncludedKeysV1,
    npAgentCapabilityRegistryCanonicalEntryIncludedKeysV1,
    state,
  );
  const descriptor = parseDescriptor(entry.descriptor, `${path}.descriptor`);
  const implementationVersion = canonicalBodyInteger(
    entry.implementationVersion,
    `${path}.implementationVersion`,
    1,
    SIGNED_32_BIT_MAXIMUM,
  );
  const effectProfileValues = canonicalBodyArray(
    entry.effectProfiles,
    `${path}.effectProfiles`,
    MAXIMUM_EFFECT_PROFILES_PER_CAPABILITY,
    state,
  );
  if (effectProfileValues.length === 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.effectProfiles`,
      "must contain at least one effect profile",
    );
  }
  const effectProfiles = effectProfileValues.map((effectProfile, index) =>
    parseEffectProfile(effectProfile, `${path}.effectProfiles[${index.toString()}]`),
  );

  if (effectProfiles.length !== descriptor.effectProfiles.length) {
    failCanonicalBody(
      "invalid-field",
      `${path}.effectProfiles`,
      "must exactly cover the descriptor effect profiles",
    );
  }

  let previousProfileId: string | undefined;
  effectProfiles.forEach((effectProfile, index) => {
    if (previousProfileId !== undefined && effectProfile.profileId <= previousProfileId) {
      failCanonicalBody(
        effectProfile.profileId === previousProfileId ? "duplicate" : "order",
        `${path}.effectProfiles[${index.toString()}].profileId`,
        "must be sorted by unique profileId values",
      );
    }
    previousProfileId = effectProfile.profileId;
  });
  effectProfiles.forEach((effectProfile, index) => {
    validateEffectProfileBinding(
      descriptor,
      implementationVersion,
      effectProfile,
      index,
      `${path}.effectProfiles[${index.toString()}]`,
    );
  });

  return { descriptor, implementationVersion, effectProfiles };
}

function parseCapabilityRegistryCanonical(value: unknown): NpAgentCapabilityRegistryCanonicalV1 {
  const path = "agent.canonical.capabilityRegistry";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const body = canonicalBodyRecord(
    cloneInput(value),
    path,
    npAgentCapabilityRegistryCanonicalIncludedKeysV1,
    npAgentCapabilityRegistryCanonicalIncludedKeysV1,
    state,
  );
  if (body.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }
  const projection = canonicalBodyEnum<"definition" | "registry">(
    body.projection,
    `${path}.projection`,
    PROJECTIONS,
  );
  const capabilityValues = canonicalBodyArray(
    body.capabilities,
    `${path}.capabilities`,
    npAgentContractLimits.coreCapabilityDescriptors,
    state,
  );
  if (capabilityValues.length === 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.capabilities`,
      "must contain at least one capability",
    );
  }
  if (projection === "definition" && capabilityValues.length !== 1) {
    failCanonicalBody(
      "invalid-field",
      `${path}.capabilities`,
      "definition projection must contain exactly one capability",
    );
  }

  const capabilities = capabilityValues.map((capability, index) =>
    parseCapabilityEntry(capability, `${path}.capabilities[${index.toString()}]`, state),
  );
  let previousCapabilityId: string | undefined;
  capabilities.forEach((capability, index) => {
    const capabilityId = capability.descriptor.id;
    if (previousCapabilityId !== undefined && capabilityId <= previousCapabilityId) {
      failCanonicalBody(
        capabilityId === previousCapabilityId ? "duplicate" : "order",
        `${path}.capabilities[${index.toString()}].descriptor.id`,
        "must be sorted by unique descriptor id values",
      );
    }
    previousCapabilityId = capabilityId;
  });

  const result: NpAgentCapabilityRegistryCanonicalV1 = {
    schemaVersion: PURPOSE,
    projection,
    capabilities,
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentCapabilityRegistryCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentCapabilityRegistryCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.capabilityRegistry", () =>
    parseCapabilityRegistryCanonical(value),
  );
}

export function npRequireAgentCapabilityRegistryCanonical(
  value: unknown,
): NpAgentCapabilityRegistryCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentCapabilityRegistryCanonical(value),
    "Invalid Agent capability-registry canonical body",
  );
}

function parseInstalledCapabilities(
  installedCapabilities: unknown,
): NpAgentCapabilityRegistryCanonicalV1 {
  return parseCapabilityRegistryCanonical({
    schemaVersion: PURPOSE,
    projection: "registry",
    capabilities: installedCapabilities,
  });
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
}

export function npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(
  value: unknown,
  installedCapabilities: unknown,
): NpAgentCapabilityRegistryCanonicalV1 {
  const body = parseCapabilityRegistryCanonical(value);
  const installedRegistry = parseInstalledCapabilities(installedCapabilities);
  const isComplete =
    body.projection === "registry"
      ? sameCanonicalValue(body.capabilities, installedRegistry.capabilities)
      : installedRegistry.capabilities.some(
          (installedCapability) =>
            installedCapability.descriptor.id === body.capabilities[0]?.descriptor.id &&
            sameCanonicalValue(installedCapability, body.capabilities[0]),
        );

  if (!isComplete) {
    throw new NpAgentCanonicalIncompleteRegistryError(
      body.projection === "registry"
        ? "Registry projection does not exactly match the installed capability snapshot"
        : "Definition projection is not an exact member of the installed capability snapshot",
    );
  }
  return body;
}

export function npBuildAgentCapabilityRegistryCanonicalBytes(
  value: unknown,
  installedCapabilities: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-capability-registry.v1",
  NpAgentCapabilityRegistryCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(value, installedCapabilities),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-capability-registry.v1",
    NpAgentCapabilityRegistryCanonicalV1
  >;
}

export async function npDigestAgentCapabilityRegistryCanonical(
  value: unknown,
  installedCapabilities: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentCapabilityRegistryCanonicalBytes(value, installedCapabilities).domainSeparatedUtf8,
  );
}
