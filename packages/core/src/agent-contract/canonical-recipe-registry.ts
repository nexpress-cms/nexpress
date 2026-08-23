import {
  NpAgentContractError,
  npAgentContractLimits,
  npAnalyzeAgentJsonSchema,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
  type AgentCanonicalJsonInspectionLimits,
} from "./canonical-foundation.js";
import { requireAgentCanonicalRegistryCompleteness } from "./canonical-registry-completeness.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCapabilityIds,
  npAgentRecipeIds,
  npAgentRecipeProviderModes,
  npAgentRecipeTasks,
  npAgentRecipeTemplates,
  npAgentRecipeTriggerKinds,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentCapabilityId,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentJsonSchema,
  type NpAgentRecipeDefinitionCanonicalV1,
  type NpAgentRecipeId,
  type NpAgentRecipeInstructionCanonicalV1,
  type NpAgentRecipeProviderMode,
  type NpAgentRecipeRegistryCanonicalV1,
  type NpAgentRecipeTask,
  type NpAgentRecipeTemplate,
  type NpAgentRecipeTriggerKind,
} from "./types.js";

const PURPOSE = "np.agent-recipe-registry.v1" as const;
const PROJECTIONS = new Set<string>(["definition", "registry"]);
const RECIPE_IDS = new Set<string>(npAgentRecipeIds);
const RECIPE_TEMPLATES = new Set<string>(npAgentRecipeTemplates);
const RECIPE_TASKS = new Set<string>(npAgentRecipeTasks);
const RECIPE_PROVIDER_MODES = new Set<string>(npAgentRecipeProviderModes);
const RECIPE_TRIGGER_KINDS = new Set<string>(npAgentRecipeTriggerKinds);
const CAPABILITY_IDS = new Set<string>(npAgentCapabilityIds);
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;

const STRUCTURAL_LIMITS: AgentCanonicalJsonInspectionLimits = {
  maximumDepth: npAgentContractLimits.jsonSchemaDepth + 12,
  maximumNodes:
    npAgentContractLimits.coreRecipeDefinitions * npAgentContractLimits.jsonSchemaNodes * 3 + 5_000,
  maximumArrayItems: npAgentContractLimits.jsonSchemaMaxItems,
  maximumObjectProperties: npAgentContractLimits.jsonSchemaObjectProperties,
  maximumStringCharacters: npAgentCanonicalBodyMaxBytesV1[PURPOSE],
  maximumCanonicalBytes: npAgentCanonicalBodyMaxBytesV1[PURPOSE],
};

export const npAgentRecipeRegistryCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "recipes",
] as const satisfies readonly (keyof NpAgentRecipeRegistryCanonicalV1)[];

export const npAgentRecipeRegistryCanonicalExcludedKeysV1 = [
  "registryFingerprint",
  "fingerprint",
  "registeredAt",
  "settingsParser",
  "manualInputParser",
  "responseParser",
  "execute",
] as const;

export const npAgentRecipeDefinitionCanonicalIncludedKeysV1 = [
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
] as const satisfies readonly (keyof NpAgentRecipeDefinitionCanonicalV1)[];

export const npAgentRecipeInstructionCanonicalIncludedKeysV1 = [
  "templateId",
  "templateVersion",
  "digest",
  "text",
] as const satisfies readonly (keyof NpAgentRecipeInstructionCanonicalV1)[];

export const npAgentRecipeRegistryCanonicalDefinitionIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "recipes",
] as const satisfies readonly (keyof NpAgentRecipeRegistryCanonicalV1)[];

export const npAgentRecipeRegistryCanonicalRegistryIncludedKeysV1 = [
  "schemaVersion",
  "projection",
  "recipes",
] as const satisfies readonly (keyof NpAgentRecipeRegistryCanonicalV1)[];

export const npAgentRecipeRegistryCanonicalContextualSiblingPairsV1 = [
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
] as const;

export const npAgentRecipeRegistryCanonicalDiscriminatorCasesV1 = [
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
] as const;

export const npAgentRecipeRegistryCanonicalProjectionFixtureV1 = {
  purpose: PURPOSE,
  fixtureId: "recipe-registry-projection-v1",
  definitionCaseId: "np.agent-recipe-registry.v1.projection.definition",
  registryCaseId: "np.agent-recipe-registry.v1.projection.registry",
  singletonDefinitionVectorId: "recipe-registry-definition-singleton-v1",
  singletonRegistryVectorId: "recipe-registry-registry-singleton-v1",
  multiMemberDefinitionVectorId: "recipe-registry-definition-member-multi-v1",
  multiRegistryVectorId: "recipe-registry-registry-multi-v1",
  expectedIncompleteRegistryErrorCode: "AGENT_CANONICAL_INCOMPLETE_REGISTRY",
} as const;

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
    "Invalid Agent recipe-registry canonical body",
    remapIssues(result.issues, sourceRoot, targetRoot),
  );
}

function cloneInput(value: unknown): unknown {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(
      value,
      "agent.canonical.recipeRegistry",
      STRUCTURAL_LIMITS,
    ),
    "Invalid Agent recipe-registry canonical body",
  );
}

function parseSchema(value: unknown, path: string): NpAgentJsonSchema {
  return requireNestedResult(npAnalyzeAgentJsonSchema(value), "agent.schema", path);
}

function parseSortedEnumArray<T extends string>(options: {
  value: unknown;
  path: string;
  allowed: ReadonlySet<string>;
  minimum?: number;
  maximum: number;
  state: CanonicalBodyInspectionState;
}): T[] {
  const { value, path, allowed, minimum = 0, maximum, state } = options;
  const entries = canonicalBodyArray(value, path, maximum, state);
  if (entries.length < minimum) {
    failCanonicalBody("invalid-field", path, `must contain at least ${minimum.toString()} entry`);
  }

  const result: T[] = [];
  let previous: string | undefined;
  entries.forEach((entry, index) => {
    const current = canonicalBodyEnum<T>(entry, `${path}[${index.toString()}]`, allowed);
    if (previous !== undefined && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical ASCII value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseInstruction(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRecipeInstructionCanonicalV1 {
  const instruction = canonicalBodyRecord(
    value,
    path,
    npAgentRecipeInstructionCanonicalIncludedKeysV1,
    npAgentRecipeInstructionCanonicalIncludedKeysV1,
    state,
  );
  if (typeof instruction.text !== "string") {
    failCanonicalBody("invalid-field", `${path}.text`, "must be an instruction string");
  }
  return {
    templateId: canonicalBodyIdentifier(instruction.templateId, `${path}.templateId`),
    templateVersion: canonicalBodyInteger(
      instruction.templateVersion,
      `${path}.templateVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    digest: canonicalBodySha256Digest(instruction.digest, `${path}.digest`),
    text: instruction.text,
  };
}

function parseRecipeDefinition(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRecipeDefinitionCanonicalV1 {
  const recipe = canonicalBodyRecord(
    value,
    path,
    npAgentRecipeDefinitionCanonicalIncludedKeysV1,
    npAgentRecipeDefinitionCanonicalIncludedKeysV1,
    state,
  );
  const id = canonicalBodyEnum<NpAgentRecipeId>(recipe.id, `${path}.id`, RECIPE_IDS);
  if (recipe.version !== 1) {
    failCanonicalBody("invalid-field", `${path}.version`, "must be 1");
  }
  const allowedTemplates = parseSortedEnumArray<NpAgentRecipeTemplate>({
    value: recipe.allowedTemplates,
    path: `${path}.allowedTemplates`,
    allowed: RECIPE_TEMPLATES,
    maximum: npAgentRecipeTemplates.length,
    state,
  });
  const task = canonicalBodyEnum<NpAgentRecipeTask>(recipe.task, `${path}.task`, RECIPE_TASKS);
  const providerMode = canonicalBodyEnum<NpAgentRecipeProviderMode>(
    recipe.providerMode,
    `${path}.providerMode`,
    RECIPE_PROVIDER_MODES,
  );
  const triggerKinds = parseSortedEnumArray<NpAgentRecipeTriggerKind>({
    value: recipe.triggerKinds,
    path: `${path}.triggerKinds`,
    allowed: RECIPE_TRIGGER_KINDS,
    minimum: 1,
    maximum: npAgentRecipeTriggerKinds.length,
    state,
  });
  const capabilityIds = parseSortedEnumArray<NpAgentCapabilityId>({
    value: recipe.capabilityIds,
    path: `${path}.capabilityIds`,
    allowed: CAPABILITY_IDS,
    minimum: 1,
    maximum: npAgentContractLimits.coreCapabilityDescriptors,
    state,
  });
  const settingsSchema = parseSchema(recipe.settingsSchema, `${path}.settingsSchema`);
  const manualInputSchema =
    recipe.manualInputSchema === null
      ? null
      : parseSchema(recipe.manualInputSchema, `${path}.manualInputSchema`);
  const responseSchema = parseSchema(recipe.responseSchema, `${path}.responseSchema`);
  const instruction =
    recipe.instruction === null
      ? null
      : parseInstruction(recipe.instruction, `${path}.instruction`, state);

  if ((providerMode === "forbidden") !== (instruction === null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.instruction`,
      "must be null exactly when providerMode is forbidden",
    );
  }

  return {
    id,
    version: 1,
    allowedTemplates,
    task,
    providerMode,
    triggerKinds,
    capabilityIds,
    settingsSchema,
    manualInputSchema,
    responseSchema,
    instruction,
  };
}

function parseRecipeRegistryCanonical(value: unknown): NpAgentRecipeRegistryCanonicalV1 {
  const path = "agent.canonical.recipeRegistry";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const body = canonicalBodyRecord(
    cloneInput(value),
    path,
    npAgentRecipeRegistryCanonicalIncludedKeysV1,
    npAgentRecipeRegistryCanonicalIncludedKeysV1,
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
  const recipeValues = canonicalBodyArray(
    body.recipes,
    `${path}.recipes`,
    npAgentContractLimits.coreRecipeDefinitions,
    state,
  );
  if (recipeValues.length === 0) {
    failCanonicalBody("invalid-field", `${path}.recipes`, "must contain at least one recipe");
  }
  if (projection === "definition" && recipeValues.length !== 1) {
    failCanonicalBody(
      "invalid-field",
      `${path}.recipes`,
      "definition projection must contain exactly one recipe",
    );
  }

  const recipes = recipeValues.map((recipe, index) =>
    parseRecipeDefinition(recipe, `${path}.recipes[${index.toString()}]`, state),
  );
  let previous: NpAgentRecipeDefinitionCanonicalV1 | undefined;
  recipes.forEach((recipe, index) => {
    if (
      previous !== undefined &&
      (recipe.id < previous.id || (recipe.id === previous.id && recipe.version <= previous.version))
    ) {
      failCanonicalBody(
        recipe.id === previous.id && recipe.version === previous.version ? "duplicate" : "order",
        `${path}.recipes[${index.toString()}]`,
        "must be sorted unique by (id,version)",
      );
    }
    previous = recipe;
  });

  const result: NpAgentRecipeRegistryCanonicalV1 = {
    schemaVersion: PURPOSE,
    projection,
    recipes,
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentRecipeRegistryCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentRecipeRegistryCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.recipeRegistry", () =>
    parseRecipeRegistryCanonical(value),
  );
}

export function npRequireAgentRecipeRegistryCanonical(
  value: unknown,
): NpAgentRecipeRegistryCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRecipeRegistryCanonical(value),
    "Invalid Agent recipe-registry canonical body",
  );
}

function parseInstalledRecipes(installedRecipes: unknown): NpAgentRecipeRegistryCanonicalV1 {
  return parseRecipeRegistryCanonical({
    schemaVersion: PURPOSE,
    projection: "registry",
    recipes: installedRecipes,
  });
}

export function npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(
  value: unknown,
  installedRecipes: unknown,
): NpAgentRecipeRegistryCanonicalV1 {
  const body = parseRecipeRegistryCanonical(value);
  const installedRegistry = parseInstalledRecipes(installedRecipes);
  requireAgentCanonicalRegistryCompleteness({
    purpose: PURPOSE,
    projection: body.projection,
    entries: body.recipes,
    installedEntries: installedRegistry.recipes,
    entryId: (recipe) => `${recipe.id}\0${recipe.version.toString()}`,
    entryLabel: "recipe",
  });
  return body;
}

export function npBuildAgentRecipeRegistryCanonicalBytes(
  value: unknown,
  installedRecipes: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-recipe-registry.v1", NpAgentRecipeRegistryCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(value, installedRecipes),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-recipe-registry.v1",
    NpAgentRecipeRegistryCanonicalV1
  >;
}

export async function npDigestAgentRecipeRegistryCanonical(
  value: unknown,
  installedRecipes: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentRecipeRegistryCanonicalBytes(value, installedRecipes).domainSeparatedUtf8,
  );
}
