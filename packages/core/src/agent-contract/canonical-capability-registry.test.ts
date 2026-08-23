import { describe, expect, it, vi } from "vitest";

import {
  NpAgentCanonicalIncompleteRegistryError,
  NpAgentContractError,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCanonicalIncompleteRegistryErrorCode,
  npAgentCapabilityRegistryCanonicalContextualSiblingPairsV1,
  npAgentCapabilityRegistryCanonicalDefinitionIncludedKeysV1,
  npAgentCapabilityRegistryCanonicalDiscriminatorCasesV1,
  npAgentCapabilityRegistryCanonicalEntryIncludedKeysV1,
  npAgentCapabilityRegistryCanonicalExcludedKeysV1,
  npAgentCapabilityRegistryCanonicalIncludedKeysV1,
  npAgentCapabilityRegistryCanonicalProjectionFixtureV1,
  npAgentCapabilityRegistryCanonicalRegistryIncludedKeysV1,
  npAnalyzeAgentCapabilityRegistryCanonical,
  npBuildAgentCapabilityRegistryCanonicalBytes,
  npDigestAgentCapabilityRegistryCanonical,
  npRequireAgentCapabilityRegistryCanonical,
  npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities,
  type NpAgentCapabilityDescriptor,
  type NpAgentCapabilityRegistryCanonicalV1,
  type NpAgentCapabilityRegistryEntryCanonicalV1,
  type NpAgentEffectProfileCanonicalV1,
  type NpAgentJsonSchema,
} from "./index.js";

function schema(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      slug: { type: "string", maxLength: 128 },
    },
    required: ["slug"],
  };
}

function readDescriptor(): NpAgentCapabilityDescriptor {
  return {
    schemaVersion: "np.agent-capability.v1",
    id: "content.query",
    contractVersion: 1,
    source: "core",
    title: "Query content",
    description: "Read one bounded, authorized content projection.",
    requiredScopes: ["content:read"],
    scopeDerivation: "content-query",
    risk: "read",
    approval: "none",
    effectProfiles: [
      {
        id: "domain.read",
        kind: "read",
        reversibility: "none",
        minimumGatewayExposure: "read",
        verifierId: null,
        compensatorId: null,
      },
    ],
    bootstrapIntent: "plugins",
    execution: "inline",
    idempotency: "none",
    gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    inputSchema: schema(),
    outputSchema: schema(),
  };
}

function mutationDescriptor(): NpAgentCapabilityDescriptor {
  return {
    schemaVersion: "np.agent-capability.v1",
    id: "changeset.create",
    contractVersion: 1,
    source: "app:nexpress",
    title: "Create ChangeSet",
    description: "Create one bounded draft ChangeSet without applying production effects.",
    requiredScopes: ["changeset:write"],
    scopeDerivation: "changeset-resources",
    risk: "reversible",
    approval: "none",
    effectProfiles: [
      {
        id: "changeset.draft-create",
        kind: "mutation",
        reversibility: "compensatable",
        minimumGatewayExposure: "propose",
        verifierId: "verify.changeset-draft",
        compensatorId: "compensate.changeset-draft",
      },
    ],
    bootstrapIntent: "write",
    execution: "inline",
    idempotency: "required",
    gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    inputSchema: schema(),
    outputSchema: schema(),
  };
}

function effectProfile(
  descriptor: NpAgentCapabilityDescriptor,
  implementationVersion = 2,
  effectContractVersion = 1,
): NpAgentEffectProfileCanonicalV1 {
  const profile = descriptor.effectProfiles[0];
  if (!profile) throw new Error("fixture requires one effect profile");
  return {
    schemaVersion: "np.agent-effect-profile.v1",
    capabilityId: descriptor.id,
    capabilityContractVersion: descriptor.contractVersion,
    implementationVersion,
    profileId: profile.id,
    kind: profile.kind,
    reversibility: profile.reversibility,
    minimumGatewayExposure: profile.minimumGatewayExposure,
    effectContractVersion,
    verifierId: profile.verifierId,
    compensatorId: profile.compensatorId,
  };
}

function entry(
  descriptor: NpAgentCapabilityDescriptor,
  implementationVersion = 2,
): NpAgentCapabilityRegistryEntryCanonicalV1 {
  return {
    descriptor,
    implementationVersion,
    effectProfiles: [effectProfile(descriptor, implementationVersion)],
  };
}

function definition(
  capability: NpAgentCapabilityRegistryEntryCanonicalV1,
): NpAgentCapabilityRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [capability],
  };
}

function registry(
  capabilities: NpAgentCapabilityRegistryEntryCanonicalV1[],
): NpAgentCapabilityRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "registry",
    capabilities,
  };
}

function multiCapabilitySnapshot(): NpAgentCapabilityRegistryEntryCanonicalV1[] {
  return [entry(mutationDescriptor(), 3), entry(readDescriptor(), 2)];
}

describe("Agent capability-registry canonical contract", () => {
  it("locks exact included, excluded, branch, and contextual-sibling fixtures", () => {
    expect(npAgentCapabilityRegistryCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "projection",
      "capabilities",
    ]);
    expect(npAgentCapabilityRegistryCanonicalEntryIncludedKeysV1).toEqual([
      "descriptor",
      "implementationVersion",
      "effectProfiles",
    ]);
    expect(npAgentCapabilityRegistryCanonicalDefinitionIncludedKeysV1).toEqual(
      npAgentCapabilityRegistryCanonicalIncludedKeysV1,
    );
    expect(npAgentCapabilityRegistryCanonicalRegistryIncludedKeysV1).toEqual(
      npAgentCapabilityRegistryCanonicalIncludedKeysV1,
    );
    expect(npAgentCapabilityRegistryCanonicalExcludedKeysV1).toEqual([
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
    ]);
    expect(npAgentCapabilityRegistryCanonicalContextualSiblingPairsV1).toEqual([
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
    ]);
    expect(npAgentCapabilityRegistryCanonicalDiscriminatorCasesV1).toEqual([
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
    ]);
    expect(npAgentCapabilityRegistryCanonicalProjectionFixtureV1).toMatchObject({
      purpose: "np.agent-capability-registry.v1",
      multiRegistryVectorId: "capability-registry-registry-multi-v1",
      expectedIncompleteRegistryErrorCode: "AGENT_CANONICAL_INCOMPLETE_REGISTRY",
    });
  });

  it("accepts singleton and multi-capability projections and returns detached safe copies", () => {
    const snapshot = multiCapabilitySnapshot();
    const inputs = [
      definition(entry(readDescriptor(), 2)),
      registry([entry(readDescriptor(), 2)]),
      definition(snapshot[0]),
      registry(snapshot),
    ];

    for (const input of inputs) {
      const parsed = npRequireAgentCapabilityRegistryCanonical(input);
      expect(parsed).toEqual(input);
      expect(parsed).not.toBe(input);
      expect(parsed.capabilities).not.toBe(input.capabilities);
      expect(parsed.capabilities[0]?.descriptor).not.toBe(input.capabilities[0]?.descriptor);
      expect(parsed.capabilities[0]?.effectProfiles).not.toBe(
        input.capabilities[0]?.effectProfiles,
      );
    }
  });

  it("binds canonical effects exactly to their descriptor and implementation version", () => {
    const read = entry(readDescriptor(), 2);
    const cases: Array<[keyof NpAgentEffectProfileCanonicalV1, unknown]> = [
      ["capabilityId", "content.get"],
      ["capabilityContractVersion", 2],
      ["implementationVersion", 3],
      ["profileId", "domain.other"],
      ["minimumGatewayExposure", null],
    ];

    for (const [field, replacement] of cases) {
      const body = definition(structuredClone(read));
      Object.assign(body.capabilities[0].effectProfiles[0], { [field]: replacement });
      expect(npAnalyzeAgentCapabilityRegistryCanonical(body)).toMatchObject({
        ok: false,
        issues: [
          {
            path: `agent.canonical.capabilityRegistry.capabilities[0].effectProfiles[0].${field}`,
          },
        ],
      });
    }

    const kindMismatch = definition(structuredClone(read));
    Object.assign(kindMismatch.capabilities[0].effectProfiles[0], {
      kind: "mutation",
      minimumGatewayExposure: "propose",
      verifierId: "verify.read",
    });
    expect(npAnalyzeAgentCapabilityRegistryCanonical(kindMismatch)).toMatchObject({
      ok: false,
      issues: [
        {
          path: "agent.canonical.capabilityRegistry.capabilities[0].effectProfiles[0].kind",
        },
      ],
    });

    const mutation = entry(mutationDescriptor(), 3);
    for (const [field, replacement] of [
      ["verifierId", "verify.other"],
      ["compensatorId", "compensate.other"],
    ] as const) {
      const body = definition(structuredClone(mutation));
      Object.assign(body.capabilities[0].effectProfiles[0], { [field]: replacement });
      expect(npAnalyzeAgentCapabilityRegistryCanonical(body)).toMatchObject({
        ok: false,
        issues: [
          {
            path: `agent.canonical.capabilityRegistry.capabilities[0].effectProfiles[0].${field}`,
          },
        ],
      });
    }

    const reversibilityMismatch = definition(structuredClone(mutation));
    Object.assign(reversibilityMismatch.capabilities[0].effectProfiles[0], {
      reversibility: "none",
      compensatorId: null,
    });
    expect(npAnalyzeAgentCapabilityRegistryCanonical(reversibilityMismatch)).toMatchObject({
      ok: false,
      issues: [
        {
          path: "agent.canonical.capabilityRegistry.capabilities[0].effectProfiles[0].reversibility",
        },
      ],
    });

    const independentEffectContractVersion = definition(entry(readDescriptor(), 2));
    independentEffectContractVersion.capabilities[0].effectProfiles[0].effectContractVersion = 7;
    expect(npAnalyzeAgentCapabilityRegistryCanonical(independentEffectContractVersion).ok).toBe(
      true,
    );
  });

  it("rejects effect coverage drift, unsorted profiles, and unsorted or duplicate capabilities", () => {
    const missingEffect = definition(entry(readDescriptor()));
    missingEffect.capabilities[0].effectProfiles = [];
    expect(npAnalyzeAgentCapabilityRegistryCanonical(missingEffect)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.capabilityRegistry.capabilities[0].effectProfiles" }],
    });

    const descriptor = readDescriptor();
    descriptor.effectProfiles = [
      { ...descriptor.effectProfiles[0], id: "a.read" },
      { ...descriptor.effectProfiles[0], id: "z.read" },
    ];
    const unsortedEffects = definition({
      descriptor,
      implementationVersion: 2,
      effectProfiles: [
        effectProfile({ ...descriptor, effectProfiles: [descriptor.effectProfiles[1]] }, 2),
        effectProfile({ ...descriptor, effectProfiles: [descriptor.effectProfiles[0]] }, 2),
      ],
    });
    expect(npAnalyzeAgentCapabilityRegistryCanonical(unsortedEffects)).toMatchObject({
      ok: false,
      issues: [{ code: "order" }],
    });

    const snapshot = multiCapabilitySnapshot();
    expect(
      npAnalyzeAgentCapabilityRegistryCanonical(registry([...snapshot].reverse())),
    ).toMatchObject({ ok: false, issues: [{ code: "order" }] });
    expect(
      npAnalyzeAgentCapabilityRegistryCanonical(
        registry([snapshot[0], structuredClone(snapshot[0])]),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "duplicate" }] });
  });

  it("keeps context-free cardinality separate from installed-snapshot completeness", () => {
    const snapshot = multiCapabilitySnapshot();
    const incompleteRegistry = registry([snapshot[0]]);

    expect(npAnalyzeAgentCapabilityRegistryCanonical(incompleteRegistry).ok).toBe(true);
    expect(() =>
      npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(
        incompleteRegistry,
        snapshot,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: npAgentCanonicalIncompleteRegistryErrorCode,
        purpose: "np.agent-capability-registry.v1",
      }),
    );
    expect(() =>
      npBuildAgentCapabilityRegistryCanonicalBytes(incompleteRegistry, snapshot),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);

    const retaggedMultiDefinition = {
      ...registry(snapshot),
      projection: "definition" as const,
    };
    expect(npAnalyzeAgentCapabilityRegistryCanonical(retaggedMultiDefinition)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.capabilityRegistry.capabilities" }],
    });

    const uninstalledDefinition = definition(entry(readDescriptor(), 9));
    expect(() =>
      npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(
        uninstalledDefinition,
        snapshot,
      ),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);
    expect(
      npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(
        definition(snapshot[1]),
        snapshot,
      ),
    ).toEqual(definition(snapshot[1]));
    expect(
      npRequireAgentCapabilityRegistryCanonicalForInstalledCapabilities(
        registry(snapshot),
        snapshot,
      ),
    ).toEqual(registry(snapshot));
  });

  it("rejects unknown runtime fields at every owned layer", () => {
    expect(
      npAnalyzeAgentCapabilityRegistryCanonical({
        ...definition(entry(readDescriptor())),
        registryFingerprint: "cj1:sha256:not-owned",
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });

    const entryRuntimeField = definition(entry(readDescriptor())) as unknown as {
      capabilities: Array<Record<string, unknown>>;
    };
    entryRuntimeField.capabilities[0].execute = () => undefined;
    expect(npAnalyzeAgentCapabilityRegistryCanonical(entryRuntimeField)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const descriptorRuntimeField = definition(entry(readDescriptor())) as unknown as {
      capabilities: Array<{ descriptor: Record<string, unknown> }>;
    };
    descriptorRuntimeField.capabilities[0].descriptor.sourceFunction = "handler";
    expect(npAnalyzeAgentCapabilityRegistryCanonical(descriptorRuntimeField)).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field" }],
    });

    const effectRuntimeField = definition(entry(readDescriptor())) as unknown as {
      capabilities: Array<{ effectProfiles: Array<Record<string, unknown>> }>;
    };
    effectRuntimeField.capabilities[0].effectProfiles[0].effectFingerprint = "not-owned";
    expect(npAnalyzeAgentCapabilityRegistryCanonical(effectRuntimeField)).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field" }],
    });
  });

  it("contains accessors, proxies, cycles, shared references, and sparse arrays", () => {
    const getter = vi.fn(() => "registry");
    const accessorBody = definition(entry(readDescriptor()));
    Object.defineProperty(accessorBody, "projection", { enumerable: true, get: getter });
    expect(npAnalyzeAgentCapabilityRegistryCanonical(accessorBody)).toMatchObject({
      ok: false,
      issues: [{ code: "shape", path: "agent.canonical.capabilityRegistry.projection" }],
    });
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("must stay contained");
        },
      },
    );
    expect(npAnalyzeAgentCapabilityRegistryCanonical(hostile)).toEqual({
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path: "agent.canonical.capabilityRegistry",
          message: "could not be inspected safely",
        },
      ],
    });

    const cyclic = definition(entry(readDescriptor())) as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(npAnalyzeAgentCapabilityRegistryCanonical(cyclic)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const sharedEntry = entry(readDescriptor());
    expect(
      npAnalyzeAgentCapabilityRegistryCanonical(registry([sharedEntry, sharedEntry])),
    ).toMatchObject({ ok: false, issues: [{ code: "shape" }] });

    const sparse = definition(entry(readDescriptor()));
    sparse.capabilities[0].effectProfiles = new Array(1);
    expect(npAnalyzeAgentCapabilityRegistryCanonical(sparse)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });
  });

  it("enforces integer, cardinality, I-JSON, and whole-body byte boundaries", () => {
    for (const implementationVersion of [0, 2_147_483_648, 1.5, Number.NaN]) {
      const body = definition(entry(readDescriptor()));
      body.capabilities[0].implementationVersion = implementationVersion;
      body.capabilities[0].effectProfiles[0].implementationVersion = implementationVersion;
      expect(npAnalyzeAgentCapabilityRegistryCanonical(body).ok).toBe(false);
    }
    const maximumVersion = definition(entry(readDescriptor(), 2_147_483_647));
    expect(npAnalyzeAgentCapabilityRegistryCanonical(maximumVersion).ok).toBe(true);

    expect(
      npAnalyzeAgentCapabilityRegistryCanonical({
        schemaVersion: "np.agent-capability-registry.v1",
        projection: "registry",
        capabilities: [],
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });
    expect(
      npAnalyzeAgentCapabilityRegistryCanonical({
        ...definition(entry(readDescriptor())),
        projection: "unknown",
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });

    const oversized = {
      ...definition(entry(readDescriptor())),
      padding: Array.from({ length: 65 }, () => "x".repeat(262_144)),
    };
    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      npAgentCanonicalBodyMaxBytesV1["np.agent-capability-registry.v1"],
    );
    expect(npAnalyzeAgentCapabilityRegistryCanonical(oversized)).toMatchObject({
      ok: false,
      issues: [{ code: "limit" }],
    });

    const loneSurrogate = definition(entry(readDescriptor()));
    loneSurrogate.capabilities[0].descriptor.title = "unsafe\ud800";
    expect(npAnalyzeAgentCapabilityRegistryCanonical(loneSurrogate)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("locks four projection golden digests and domain-separated bytes", async () => {
    const singleton = [entry(readDescriptor(), 2)];
    const multi = multiCapabilitySnapshot();
    const vectors = [
      definition(singleton[0]),
      registry(singleton),
      definition(multi[0]),
      registry(multi),
    ];
    const expectedDigests = [
      "cj1:sha256:avc-nrdGVVohpOnt0WbxVc5Yt3r4UZ7iwC93D4mnK1o",
      "cj1:sha256:F4EUSK0UFHE-qYFATi-QQgW_PY_9nwESJZrY5rvF24U",
      "cj1:sha256:N5-CDb2lE4C_4kF7sOi3OQ-um8-Bghdvy-PSJSvg4xw",
      "cj1:sha256:Nq49TF1UKmEZSMphBic8K3XnfhWteq4gDOhrBHDUclI",
    ];
    const digests = await Promise.all(
      vectors.map((body) =>
        npDigestAgentCapabilityRegistryCanonical(
          body,
          body.projection === "registry" && body.capabilities.length === 1 ? singleton : multi,
        ),
      ),
    );

    expect(digests).toEqual(expectedDigests);
    expect(new Set(digests).size).toBe(4);

    const bytes = npBuildAgentCapabilityRegistryCanonicalBytes(registry(multi), multi);
    expect(bytes.purpose).toBe("np.agent-capability-registry.v1");
    expect(new TextDecoder().decode(bytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-capability-registry.v1\0${new TextDecoder().decode(bytes.canonicalJsonUtf8)}`,
    );
    expect(JSON.parse(new TextDecoder().decode(bytes.canonicalJsonUtf8))).toEqual(registry(multi));
  });

  it("makes source key order irrelevant without normalizing sorted semantic arrays", async () => {
    const snapshot = multiCapabilitySnapshot();
    const ordered = registry(snapshot);
    const shuffled = {
      capabilities: ordered.capabilities.map((capability) => ({
        effectProfiles: capability.effectProfiles.map((effect) => ({
          compensatorId: effect.compensatorId,
          verifierId: effect.verifierId,
          effectContractVersion: effect.effectContractVersion,
          minimumGatewayExposure: effect.minimumGatewayExposure,
          reversibility: effect.reversibility,
          kind: effect.kind,
          profileId: effect.profileId,
          implementationVersion: effect.implementationVersion,
          capabilityContractVersion: effect.capabilityContractVersion,
          capabilityId: effect.capabilityId,
          schemaVersion: effect.schemaVersion,
        })),
        implementationVersion: capability.implementationVersion,
        descriptor: capability.descriptor,
      })),
      projection: ordered.projection,
      schemaVersion: ordered.schemaVersion,
    };

    expect(
      npBuildAgentCapabilityRegistryCanonicalBytes(shuffled, snapshot).canonicalJsonUtf8,
    ).toEqual(npBuildAgentCapabilityRegistryCanonicalBytes(ordered, snapshot).canonicalJsonUtf8);
    await expect(npDigestAgentCapabilityRegistryCanonical(shuffled, snapshot)).resolves.toBe(
      await npDigestAgentCapabilityRegistryCanonical(ordered, snapshot),
    );
  });

  it("exposes contract errors only from context-free require APIs", () => {
    expect(() => npRequireAgentCapabilityRegistryCanonical({})).toThrow(NpAgentContractError);
  });
});
