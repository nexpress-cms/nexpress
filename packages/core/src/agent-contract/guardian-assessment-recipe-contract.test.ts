import { describe, expect, it } from "vitest";
import {
  npCreateAgentGuardianAssessmentRecipeDefinitionV1,
  npCreateAgentGuardianAssessmentRecipeSetupV1,
  npIsAgentGuardianAssessmentRecipeV1,
} from "./guardian-assessment-recipe-contract.js";

describe("exact manual Guardian advisory profiles", () => {
  it.each(["guardian.credential-stuffing", "guardian.agent-abuse"] as const)(
    "installs no effect authority in %s",
    async (id) => {
      const recipe = await npCreateAgentGuardianAssessmentRecipeDefinitionV1(id);
      expect(npIsAgentGuardianAssessmentRecipeV1(recipe)).toBe(true);
      expect(recipe).toMatchObject({
        task: "guardian-assessment",
        providerMode: "required",
        triggerKinds: ["manual"],
        manualInputSchema: null,
        capabilityIds: ["incident.get", "incident.list"],
      });
      const setup = npCreateAgentGuardianAssessmentRecipeSetupV1(id);
      expect(setup.autonomy).toBe("observe");
      expect(setup.scopes).toEqual(["incident:read", "site:read"]);
      expect(setup.budget).toMatchObject({
        directActionsPerHour: 0,
        directActionsPerSubjectPerHour: 0,
      });
      for (const change of [
        { ...recipe, triggerKinds: ["event"] },
        { ...recipe, providerMode: "optional" },
        { ...recipe, capabilityIds: ["security.limitActor"] },
        { ...recipe, instruction: { ...recipe.instruction!, text: "Attacker-selected policy" } },
        {
          ...recipe,
          instruction: { ...recipe.instruction!, digest: `cj1:sha256:${"A".repeat(43)}` },
        },
        { ...recipe, responseSchema: { type: "object" } },
        { ...recipe, settingsSchema: { type: "object" } },
      ])
        expect(npIsAgentGuardianAssessmentRecipeV1(change as typeof recipe)).toBe(false);
    },
  );
});
