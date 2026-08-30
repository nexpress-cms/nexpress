import {
  npAgentReadCapabilityDescriptorsV1,
  npAgentReadCapabilityIdsV1,
  npAgentScopes,
  npDigestAgentCapabilityRegistryCanonical,
  npRequireAgentCapabilityRegistryCanonical,
  npRequireAgentReadCapabilityInputV1,
  npRequireAgentReadCapabilityOutputV1,
  type NpAgentCapabilityRegistryCanonicalV1,
  type NpAgentCapabilityRegistryEntryCanonicalV1,
  type NpAgentCapabilityRisk,
  type NpAgentReadCapabilityIdV1,
  type NpAgentReadCapabilityInputMapV1,
  type NpAgentReadCapabilityOutputMapV1,
  type NpAgentScope,
  type NpAgentTargetRef,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";

export interface NpAgentResolvedGatewayPrincipalV1 {
  kind: "service" | "oauth-user";
  principalId: string;
  siteId: string;
  authority: { kind: "user"; userId: string } | { kind: "deployment"; policyId: string };
  credentialId: string;
  gatewayExposureCeiling: "read" | "propose" | "approved-execute";
  scopes: readonly NpAgentScope[];
}

export interface NpAgentReadRequirementContextV1 {
  siteId: string;
  principal: NpAgentResolvedGatewayPrincipalV1;
  requestedAt: string;
}

export interface NpAgentReadDerivedRequirementsV1 {
  additionalScopes: NpAgentScope[];
  targetRefs: NpAgentTargetRef[];
  riskFloor: NpAgentCapabilityRisk;
  approvalFloor: "none";
}

export interface NpAgentReadCapabilityContextV1 extends NpAgentReadRequirementContextV1 {
  invocationId: string;
  idempotencyKey: null;
  abortSignal: AbortSignal;
}

export interface NpAgentReadExecutionResultV1<C extends NpAgentReadCapabilityIdV1> {
  kind: "completed-read";
  output: NpAgentReadCapabilityOutputMapV1[C];
}

export interface NpAgentReadCapabilityDefinitionV1<C extends NpAgentReadCapabilityIdV1> {
  descriptor: (typeof npAgentReadCapabilityDescriptorsV1)[C];
  implementationVersion: number;
  effectContracts: {
    "domain.read": {
      profileId: "domain.read";
      kind: "read";
      effectContractVersion: number;
    };
  };
  resolveEffectProfile(input: NpAgentReadCapabilityInputMapV1[C]): "domain.read";
  parseInput(value: unknown): NpAgentReadCapabilityInputMapV1[C];
  parseOutput(value: unknown): NpAgentReadCapabilityOutputMapV1[C];
  deriveRequirements?(
    input: NpAgentReadCapabilityInputMapV1[C],
    context: NpAgentReadRequirementContextV1,
  ): NpAgentReadDerivedRequirementsV1 | Promise<NpAgentReadDerivedRequirementsV1>;
  execute(
    input: NpAgentReadCapabilityInputMapV1[C],
    context: NpAgentReadCapabilityContextV1,
  ): NpAgentReadExecutionResultV1<C> | Promise<NpAgentReadExecutionResultV1<C>>;
}

export type NpAgentAnyReadCapabilityDefinitionV1 = {
  [C in NpAgentReadCapabilityIdV1]: NpAgentReadCapabilityDefinitionV1<C>;
}[NpAgentReadCapabilityIdV1];

export interface NpAgentReadCapabilityRegistryEntryV1<C extends NpAgentReadCapabilityIdV1> {
  definition: NpAgentReadCapabilityDefinitionV1<C>;
  canonical: NpAgentCapabilityRegistryEntryCanonicalV1;
  definitionCanonical: NpAgentCapabilityRegistryCanonicalV1;
  capabilityFingerprint: `cj1:sha256:${string}`;
}

export interface NpAgentReadCapabilityRegistryV1 {
  ids: readonly NpAgentReadCapabilityIdV1[];
  canonical: NpAgentCapabilityRegistryCanonicalV1;
  registryFingerprint: `cj1:sha256:${string}`;
  get<C extends NpAgentReadCapabilityIdV1>(id: C): NpAgentReadCapabilityRegistryEntryV1<C>;
}

export class NpAgentCapabilityRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NpAgentCapabilityRegistryError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalEntry(
  definition: NpAgentAnyReadCapabilityDefinitionV1,
): NpAgentCapabilityRegistryEntryCanonicalV1 {
  if (
    !Number.isSafeInteger(definition.implementationVersion) ||
    definition.implementationVersion < 1
  ) {
    throw new NpAgentCapabilityRegistryError("Capability implementation version must be positive.");
  }
  if (!npAgentReadCapabilityIdsV1.includes(definition.descriptor.id as NpAgentReadCapabilityIdV1)) {
    throw new NpAgentCapabilityRegistryError(
      `Capability ${JSON.stringify(definition.descriptor.id)} is not in the installed read inventory.`,
    );
  }
  const expectedDescriptor =
    npAgentReadCapabilityDescriptorsV1[definition.descriptor.id as NpAgentReadCapabilityIdV1];
  if (
    expectedDescriptor === undefined ||
    serializeAgentCanonicalJson(definition.descriptor) !==
      serializeAgentCanonicalJson(expectedDescriptor)
  ) {
    throw new NpAgentCapabilityRegistryError(
      `Capability ${JSON.stringify(definition.descriptor.id)} does not match its locked descriptor.`,
    );
  }
  const effect = definition.effectContracts["domain.read"];
  const descriptorEffect = definition.descriptor.effectProfiles[0];
  if (
    Object.keys(definition.effectContracts).length !== 1 ||
    effect.profileId !== "domain.read" ||
    effect.kind !== "read" ||
    !Number.isSafeInteger(effect.effectContractVersion) ||
    effect.effectContractVersion < 1 ||
    descriptorEffect?.id !== effect.profileId ||
    descriptorEffect.kind !== effect.kind ||
    descriptorEffect.reversibility !== "none" ||
    descriptorEffect.verifierId !== null ||
    descriptorEffect.compensatorId !== null
  ) {
    throw new NpAgentCapabilityRegistryError(
      `Capability ${definition.descriptor.id} has an invalid read effect contract.`,
    );
  }
  return {
    descriptor: definition.descriptor,
    implementationVersion: definition.implementationVersion,
    effectProfiles: [
      {
        schemaVersion: "np.agent-effect-profile.v1",
        capabilityId: definition.descriptor.id,
        capabilityContractVersion: definition.descriptor.contractVersion,
        implementationVersion: definition.implementationVersion,
        profileId: effect.profileId,
        kind: effect.kind,
        reversibility: "none",
        minimumGatewayExposure: descriptorEffect.minimumGatewayExposure,
        effectContractVersion: effect.effectContractVersion,
        verifierId: null,
        compensatorId: null,
      },
    ],
  };
}

function defaultRequirements(): NpAgentReadDerivedRequirementsV1 {
  return {
    additionalScopes: [],
    targetRefs: [],
    riskFloor: "read",
    approvalFloor: "none",
  };
}

function coreRequirements<C extends NpAgentReadCapabilityIdV1>(
  id: C,
  input: NpAgentReadCapabilityInputMapV1[C],
): NpAgentReadDerivedRequirementsV1 {
  if (id === "content.query") {
    const query = input as NpAgentReadCapabilityInputMapV1["content.query"];
    return {
      additionalScopes: query.status === "published" ? [] : ["content:draft"],
      targetRefs: [],
      riskFloor: "read",
      approvalFloor: "none",
    };
  }
  return defaultRequirements();
}

export type NpAgentReadCapabilityExecutorsV1 = {
  [C in NpAgentReadCapabilityIdV1]: (
    input: NpAgentReadCapabilityInputMapV1[C],
    context: NpAgentReadCapabilityContextV1,
  ) => NpAgentReadCapabilityOutputMapV1[C] | Promise<NpAgentReadCapabilityOutputMapV1[C]>;
};

function definition<C extends NpAgentReadCapabilityIdV1>(
  id: C,
  execute: NpAgentReadCapabilityExecutorsV1[C],
): NpAgentReadCapabilityDefinitionV1<C> {
  return {
    descriptor: npAgentReadCapabilityDescriptorsV1[id],
    implementationVersion: 1,
    effectContracts: {
      "domain.read": { profileId: "domain.read", kind: "read", effectContractVersion: 1 },
    },
    resolveEffectProfile: () => "domain.read",
    parseInput: (value) => npRequireAgentReadCapabilityInputV1(id, value),
    parseOutput: (value) => npRequireAgentReadCapabilityOutputV1(id, value),
    deriveRequirements: (input) => coreRequirements(id, input),
    execute: async (input, context) => ({
      kind: "completed-read",
      output: npRequireAgentReadCapabilityOutputV1(id, await execute(input, context)),
    }),
  };
}

export type NpAgentReadCapabilityRequirementResolversV1 = Partial<{
  [C in NpAgentReadCapabilityIdV1]: NpAgentReadCapabilityDefinitionV1<C>["deriveRequirements"];
}>;

async function mergedRequirements<C extends NpAgentReadCapabilityIdV1>(
  id: C,
  input: NpAgentReadCapabilityInputMapV1[C],
  context: NpAgentReadRequirementContextV1,
  resolver: NpAgentReadCapabilityRequirementResolversV1[C],
): Promise<NpAgentReadDerivedRequirementsV1> {
  const base = coreRequirements(id, input);
  if (!resolver) return base;
  const extension = npRequireAgentReadDerivedRequirementsV1(await resolver(input, context));
  return {
    additionalScopes: [
      ...new Set([...base.additionalScopes, ...extension.additionalScopes]),
    ].sort(),
    targetRefs: [...base.targetRefs, ...extension.targetRefs],
    riskFloor: "read",
    approvalFloor: "none",
  };
}

export async function createAgentReadCapabilityRegistryV1(
  executors: NpAgentReadCapabilityExecutorsV1,
  requirementResolvers: NpAgentReadCapabilityRequirementResolversV1 = {},
): Promise<NpAgentReadCapabilityRegistryV1> {
  const contentRequirements = requirementResolvers["content.query"];
  const schemaRequirements = requirementResolvers["schema.get"];
  const siteRequirements = requirementResolvers["site.inspect"];
  const definitions: NpAgentAnyReadCapabilityDefinitionV1[] = [
    {
      ...definition("content.query", executors["content.query"]),
      deriveRequirements: (
        input: NpAgentReadCapabilityInputMapV1["content.query"],
        context: NpAgentReadRequirementContextV1,
      ) => mergedRequirements("content.query", input, context, contentRequirements),
    },
    {
      ...definition("schema.get", executors["schema.get"]),
      deriveRequirements: (
        input: NpAgentReadCapabilityInputMapV1["schema.get"],
        context: NpAgentReadRequirementContextV1,
      ) => mergedRequirements("schema.get", input, context, schemaRequirements),
    },
    {
      ...definition("site.inspect", executors["site.inspect"]),
      deriveRequirements: (
        input: NpAgentReadCapabilityInputMapV1["site.inspect"],
        context: NpAgentReadRequirementContextV1,
      ) => mergedRequirements("site.inspect", input, context, siteRequirements),
    },
  ].map((definitionValue) => deepFreeze(definitionValue));
  const canonicalEntries = definitions.map((definitionValue) =>
    deepFreeze(canonicalEntry(definitionValue)),
  );
  const canonical = deepFreeze(
    npRequireAgentCapabilityRegistryCanonical({
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "registry",
      capabilities: canonicalEntries,
    }),
  );
  const entries = new Map<
    NpAgentReadCapabilityIdV1,
    NpAgentReadCapabilityRegistryEntryV1<NpAgentReadCapabilityIdV1>
  >();
  for (const [index, definitionValue] of definitions.entries()) {
    const entry = canonicalEntries[index];
    if (!entry) throw new NpAgentCapabilityRegistryError("Capability entry disappeared.");
    const definitionBody = {
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "definition",
      capabilities: [entry],
    };
    const capabilityFingerprint = await npDigestAgentCapabilityRegistryCanonical(
      definitionBody,
      canonicalEntries,
    );
    entries.set(
      definitionValue.descriptor.id as NpAgentReadCapabilityIdV1,
      deepFreeze({
        definition: definitionValue,
        canonical: entry,
        definitionCanonical: deepFreeze(npRequireAgentCapabilityRegistryCanonical(definitionBody)),
        capabilityFingerprint,
      }),
    );
  }
  const registryFingerprint = await npDigestAgentCapabilityRegistryCanonical(
    canonical,
    canonicalEntries,
  );
  return Object.freeze({
    ids: Object.freeze([...npAgentReadCapabilityIdsV1]),
    canonical,
    registryFingerprint,
    get<C extends NpAgentReadCapabilityIdV1>(id: C): NpAgentReadCapabilityRegistryEntryV1<C> {
      const entry = entries.get(id);
      if (!entry)
        throw new NpAgentCapabilityRegistryError(
          `Capability ${JSON.stringify(id)} is unavailable.`,
        );
      return entry as NpAgentReadCapabilityRegistryEntryV1<C>;
    },
  });
}

export function npRequireAgentReadDerivedRequirementsV1(
  value: NpAgentReadDerivedRequirementsV1,
): NpAgentReadDerivedRequirementsV1 {
  const scopes = [...value.additionalScopes].sort();
  if (
    scopes.some((scope) => !(npAgentScopes as readonly string[]).includes(scope)) ||
    scopes.some((scope, index) => scope === scopes[index - 1]) ||
    value.targetRefs.length !== 0 ||
    value.riskFloor !== "read" ||
    value.approvalFloor !== "none"
  ) {
    throw new NpAgentCapabilityRegistryError(
      "Inline read requirements must use known sorted scopes, no versioned targets, and fixed read policy.",
    );
  }
  return {
    additionalScopes: scopes,
    targetRefs: [...value.targetRefs],
    riskFloor: "read",
    approvalFloor: "none",
  };
}
