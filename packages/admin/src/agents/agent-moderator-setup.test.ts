import { describe, expect, it } from "vitest";
import {
  npAgentModeratorRecipeSetupV1,
  npAgentModeratorAssessmentRecipeSetupV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  type NpAgentRuntimeStudioCatalogV1,
} from "@nexpress/core/agent-contract";
import {
  moderatorSetupAvailable,
  moderatorSetupDefinition,
  moderatorAssessmentSetupAvailable,
  moderatorAssessmentSetupDefinition,
} from "./agent-moderator-setup.js";

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
  it("offers a separate read-only draft only for the installed assessment surface", () => {
    const value = catalog();
    expect(moderatorAssessmentSetupAvailable(value)).toBe(false);
    const setup = npAgentModeratorAssessmentRecipeSetupV1;
    value.scopes = [...setup.scopes];
    value.recipes[0].capabilityIds = setup.capabilityModes.map((entry) => entry.capabilityId);
    value.capabilities = setup.capabilityModes.map(({ capabilityId, mode }) => ({
      id: capabilityId,
      modes: [mode],
    }));
    expect(moderatorAssessmentSetupAvailable(value)).toBe(true);
    expect(moderatorSetupAvailable(value)).toBe(false);
    const draft = moderatorAssessmentSetupDefinition(value, "Review");
    expect(draft.autonomy).toBe("observe");
    expect(draft.capabilityModes).toEqual([
      { capabilityId: "incident.get", mode: "observe" },
      { capabilityId: "incident.list", mode: "observe" },
    ]);
    expect(draft.budget.directActionsPerHour).toBe(0);
    expect(draft.modelConnectionId).toBeNull();
    expect(moderatorAssessmentSetupAvailable({ ...value, capabilities: [] })).toBe(false);
  });
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

  it("supports the explicit unattended profile while rejecting unsupported trigger subsets", () => {
    const value = catalog();
    value.recipes[0].triggerKinds = ["event", "manual", "schedule"];
    expect(moderatorSetupAvailable(value)).toBe(true);
    expect(moderatorSetupDefinition(value, "Review").autonomy).toBe("approved");
    value.recipes[0].triggerKinds = ["event"];
    expect(moderatorSetupAvailable(value)).toBe(false);
    value.recipes[0].triggerKinds = ["manual", "schedule"];
    expect(moderatorSetupAvailable(value)).toBe(false);
  });
});
