import { describe, expect, it } from "vitest";
import {
  npDigestAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonical,
  npRequireAgentRecipeRegistryCanonicalForInstalledRecipes,
} from "./canonical-recipe-registry.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { NpAgentCanonicalIncompleteRegistryError } from "./canonical-registry-completeness.js";
import { npCreateAgentModeratorRecipeDefinitionV1 } from "./moderator-recipe-contract.js";
import { npCreateAgentOperatorRecipeDefinitionV1 } from "./operator-recipe-contract.js";
import { npCreateAgentPublisherRecipeDefinitionV1 } from "./publisher-recipe-contract.js";
import {
  npCreateAgentR6UnattendedRecipeRegistryV1,
  npCreateAgentR6UnattendedRecipeRegistryV2,
} from "./r6-recipe-registry.js";
import type {
  NpAgentRecipeDefinitionCanonicalV1,
  NpAgentRecipeRegistryCanonicalV1,
} from "./types.js";

async function manualRegistry(): Promise<NpAgentRecipeRegistryCanonicalV1> {
  return npRequireAgentRecipeRegistryCanonical({
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "registry",
    recipes: await Promise.all([
      npCreateAgentModeratorRecipeDefinitionV1(),
      npCreateAgentOperatorRecipeDefinitionV1(),
      npCreateAgentPublisherRecipeDefinitionV1(),
    ]),
  });
}

function definition(recipe: NpAgentRecipeDefinitionCanonicalV1): NpAgentRecipeRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "definition",
    recipes: [recipe],
  };
}

describe("explicit R6 unattended recipe installation profile", () => {
  it("changes only trigger eligibility and preserves all shipped manual definition bytes", async () => {
    const original = await manualRegistry();
    const originalBytes = serializeAgentCanonicalJson(original);
    const profile = await npCreateAgentR6UnattendedRecipeRegistryV1();
    expect(profile.recipes.map(({ id }) => id)).toEqual([
      "moderator.repeated-link-spam",
      "operator.worker-not-draining",
      "publisher.stale-content",
    ]);
    expect(profile.recipes.map(({ triggerKinds }) => triggerKinds)).toEqual([
      ["event", "manual", "schedule"],
      ["manual", "schedule"],
      ["manual", "schedule"],
    ]);
    for (const [index, recipe] of profile.recipes.entries()) {
      expect(serializeAgentCanonicalJson({ ...recipe, triggerKinds: ["manual"] })).toBe(
        serializeAgentCanonicalJson(original.recipes[index]),
      );
      expect(recipe.version).toBe(1);
      expect(recipe.providerMode).toBe("required");
      expect(recipe.manualInputSchema).toBeNull();
    }
    expect(serializeAgentCanonicalJson(await manualRegistry())).toBe(originalBytes);
  });

  it("binds separate exact profile fingerprints without substituting original installed members", async () => {
    const original = await manualRegistry();
    const profile = await npCreateAgentR6UnattendedRecipeRegistryV1();
    const originalHash = await npDigestAgentRecipeRegistryCanonical(original, original.recipes);
    const profileHash = await npDigestAgentRecipeRegistryCanonical(profile, profile.recipes);
    expect(profileHash).not.toBe(originalHash);
    expect(
      await npDigestAgentRecipeRegistryCanonical(await manualRegistry(), original.recipes),
    ).toBe(originalHash);
    expect(
      await npDigestAgentRecipeRegistryCanonical(
        await npCreateAgentR6UnattendedRecipeRegistryV1(),
        profile.recipes,
      ),
    ).toBe(profileHash);
    for (const [index, recipe] of profile.recipes.entries()) {
      const oldDefinition = definition(original.recipes[index]);
      const profileDefinition = definition(recipe);
      expect(
        await npDigestAgentRecipeRegistryCanonical(profileDefinition, profile.recipes),
      ).not.toBe(await npDigestAgentRecipeRegistryCanonical(oldDefinition, original.recipes));
      await expect(
        npDigestAgentRecipeRegistryCanonical(oldDefinition, profile.recipes),
      ).rejects.toBeInstanceOf(NpAgentCanonicalIncompleteRegistryError);
      await expect(
        npDigestAgentRecipeRegistryCanonical(profileDefinition, original.recipes),
      ).rejects.toBeInstanceOf(NpAgentCanonicalIncompleteRegistryError);
    }
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(original, profile.recipes),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(
        { ...profile, recipes: profile.recipes.slice(0, 2) },
        profile.recipes,
      ),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);
  });

  it("rejects mixed profiles and version changes through the unchanged canonical owner", async () => {
    const original = await manualRegistry();
    const profile = await npCreateAgentR6UnattendedRecipeRegistryV1();
    expect(() =>
      npRequireAgentRecipeRegistryCanonical({
        ...profile,
        recipes: [original.recipes[0], profile.recipes[0]],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentRecipeRegistryCanonical({
        ...profile,
        recipes: [{ ...profile.recipes[0], version: 2 }],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentRecipeRegistryCanonical({
        ...profile,
        recipes: [{ ...profile.recipes[0], scopes: ["admin:manage"] }],
      }),
    ).toThrow();
  });

  it("isolates mutable arrays, instruction and nested schemas across calls and manual factories", async () => {
    const original = serializeAgentCanonicalJson(await manualRegistry());
    const profile = await npCreateAgentR6UnattendedRecipeRegistryV1();
    const profileBytes = serializeAgentCanonicalJson(profile);
    const recipe = profile.recipes[0];
    recipe.triggerKinds.pop();
    recipe.capabilityIds.push("moderation.restore");
    recipe.allowedTemplates.push("custom");
    recipe.instruction!.text = "tampered";
    recipe.settingsSchema.properties = {};
    recipe.responseSchema.properties = {};
    profile.recipes.pop();
    expect(serializeAgentCanonicalJson(await npCreateAgentR6UnattendedRecipeRegistryV1())).toBe(
      profileBytes,
    );
    expect(serializeAgentCanonicalJson(await manualRegistry())).toBe(original);
  });
  it("selects uncertainty instructions only through the distinct V2 host profile", async () => {
    const original = await npCreateAgentR6UnattendedRecipeRegistryV1();
    const bytes = serializeAgentCanonicalJson(original);
    const current = await npCreateAgentR6UnattendedRecipeRegistryV2();
    expect(current.recipes.slice(0, 2)).toEqual(original.recipes.slice(0, 2));
    const publisher = current.recipes[2];
    expect({ ...publisher, instruction: original.recipes[2].instruction }).toEqual(
      original.recipes[2],
    );
    expect(publisher.version).toBe(1);
    expect(publisher.instruction?.templateVersion).toBe(2);
    expect(publisher.instruction?.digest).not.toBe(original.recipes[2].instruction?.digest);
    expect(await npDigestAgentRecipeRegistryCanonical(current, current.recipes)).not.toBe(
      await npDigestAgentRecipeRegistryCanonical(original, original.recipes),
    );
    expect(() =>
      npRequireAgentRecipeRegistryCanonicalForInstalledRecipes(original, current.recipes),
    ).toThrow(NpAgentCanonicalIncompleteRegistryError);
    expect(serializeAgentCanonicalJson(await npCreateAgentR6UnattendedRecipeRegistryV1())).toBe(
      bytes,
    );
    publisher.instruction!.text = "tampered";
    expect(
      (await npCreateAgentR6UnattendedRecipeRegistryV2()).recipes[2].instruction?.text,
    ).not.toBe("tampered");
  });
});
