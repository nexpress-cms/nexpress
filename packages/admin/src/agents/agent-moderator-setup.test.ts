import { describe, expect, it } from "vitest";
import {
  npAgentModeratorRecipeSetupV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";
import { moderatorSetupAvailable, moderatorSetupDefinition } from "./agent-moderator-setup.js";

function catalog(): NpAgentRuntimeStudioCatalogV1 {
  const setup = npAgentModeratorRecipeSetupV1;
  return {
    schemaVersion: "np.agent-runtime-catalog.v1",
    recipes: [
      {
        id: setup.recipeId,
        version: 1,
        allowedTemplates: ["moderator"],
        providerMode: "required",
        triggerKinds: ["manual"],
        capabilityIds: setup.capabilityModes.map((entry) => entry.capabilityId),
      },
    ],
    scopes: [...setup.scopes],
    capabilities: setup.capabilityModes.map(({ capabilityId, mode }) => ({
      id: capabilityId,
      modes: [mode],
    })),
    connections: [
      { id: "11111111-1111-4111-8111-111111111111", alias: "Existing", models: ["model"] },
    ],
    effectiveBudget: { ...setup.budget },
    defaultPolicyRules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
    selfDelegation: null,
  };
}

describe("Moderator human approval draft setup", () => {
  it("requires the installed recipe and every live scope and capability mode", () => {
    const value = catalog();
    expect(moderatorSetupAvailable(value)).toBe(true);
    expect(moderatorSetupAvailable({ ...value, recipes: [] })).toBe(false);
    expect(moderatorSetupAvailable({ ...value, scopes: [] })).toBe(false);
    expect(moderatorSetupAvailable({ ...value, capabilities: [] })).toBe(false);
    expect(
      moderatorSetupAvailable({
        ...value,
        capabilities: [{ id: "moderation.quarantine", modes: ["guarded"] }],
      }),
    ).toBe(false);
    expect(() => moderatorSetupDefinition({ ...value, capabilities: [] }, "Draft")).toThrow(
      "unavailable",
    );
  });

  it("clamps budgets without choosing a provider, collections or automatic execution", () => {
    const value = catalog();
    value.effectiveBudget.directActionsPerHour = 0;
    value.effectiveBudget.attemptsPerRun = 2;
    value.effectiveBudget.incidentAnalysisCooldownSeconds = 7200;
    const result = moderatorSetupDefinition(value, "My Moderator");
    expect(result.name).toBe("My Moderator");
    expect(result.budget.directActionsPerHour).toBe(0);
    expect(result.budget.attemptsPerRun).toBe(2);
    expect(result.budget.incidentAnalysisCooldownSeconds).toBe(7200);
    expect(result.modelConnectionId).toBeNull();
    expect(result.model).toBeNull();
    expect(result.autonomy).toBe("approved");
    expect(result.capabilityModes).toEqual([
      { capabilityId: "moderation.quarantine", mode: "approved" },
    ]);
    expect(result.settings).toEqual([
      { ...npAgentModeratorRecipeSetupV1.settings, collectionSlugs: [] },
    ]);
    const settings = result.settings[0];
    if (settings.recipeId === "moderator.repeated-link-spam")
      settings.collectionSlugs.push("posts");
    result.scopes.length = 0;
    expect(moderatorSetupAvailable(value)).toBe(true);
    expect(npAgentModeratorRecipeSetupV1.settings.collectionSlugs).toEqual([]);
  });
});
