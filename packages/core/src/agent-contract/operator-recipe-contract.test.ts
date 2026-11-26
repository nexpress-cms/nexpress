import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  npAgentOperatorRecipeSetupV1,
  npCreateAgentOperatorRecipeDefinitionV1,
} from "./operator-recipe-contract.js";
import { npRequireAgentConfigurationDefinitionV1 } from "./runtime-contract.js";
import { npRequireAgentBudgetV1 } from "./wire-contract.js";
import { npAgentOpsPlanInputSchemaV1 } from "./operator-capability-contract.js";

describe("shipped Operator diagnostic recipe v1", () => {
  it("creates a canonical manual-only provider recipe with intact instruction digest", async () => {
    const recipe = await npCreateAgentOperatorRecipeDefinitionV1();
    expect(recipe).toMatchObject({
      id: "operator.worker-not-draining",
      task: "interactive-capability",
      providerMode: "required",
      triggerKinds: ["manual"],
      manualInputSchema: null,
      capabilityIds: ["audit.run", "ops.plan", "ops.status"],
    });
    expect(recipe.instruction?.digest).toBe(
      `cj1:sha256:${createHash("sha256").update(recipe.instruction!.text).digest("base64url")}`,
    );
    expect(recipe.instruction?.text).toContain("Do not execute a plan");
    npRequireAgentProviderSchemaValueV1(
      recipe.settingsSchema,
      npAgentOperatorRecipeSetupV1.settings,
    );
    for (const decision of [
      { kind: "complete", summary: "Unknown observation, no action justified." },
      {
        kind: "propose-capability",
        capabilityId: "ops.status",
        rationale: "Observe",
        arguments: { families: ["jobs"] },
      },
      {
        kind: "propose-capability",
        capabilityId: "audit.run",
        rationale: "Inspect",
        arguments: { families: ["jobs"], collections: [], maxTargets: 5 },
      },
      {
        kind: "propose-capability",
        capabilityId: "ops.plan",
        rationale: "Plan",
        arguments: { action: "migration.plan", target: { kind: "site" } },
      },
    ])
      npRequireAgentProviderSchemaValueV1(
        recipe.responseSchema,
        JSON.parse(JSON.stringify({ task: "interactive-capability", decision })),
      );
    expect(() =>
      npRequireAgentProviderSchemaValueV1(recipe.responseSchema, {
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "ops.execute",
          rationale: "Execute",
          arguments: {},
        },
      }),
    ).toThrow();
  });
  it("preserves a valid draft without selecting a provider or granting execution", () => {
    const setup = npAgentOperatorRecipeSetupV1;
    expect(npRequireAgentBudgetV1(setup.budget, { requireConcrete: true })).toEqual(setup.budget);
    const definition = npRequireAgentConfigurationDefinitionV1({
      schemaVersion: "np.agent-configuration-definition.v1",
      name: "Operator",
      template: "operator",
      modelConnectionId: null,
      model: null,
      scopes: setup.scopes,
      autonomy: setup.autonomy,
      capabilityModes: setup.capabilityModes,
      policyMode: "site",
      budget: setup.budget,
      settings: [setup.settings],
    });
    expect(definition.budget.directActionsPerHour).toBe(0);
    expect(definition.capabilityModes).not.toContainEqual(
      expect.objectContaining({ capabilityId: "ops.execute" }),
    );
  });
  it("reuses the actual plan input schema and returns isolated factory results", async () => {
    const first = await npCreateAgentOperatorRecipeDefinitionV1();
    expect(JSON.stringify(first.responseSchema)).toContain(
      JSON.stringify(npAgentOpsPlanInputSchemaV1),
    );
    first.capabilityIds.push("ops.execute");
    first.instruction!.text = "tampered";
    const second = await npCreateAgentOperatorRecipeDefinitionV1();
    expect(second.capabilityIds).not.toContain("ops.execute");
    expect(second.instruction!.text).not.toBe("tampered");
  });
});
