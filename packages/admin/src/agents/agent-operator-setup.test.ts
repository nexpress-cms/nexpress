import { describe, expect, it } from "vitest";
import {
  npAgentOperatorRecipeSetupV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";
import { operatorSetupAvailable, operatorSetupDefinition } from "./agent-operator-setup.js";

function catalog(): NpAgentRuntimeStudioCatalogV1 {
  const setup = npAgentOperatorRecipeSetupV1;
  return {
    schemaVersion: "np.agent-runtime-catalog.v1",
    recipes: [
      {
        id: setup.recipeId,
        version: 1,
        allowedTemplates: ["operator"],
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

describe("Operator diagnostic draft setup", () => {
  it("requires the installed recipe and every live scope and capability mode", () => {
    const value = catalog();
    expect(operatorSetupAvailable(value)).toBe(true);
    expect(operatorSetupAvailable({ ...value, recipes: [] })).toBe(false);
    expect(operatorSetupAvailable({ ...value, scopes: [] })).toBe(false);
    expect(operatorSetupAvailable({ ...value, capabilities: [] })).toBe(false);
    expect(() => operatorSetupDefinition({ ...value, capabilities: [] }, "Draft")).toThrow(
      "unavailable",
    );
  });

  it("clamps budget ceilings and minimum cooldown without choosing a provider or execution authority", () => {
    const value = catalog();
    value.effectiveBudget.runsPerHour = 0;
    value.effectiveBudget.incidentAnalysisCooldownSeconds = 3600;
    const result = operatorSetupDefinition(value, "My Operator");
    expect(result.name).toBe("My Operator");
    expect(result.budget.runsPerHour).toBe(0);
    expect(result.budget.incidentAnalysisCooldownSeconds).toBe(3600);
    expect(result.budget.directActionsPerHour).toBe(0);
    expect(result.modelConnectionId).toBeNull();
    expect(result.model).toBeNull();
    expect(result.scopes).not.toContain("ops:execute");
    expect(
      result.capabilityModes.some((entry) => entry.mode === "approved" || entry.mode === "guarded"),
    ).toBe(false);
    result.scopes.length = 0;
    expect(operatorSetupAvailable(value)).toBe(true);
  });
});
