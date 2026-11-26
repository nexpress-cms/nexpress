import {
  npAgentModeratorRecipeSetupV1,
  npAgentModeratorAssessmentRecipeSetupV1,
  npResolveAgentBudgetV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";

/** A draft shortcut is available only when its full configuration is currently offered. */
export function moderatorSetupAvailable(catalog: NpAgentRuntimeStudioCatalogV1): boolean {
  const setup = npAgentModeratorRecipeSetupV1;
  const recipe = catalog.recipes.find((entry) => entry.id === setup.recipeId);
  return Boolean(
    recipe?.version === 1 &&
    recipe.allowedTemplates.includes("moderator") &&
    recipe.providerMode === "required" &&
    (recipe.triggerKinds.join(",") === "manual" ||
      recipe.triggerKinds.join(",") === "event,manual,schedule") &&
    setup.scopes.every((scope) => catalog.scopes.includes(scope)) &&
    setup.capabilityModes.every(
      ({ capabilityId, mode }) =>
        recipe.capabilityIds.includes(capabilityId) &&
        catalog.capabilities.some(
          (entry) => entry.id === capabilityId && entry.modes.includes(mode),
        ),
    ),
  );
}

/** The read-only profile has its own explicit draft with no moderation effects. */
export function moderatorAssessmentSetupAvailable(catalog: NpAgentRuntimeStudioCatalogV1): boolean {
  const setup = npAgentModeratorAssessmentRecipeSetupV1;
  const recipe = catalog.recipes.find((entry) => entry.id === setup.recipeId);
  return Boolean(
    recipe?.version === 1 &&
    recipe.allowedTemplates.includes("moderator") &&
    recipe.providerMode === "required" &&
    recipe.capabilityIds.join(",") === "incident.get,incident.list" &&
    recipe.triggerKinds.includes("manual") &&
    setup.scopes.every((scope) => catalog.scopes.includes(scope)) &&
    setup.capabilityModes.every(({ capabilityId, mode }) =>
      catalog.capabilities.some((entry) => entry.id === capabilityId && entry.modes.includes(mode)),
    ),
  );
}
export function moderatorAssessmentSetupDefinition(
  catalog: NpAgentRuntimeStudioCatalogV1,
  name: string,
): NpAgentConfigurationDefinitionV1 {
  if (!moderatorAssessmentSetupAvailable(catalog))
    throw new Error("Moderator semantic assessment setup is unavailable");
  const setup = npAgentModeratorAssessmentRecipeSetupV1;
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name,
    template: "moderator",
    modelConnectionId: null,
    model: null,
    scopes: [...setup.scopes],
    autonomy: setup.autonomy,
    capabilityModes: setup.capabilityModes.map((entry) => ({ ...entry })),
    policyMode: "site",
    budget: npResolveAgentBudgetV1(setup.budget, [catalog.effectiveBudget]),
    settings: [{ ...setup.settings, collectionSlugs: [] }],
  };
}

export function moderatorSetupDefinition(
  catalog: NpAgentRuntimeStudioCatalogV1,
  name: string,
): NpAgentConfigurationDefinitionV1 {
  if (!moderatorSetupAvailable(catalog))
    throw new Error("Moderator human approval setup is unavailable");
  const setup = npAgentModeratorRecipeSetupV1;
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name,
    template: "moderator",
    modelConnectionId: null,
    model: null,
    scopes: [...setup.scopes],
    autonomy: setup.autonomy,
    capabilityModes: setup.capabilityModes.map((entry) => ({ ...entry })),
    policyMode: "site",
    budget: npResolveAgentBudgetV1(setup.budget, [catalog.effectiveBudget]),
    settings: [{ ...setup.settings, collectionSlugs: [...setup.settings.collectionSlugs] }],
  };
}
