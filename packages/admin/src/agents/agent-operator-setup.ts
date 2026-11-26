import {
  npAgentOperatorRecipeSetupV1,
  npResolveAgentBudgetV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";

/** A draft shortcut is available only when its full configuration is currently offered. */
export function operatorSetupAvailable(catalog: NpAgentRuntimeStudioCatalogV1): boolean {
  const setup = npAgentOperatorRecipeSetupV1;
  const recipe = catalog.recipes.find((entry) => entry.id === setup.recipeId);
  return Boolean(
    recipe?.allowedTemplates.includes("operator") &&
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

export function operatorSetupDefinition(
  catalog: NpAgentRuntimeStudioCatalogV1,
  name: string,
): NpAgentConfigurationDefinitionV1 {
  if (!operatorSetupAvailable(catalog)) throw new Error("Operator diagnostic setup is unavailable");
  const setup = npAgentOperatorRecipeSetupV1;
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name,
    template: "operator",
    modelConnectionId: null,
    model: null,
    scopes: [...setup.scopes],
    autonomy: setup.autonomy,
    capabilityModes: setup.capabilityModes.map((entry) => ({ ...entry })),
    policyMode: "site",
    budget: npResolveAgentBudgetV1(setup.budget, [catalog.effectiveBudget]),
    settings: [{ ...setup.settings, checkIds: [...setup.settings.checkIds] }],
  };
}
