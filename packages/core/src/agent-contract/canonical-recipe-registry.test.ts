import { describe, expect, it, vi } from "vitest";

import {
  NpAgentCanonicalIncompleteRegistryError,
  NpAgentContractError,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCanonicalIncompleteRegistryErrorCode,
  npAgentContractLimits,
  npAgentRecipeDefinitionCanonicalIncludedKeysV1,
  npAgentRecipeIds,
  npAgentRecipeInstructionCanonicalIncludedKeysV1,
  npAgentRecipeProviderModes,
  npAgentRecipeRegistryCanonicalContextualSiblingPairsV1,
  npAgentRecipeRegistryCanonicalDefinitionIncludedKeysV1,
  npAgentRecipeRegistryCanonicalDiscriminatorCasesV1,
  npAgentRecipeRegistryCanonicalExcludedKeysV1,
  npAgentRecipeRegistryCanonicalIncludedKeysV1,
  npAgentRecipeRegistryCanonicalProjectionFixtureV1,
  npAgentRecipeRegistryCanonicalRegistryIncludedKeysV1,
  npAgentRecipeTasks,
  npAgentRecipeTemplates,
  npAgentRecipeTriggerKinds,
  npAnalyzeAgentRecipeRegistryCanonical,
  npBuildAgentRecipeRegistryCanonicalBytes,
  npDigestAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonicalForInstalledRecipes,
  type NpAgentJsonSchema,
  type NpAgentRecipeDefinitionCanonicalV1,
  type NpAgentRecipeId,
  type NpAgentRecipeRegistryCanonicalV1,
} from "./index.js";

function schema(property = "value"): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      [property]: { type: "string", maxLength: 128 },
    },
    required: [property],
  };
}

function providerRecipe(
  id: NpAgentRecipeId = "publisher.stale-content",
): NpAgentRecipeDefinitionCanonicalV1 {
  return {
    id,
    version: 1,
    allowedTemplates: ["custom", "publisher"],
    task: "interactive-capability",
    providerMode: "required",
    triggerKinds: ["manual", "schedule"],
    capabilityIds: ["changeset.create", "content.query"],
    settingsSchema: schema("collection"),
    manualInputSchema: schema("goal"),
    responseSchema: schema("proposal"),
    instruction: {
      templateId: "publisher.stale-content",
      templateVersion: 1,
      digest: "cj1:sha256:pKWI5bXhXL-ialWD2iRgqci4hTnpKowcAIKfCq7ht9k",
      text: "Publish stale content safely.",
    },
  };
}

function deterministicRecipe(): NpAgentRecipeDefinitionCanonicalV1 {
  return {
    id: "operator.worker-not-draining",
    version: 1,
    allowedTemplates: ["operator"],
    task: "interactive-capability",
    providerMode: "forbidden",
    triggerKinds: ["schedule"],
    capabilityIds: ["ops.plan", "ops.status"],
    settingsSchema: schema("checkId"),
    manualInputSchema: null,
    responseSchema: schema("result"),
    instruction: null,
  };
}

function definition(recipe: NpAgentRecipeDefinitionCanonicalV1): NpAgentRecipeRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "definition",
    recipes: [recipe],
  };
}

function registry(recipes: NpAgentRecipeDefinitionCanonicalV1[]): NpAgentRecipeRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "registry",
    recipes,
  };
}

function multiRecipeSnapshot(): NpAgentRecipeDefinitionCanonicalV1[] {
  return [deterministicRecipe(), providerRecipe()];
}

describe("Agent recipe-registry canonical contract", () => {
  it("locks recipe inventories and every exact field/discriminator fixture", () => {
    expect(npAgentRecipeIds).toEqual([
      "publisher.stale-content",
      "moderator.repeated-link-spam",
      "operator.worker-not-draining",
      "guardian.credential-stuffing",
      "guardian.agent-abuse",
    ]);
    expect(npAgentRecipeIds).toHaveLength(npAgentContractLimits.coreRecipeDefinitions);
    expect(new Set(npAgentRecipeIds).size).toBe(npAgentRecipeIds.length);
    expect(npAgentRecipeTemplates).toEqual([
      "publisher",
      "moderator",
      "operator",
      "guardian",
      "custom",
    ]);
    expect(npAgentRecipeTasks).toEqual([
      "interactive-capability",
      "moderation-classification",
      "guardian-assessment",
    ]);
    expect(npAgentRecipeProviderModes).toEqual(["required", "optional", "forbidden"]);
    expect(npAgentRecipeTriggerKinds).toEqual(["manual", "event", "schedule"]);

    expect(npAgentRecipeRegistryCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "projection",
      "recipes",
    ]);
    expect(npAgentRecipeDefinitionCanonicalIncludedKeysV1).toEqual([
      "id",
      "version",
      "allowedTemplates",
      "task",
      "providerMode",
      "triggerKinds",
      "capabilityIds",
      "settingsSchema",
      "manualInputSchema",
      "responseSchema",
      "instruction",
    ]);
    expect(npAgentRecipeInstructionCanonicalIncludedKeysV1).toEqual([
      "templateId",
      "templateVersion",
      "digest",
      "text",
    ]);
    expect(npAgentRecipeRegistryCanonicalDefinitionIncludedKeysV1).toEqual(
      npAgentRecipeRegistryCanonicalIncludedKeysV1,
    );
    expect(npAgentRecipeRegistryCanonicalRegistryIncludedKeysV1).toEqual(
      npAgentRecipeRegistryCanonicalIncludedKeysV1,
    );
    expect(npAgentRecipeRegistryCanonicalExcludedKeysV1).toEqual([
      "registryFingerprint",
      "fingerprint",
      "registeredAt",
      "settingsParser",
      "manualInputParser",
      "responseParser",
      "execute",
    ]);
    expect(npAgentRecipeRegistryCanonicalContextualSiblingPairsV1).toEqual([
      {
        sourceCaseId: "np.agent-recipe-registry.v1.projection.definition",
        siblingCaseId: "np.agent-recipe-registry.v1.projection.registry",
        verification: "registry-completeness",
      },
      {
        sourceCaseId: "np.agent-recipe-registry.v1.projection.registry",
        siblingCaseId: "np.agent-recipe-registry.v1.projection.definition",
        verification: "registry-completeness",
      },
    ]);
    expect(npAgentRecipeRegistryCanonicalDiscriminatorCasesV1).toEqual([
      {
        caseId: "np.agent-recipe-registry.v1.projection.definition",
        concreteDiscriminatorPath: "/projection",
        acceptedValue: "definition",
      },
      {
        caseId: "np.agent-recipe-registry.v1.projection.registry",
        concreteDiscriminatorPath: "/projection",
        acceptedValue: "registry",
      },
    ]);
    expect(npAgentRecipeRegistryCanonicalProjectionFixtureV1).toMatchObject({
      purpose: "np.agent-recipe-registry.v1",
      multiRegistryVectorId: "recipe-registry-registry-multi-v1",
      expectedIncompleteRegistryErrorCode: "AGENT_CANONICAL_INCOMPLETE_REGISTRY",
    });
  });

  it("accepts all closed recipe ids, tasks, provider modes, and detached projections", () => {
    const allRecipes = [...npAgentRecipeIds].sort().map((id) => providerRecipe(id));
    const fullRegistry = registry(allRecipes);
    const parsedRegistry = npRequireAgentRecipeRegistryCanonical(fullRegistry);
    expect(parsedRegistry).toEqual(fullRegistry);
    expect(parsedRegistry).not.toBe(fullRegistry);
    expect(parsedRegistry.recipes).not.toBe(fullRegistry.recipes);
    expect(parsedRegistry.recipes[0]?.settingsSchema).not.toBe(
      fullRegistry.recipes[0]?.settingsSchema,
    );

    for (const task of npAgentRecipeTasks) {
      expect(
        npAnalyzeAgentRecipeRegistryCanonical(definition({ ...providerRecipe(), task })).ok,
      ).toBe(true);
    }
    expect(
      npAnalyzeAgentRecipeRegistryCanonical(
        definition({ ...providerRecipe(), providerMode: "optional" }),
      ).ok,
    ).toBe(true);
    expect(npAnalyzeAgentRecipeRegistryCanonical(definition(deterministicRecipe())).ok).toBe(true);
  });

  it("enforces sorted-unique recipe definition sets and documented non-empty bounds", () => {
    const cases: Array<["allowedTemplates" | "triggerKinds" | "capabilityIds", string[]]> = [
      ["allowedTemplates", ["publisher", "custom"]],
      ["triggerKinds", ["schedule", "manual"]],
      ["capabilityIds", ["content.query", "changeset.create"]],
    ];
    for (const [field, values] of cases) {
      expect(
        npAnalyzeAgentRecipeRegistryCanonical(definition({ ...providerRecipe(), [field]: values })),
      ).toMatchObject({ ok: false, issues: [{ code: "order" }] });
      expect(
        npAnalyzeAgentRecipeRegistryCanonical(
          definition({ ...providerRecipe(), [field]: [values[0], values[0]] }),
        ),
      ).toMatchObject({ ok: false, issues: [{ code: "duplicate" }] });
      const emptyResult = npAnalyzeAgentRecipeRegistryCanonical(
        definition({ ...providerRecipe(), [field]: [] }),
      );
      if (field === "allowedTemplates") {
        expect(emptyResult.ok).toBe(true);
      } else {
        expect(emptyResult).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });
      }
    }

    expect(
      npAnalyzeAgentRecipeRegistryCanonical(
        definition({ ...providerRecipe(), capabilityIds: ["not.real"] as never }),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });
  });

  it("enforces the provider/instruction null matrix and exact instruction fields", () => {
    expect(
      npAnalyzeAgentRecipeRegistryCanonical(definition({ ...providerRecipe(), instruction: null })),
    ).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.recipeRegistry.recipes[0].instruction" }],
    });
    expect(
      npAnalyzeAgentRecipeRegistryCanonical(
        definition({ ...deterministicRecipe(), instruction: providerRecipe().instruction }),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });

    for (const [field, replacement] of [
      ["templateId", "Not Canonical"],
      ["templateVersion", 0],
      ["digest", "sha256:not-canonical"],
      ["text", 3],
    ] as const) {
      const body = definition(providerRecipe());
      const instruction = body.recipes[0]?.instruction;
      if (instruction === null || instruction === undefined) {
        throw new Error("provider recipe fixture requires an instruction");
      }
      Object.assign(instruction, { [field]: replacement });
      expect(npAnalyzeAgentRecipeRegistryCanonical(body)).toMatchObject({
        ok: false,
        issues: [
          {
            path: `agent.canonical.recipeRegistry.recipes[0].instruction.${field}`,
          },
        ],
      });
    }

    const unknownInstructionField = definition(providerRecipe()) as unknown as {
      recipes: Array<{ instruction: Record<string, unknown> }>;
    };
    unknownInstructionField.recipes[0].instruction.extra = true;
    expect(npAnalyzeAgentRecipeRegistryCanonical(unknownInstructionField)).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field" }],
    });

    const emptyInstructionText = definition(providerRecipe());
    emptyInstructionText.recipes[0].instruction!.text = "";
    expect(npAnalyzeAgentRecipeRegistryCanonical(emptyInstructionText).ok).toBe(true);
  });

  it("reuses the exact bounded JSON Schema analyzer with nested paths", () => {
    const invalidSettings = definition(providerRecipe());
    (invalidSettings.recipes[0].settingsSchema as Record<string, unknown>).additionalProperties =
      true;
    expect(npAnalyzeAgentRecipeRegistryCanonical(invalidSettings)).toMatchObject({
      ok: false,
      issues: [
        {
          path: "agent.canonical.recipeRegistry.recipes[0].settingsSchema.additionalProperties",
        },
      ],
    });

    const invalidManual = definition(providerRecipe());
    (invalidManual.recipes[0].manualInputSchema as Record<string, unknown>).$schema = "draft-07";
    expect(npAnalyzeAgentRecipeRegistryCanonical(invalidManual)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.recipeRegistry.recipes[0].manualInputSchema.$schema" }],
    });

    const invalidResponse = definition(providerRecipe());
    (invalidResponse.recipes[0].responseSchema as Record<string, unknown>).type = "string";
    expect(npAnalyzeAgentRecipeRegistryCanonical(invalidResponse)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.recipeRegistry.recipes[0].responseSchema.type" }],
    });
    expect(npAnalyzeAgentRecipeRegistryCanonical(definition(deterministicRecipe())).ok).toBe(true);
  });

  it("rejects recipe order/identity drift and separates cardinality from completeness", () => {
    const snapshot = multiRecipeSnapshot();
    expect(npAnalyzeAgentRecipeRegistryCanonical(registry([...snapshot].reverse()))).toMatchObject({
      ok: false,
      issues: [{ code: "order" }],
    });
    expect(
      npAnalyzeAgentRecipeRegistryCanonical(registry([snapshot[0], structuredClone(snapshot[0])])),
    ).toMatchObject({ ok: false, issues: [{ code: "duplicate" }] });

    const incompleteRegistry = registry([snapshot[0]]);
    expect(npAnalyzeAgentRecipeRegistryCanonical(incompleteRegistry).ok).toBe(true);
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(incompleteRegistry, snapshot),
    ).toThrowError(
      expect.objectContaining({
        code: npAgentCanonicalIncompleteRegistryErrorCode,
        purpose: "np.agent-recipe-registry.v1",
      }),
    );
    expect(() => npBuildAgentRecipeRegistryCanonicalBytes(incompleteRegistry, snapshot)).toThrow(
      NpAgentCanonicalIncompleteRegistryError,
    );

    const retaggedMultiDefinition = {
      ...registry(snapshot),
      projection: "definition" as const,
    };
    expect(npAnalyzeAgentRecipeRegistryCanonical(retaggedMultiDefinition)).toMatchObject({
      ok: false,
      issues: [{ path: "agent.canonical.recipeRegistry.recipes" }],
    });
    const modifiedDefinition = definition({ ...snapshot[1], task: "guardian-assessment" });
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(modifiedDefinition, snapshot),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);
    expect(
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(definition(snapshot[1]), snapshot),
    ).toEqual(definition(snapshot[1]));
    expect(
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(registry(snapshot), snapshot),
    ).toEqual(registry(snapshot));
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(
        definition(snapshot[1]),
        [...snapshot].reverse(),
      ),
    ).toThrow(NpAgentContractError);
  });

  it("rejects unknown runtime fields at the registry and definition layers", () => {
    for (const field of npAgentRecipeRegistryCanonicalExcludedKeysV1) {
      expect(
        npAnalyzeAgentRecipeRegistryCanonical({
          ...definition(providerRecipe()),
          [field]: null,
        }),
      ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });
    }

    const definitionRuntimeField = definition(providerRecipe()) as unknown as {
      recipes: Array<Record<string, unknown>>;
    };
    definitionRuntimeField.recipes[0].settingsParser = "runtime-only";
    expect(npAnalyzeAgentRecipeRegistryCanonical(definitionRuntimeField)).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field" }],
    });

    for (const field of npAgentRecipeRegistryCanonicalExcludedKeysV1.slice(1)) {
      const body = definition(providerRecipe()) as unknown as {
        recipes: Array<Record<string, unknown>>;
      };
      body.recipes[0][field] = null;
      expect(npAnalyzeAgentRecipeRegistryCanonical(body)).toMatchObject({
        ok: false,
        issues: [{ code: "unknown-field" }],
      });
    }
  });

  it("contains accessors, proxies, cycles, shared references, and sparse arrays", () => {
    const getter = vi.fn(() => "registry");
    const accessorBody = definition(providerRecipe());
    Object.defineProperty(accessorBody, "projection", { enumerable: true, get: getter });
    expect(npAnalyzeAgentRecipeRegistryCanonical(accessorBody)).toMatchObject({
      ok: false,
      issues: [{ code: "shape", path: "agent.canonical.recipeRegistry.projection" }],
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
    expect(npAnalyzeAgentRecipeRegistryCanonical(hostile)).toEqual({
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path: "agent.canonical.recipeRegistry",
          message: "could not be inspected safely",
        },
      ],
    });

    const cyclic = definition(providerRecipe()) as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(npAnalyzeAgentRecipeRegistryCanonical(cyclic)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const shared = providerRecipe();
    expect(npAnalyzeAgentRecipeRegistryCanonical(registry([shared, shared]))).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const sparse = definition(providerRecipe());
    sparse.recipes[0].capabilityIds = new Array(1);
    expect(npAnalyzeAgentRecipeRegistryCanonical(sparse)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });
  });

  it("enforces closed versions, cardinalities, I-JSON, and the 8 MiB body ceiling", () => {
    for (const version of [0, 2, 1.5, Number.NaN]) {
      expect(
        npAnalyzeAgentRecipeRegistryCanonical(
          definition({ ...providerRecipe(), version } as NpAgentRecipeDefinitionCanonicalV1),
        ).ok,
      ).toBe(false);
    }
    for (const templateVersion of [0, 2_147_483_648, 1.5, Number.NaN]) {
      const body = definition(providerRecipe());
      body.recipes[0].instruction!.templateVersion = templateVersion;
      expect(npAnalyzeAgentRecipeRegistryCanonical(body).ok).toBe(false);
    }
    const maximumTemplateVersion = definition(providerRecipe());
    maximumTemplateVersion.recipes[0].instruction!.templateVersion = 2_147_483_647;
    expect(npAnalyzeAgentRecipeRegistryCanonical(maximumTemplateVersion).ok).toBe(true);

    expect(
      npAnalyzeAgentRecipeRegistryCanonical({
        schemaVersion: "np.agent-recipe-registry.v1",
        projection: "registry",
        recipes: [],
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid-field" }] });

    const sixRecipes = Array.from({ length: 6 }, () => structuredClone(providerRecipe()));
    expect(npAnalyzeAgentRecipeRegistryCanonical(registry(sixRecipes))).toMatchObject({
      ok: false,
      issues: [{ code: "limit" }],
    });

    const oversized = {
      ...definition(providerRecipe()),
      padding: Array.from({ length: 33 }, () => "x".repeat(262_144)),
    };
    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      npAgentCanonicalBodyMaxBytesV1["np.agent-recipe-registry.v1"],
    );
    expect(npAnalyzeAgentRecipeRegistryCanonical(oversized)).toMatchObject({
      ok: false,
      issues: [{ code: "limit" }],
    });

    const loneSurrogate = definition(providerRecipe());
    loneSurrogate.recipes[0].instruction!.text = "unsafe\ud800";
    expect(npAnalyzeAgentRecipeRegistryCanonical(loneSurrogate)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("locks four projection golden digests and domain-separated bytes", async () => {
    const singleton = [providerRecipe()];
    const multi = multiRecipeSnapshot();
    const vectors = [
      definition(singleton[0]),
      registry(singleton),
      definition(multi[0]),
      registry(multi),
    ];
    const expectedDigests = [
      "cj1:sha256:bSw19cn8B0_LzpUxRpp3m0T9325ZBBHcfwGwKbAvJks",
      "cj1:sha256:zI0IHo_jidyBE-j_YpQOQ6HCI_12uEcDz8wC0SNgYXA",
      "cj1:sha256:TT3LJcLbXFvRZyJURGCzgindt5adKVFSsvJHKZsfjJs",
      "cj1:sha256:OuFulTWiBW26PNHks0zpVhzVn3R2jJhG2pPIqT_oMb4",
    ];
    const digests = await Promise.all(
      vectors.map((body) =>
        npDigestAgentRecipeRegistryCanonical(
          body,
          body.projection === "registry" && body.recipes.length === 1 ? singleton : multi,
        ),
      ),
    );

    expect(digests).toEqual(expectedDigests);
    expect(new Set(digests).size).toBe(4);

    const bytes = npBuildAgentRecipeRegistryCanonicalBytes(registry(multi), multi);
    expect(bytes.purpose).toBe("np.agent-recipe-registry.v1");
    expect(new TextDecoder().decode(bytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-recipe-registry.v1\0${new TextDecoder().decode(bytes.canonicalJsonUtf8)}`,
    );
    expect(JSON.parse(new TextDecoder().decode(bytes.canonicalJsonUtf8))).toEqual(registry(multi));
  });

  it("makes source key order irrelevant without normalizing semantic arrays", async () => {
    const snapshot = multiRecipeSnapshot();
    const ordered = registry(snapshot);
    const shuffled = {
      recipes: ordered.recipes.map((recipe) => ({
        instruction:
          recipe.instruction === null
            ? null
            : {
                text: recipe.instruction.text,
                digest: recipe.instruction.digest,
                templateVersion: recipe.instruction.templateVersion,
                templateId: recipe.instruction.templateId,
              },
        responseSchema: recipe.responseSchema,
        manualInputSchema: recipe.manualInputSchema,
        settingsSchema: recipe.settingsSchema,
        capabilityIds: recipe.capabilityIds,
        triggerKinds: recipe.triggerKinds,
        providerMode: recipe.providerMode,
        task: recipe.task,
        allowedTemplates: recipe.allowedTemplates,
        version: recipe.version,
        id: recipe.id,
      })),
      projection: ordered.projection,
      schemaVersion: ordered.schemaVersion,
    };

    expect(npBuildAgentRecipeRegistryCanonicalBytes(shuffled, snapshot).canonicalJsonUtf8).toEqual(
      npBuildAgentRecipeRegistryCanonicalBytes(ordered, snapshot).canonicalJsonUtf8,
    );
    await expect(npDigestAgentRecipeRegistryCanonical(shuffled, snapshot)).resolves.toBe(
      await npDigestAgentRecipeRegistryCanonical(ordered, snapshot),
    );
  });

  it("exposes contract errors only from context-free require APIs", () => {
    expect(() => npRequireAgentRecipeRegistryCanonical({})).toThrow(NpAgentContractError);
  });
});
