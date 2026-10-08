import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { npRequireAgentModeratorSettingsV1 } from "./moderator-contract.js";
import {
  npAgentModeratorRecipeSetupV1,
  npCreateAgentModeratorRecipeDefinitionV1,
} from "./moderator-recipe-contract.js";
import { npRequireAgentConfigurationDefinitionV1 } from "./runtime-contract.js";
import type { NpAgentJsonObject } from "./types.js";

const id = "11111111-1111-4111-8111-111111111111";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const proposal = {
  incidentId: id,
  target: { kind: "comment", collection: "posts", id },
  expectedVersionDigest: digest,
  reasonCode: "REPEATED_LINK_SPAM",
};

describe("shipped Moderator human approval recipe", () => {
  it("allows only manual quarantine proposals and completion, never approved execution or restore", async () => {
    const recipe = await npCreateAgentModeratorRecipeDefinitionV1();
    expect(recipe).toMatchObject({
      allowedTemplates: ["moderator"],
      task: "interactive-capability",
      providerMode: "required",
      triggerKinds: ["manual"],
      manualInputSchema: null,
      capabilityIds: ["moderation.quarantine"],
    });
    expect(recipe.instruction!.digest).toBe(
      `cj1:sha256:${createHash("sha256").update(recipe.instruction!.text).digest("base64url")}`,
    );
    const decision = {
      kind: "propose-capability",
      capabilityId: "moderation.quarantine",
      rationale: "Review the exact admitted candidate.",
      arguments: { mode: "propose", proposal },
    };
    for (const accepted of [decision, { kind: "complete", summary: "Evidence is incomplete." }])
      npRequireAgentProviderSchemaValueV1(recipe.responseSchema, {
        task: "interactive-capability",
        decision: accepted,
      });
    const deniedDecisions: NpAgentJsonObject[] = [
      { ...decision, capabilityId: "moderation.restore" },
      {
        ...decision,
        arguments: { mode: "execute_approved", actionId: id, approvalId: id, proposalHash: digest },
      },
      {
        ...decision,
        arguments: { mode: "propose", proposal: { ...proposal, privateEvidence: "hidden" } },
      },
      {
        ...decision,
        arguments: { mode: "propose", proposal: { ...proposal, expectedVersionDigest: "guessed" } },
      },
    ];
    for (const denied of deniedDecisions)
      expect(() =>
        npRequireAgentProviderSchemaValueV1(recipe.responseSchema, {
          task: "interactive-capability",
          decision: denied,
        }),
      ).toThrow();
    recipe.capabilityIds.push("moderation.restore");
    expect((await npCreateAgentModeratorRecipeDefinitionV1()).capabilityIds).toEqual([
      "moderation.quarantine",
    ]);
  });

  it("requires explicit collections and enforces settings accepted by the actual Moderator evaluator", async () => {
    const recipe = await npCreateAgentModeratorRecipeDefinitionV1();
    const setup = npAgentModeratorRecipeSetupV1;
    const settings = { ...setup.settings, collectionSlugs: ["posts"] };
    npRequireAgentProviderSchemaValueV1(recipe.settingsSchema, settings);
    expect(npRequireAgentModeratorSettingsV1(settings)).toEqual(settings);
    for (const invalid of [
      setup.settings,
      { ...settings, windowSeconds: 3600 },
      { ...settings, minIndependentAccounts: 1 },
      { ...settings, minItems: 101 },
      { ...settings, collectionSlugs: ["posts", "posts"] },
    ])
      expect(() => npRequireAgentProviderSchemaValueV1(recipe.settingsSchema, invalid)).toThrow();
    const definition = npRequireAgentConfigurationDefinitionV1({
      schemaVersion: "np.agent-configuration-definition.v1",
      name: "Moderator",
      template: "moderator",
      modelConnectionId: null,
      model: null,
      scopes: setup.scopes,
      autonomy: setup.autonomy,
      capabilityModes: setup.capabilityModes,
      policyMode: "site",
      budget: setup.budget,
      settings: [settings],
    });
    expect(definition.modelConnectionId).toBeNull();
    expect(definition.autonomy).toBe("approved");
    expect(definition.scopes).toEqual(["incident:read", "moderation:execute", "site:read"]);
    expect(definition.budget.attemptsPerRun).toBeGreaterThanOrEqual(3);
    expect(definition.budget.providerCallsPerRun).toBeGreaterThanOrEqual(2);
    expect(definition.budget.capabilityCallsPerRun).toBe(1);
  });
});
