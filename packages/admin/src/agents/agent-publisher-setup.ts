import {
  npAgentPublisherRecipeSetupV1,
  npResolveAgentBudgetV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";

/** A draft shortcut is available only when its full configuration is currently offered. */
export function publisherSetupAvailable(catalog: NpAgentRuntimeStudioCatalogV1): boolean {
  const setup = npAgentPublisherRecipeSetupV1;
  const recipe = catalog.recipes.find((entry) => entry.id === setup.recipeId);
  return Boolean(
    recipe?.allowedTemplates.includes("publisher") &&
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

export function publisherSetupDefinition(
  catalog: NpAgentRuntimeStudioCatalogV1,
  name: string,
): NpAgentConfigurationDefinitionV1 {
  if (!publisherSetupAvailable(catalog))
    throw new Error("Publisher content review setup is unavailable");
  const setup = npAgentPublisherRecipeSetupV1;
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name,
    template: "publisher",
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
