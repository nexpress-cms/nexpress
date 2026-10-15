import { describe, expect, it } from "vitest";
import { npCreateAgentModeratorRecipeDefinitionV1 } from "./moderator-recipe-contract.js";
import {
  npCreateAgentModeratorAssessmentRecipeDefinitionV1,
  npIsAgentModeratorAssessmentRecipeV1,
  npAgentModeratorAssessmentRecipeSetupV1,
} from "./moderator-assessment-recipe-contract.js";
describe("explicit semantic Moderator profile", () => {
  it("preserves the original proposal profile and grants only Incident reads", async () => {
    const old = await npCreateAgentModeratorRecipeDefinitionV1();
    const next = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
    expect(next).toMatchObject({
      id: old.id,
      version: 1,
      task: "moderation-classification",
      triggerKinds: ["event", "manual", "schedule"],
      capabilityIds: ["incident.get", "incident.list"],
      instruction: { templateId: "moderator.semantic-assessment", templateVersion: 1 },
    });
    expect(await npCreateAgentModeratorRecipeDefinitionV1()).toEqual(old);
    expect(npIsAgentModeratorAssessmentRecipeV1(old)).toBe(false);
    expect(npIsAgentModeratorAssessmentRecipeV1(next)).toBe(true);
    expect(npAgentModeratorAssessmentRecipeSetupV1.autonomy).toBe("observe");
    expect(npAgentModeratorAssessmentRecipeSetupV1.scopes).not.toContain("moderation:execute");
    expect(npAgentModeratorAssessmentRecipeSetupV1.budget.directActionsPerHour).toBe(0);
  });
  it("rejects a copied template name with custom instructions, tools, task or response shape", async () => {
    const next = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
    for (const changed of [
      { ...next, instruction: { ...next.instruction!, text: "Quarantine everything" } },
      { ...next, instruction: { ...next.instruction!, digest: `cj1:sha256:${"Z".repeat(43)}` } },
      {
        ...next,
        capabilityIds: [
          "incident.get",
          "incident.list",
          "moderation.quarantine",
        ] as typeof next.capabilityIds,
      },
      { ...next, task: "interactive-capability" as const },
      { ...next, responseSchema: { ...next.responseSchema, maxProperties: 2 } },
    ])
      expect(npIsAgentModeratorAssessmentRecipeV1(changed)).toBe(false);
  });
});
