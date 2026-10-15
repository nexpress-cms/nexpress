import { npRequireAgentRecipeRegistryCanonical } from "./canonical-recipe-registry.js";
import { npCreateAgentModeratorRecipeDefinitionV1 } from "./moderator-recipe-contract.js";
import { npCreateAgentModeratorAssessmentRecipeDefinitionV1 } from "./moderator-assessment-recipe-contract.js";
import { npCreateAgentOperatorRecipeDefinitionV1 } from "./operator-recipe-contract.js";
import {
  npCreateAgentPublisherRecipeDefinitionV1,
  npCreateAgentPublisherUncertaintyRecipeDefinitionV1,
  npCreateAgentPublisherSelectionRecipeDefinitionV1,
} from "./publisher-recipe-contract.js";
import type { NpAgentRecipeRegistryCanonicalV1 } from "./types.js";

/**
 * Explicit host-owned installation profile; creating it installs no service or trigger.
 * Only trigger eligibility differs from the shipped manual definitions. Its exact
 * definition/registry fingerprints remain separate, and an existing Agent must
 * save a new draft and explicitly activate it to adopt this profile.
 */
export async function npCreateAgentR6UnattendedRecipeRegistryV1(): Promise<NpAgentRecipeRegistryCanonicalV1> {
  const recipes = await Promise.all([
    npCreateAgentModeratorRecipeDefinitionV1(),
    npCreateAgentOperatorRecipeDefinitionV1(),
    npCreateAgentPublisherRecipeDefinitionV1(),
  ]);
  for (const recipe of recipes)
    recipe.triggerKinds =
      recipe.id === "moderator.repeated-link-spam"
        ? ["event", "manual", "schedule"]
        : ["manual", "schedule"];
  recipes.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return npRequireAgentRecipeRegistryCanonical({
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "registry",
    recipes,
  });
}

/** Explicit source/selection profile; adoption never edits or activates existing Agent versions. */
export async function npCreateAgentR6UnattendedRecipeRegistryV3(): Promise<NpAgentRecipeRegistryCanonicalV1> {
  const profile = await npCreateAgentR6UnattendedRecipeRegistryV2();
  const publisher = await npCreateAgentPublisherSelectionRecipeDefinitionV1();
  publisher.triggerKinds = ["manual", "schedule"];
  profile.recipes = profile.recipes.map((recipe) =>
    recipe.id === publisher.id
      ? publisher
      : recipe.id === "operator.worker-not-draining"
        ? { ...recipe, triggerKinds: ["event", "manual", "schedule"] }
        : recipe,
  );
  return npRequireAgentRecipeRegistryCanonical(profile);
}

/** Host-selected read-only Moderator alternative; never expands an existing Agent's authority. */
export async function npCreateAgentR6AssessmentRecipeRegistryV1(): Promise<NpAgentRecipeRegistryCanonicalV1> {
  const profile = await npCreateAgentR6UnattendedRecipeRegistryV3();
  const moderator = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
  profile.recipes = profile.recipes.map((recipe) =>
    recipe.id === moderator.id ? moderator : recipe,
  );
  return npRequireAgentRecipeRegistryCanonical(profile);
}

/** Explicit updated instruction profile; V1 installations and saved Run snapshots remain unchanged. */
export async function npCreateAgentR6UnattendedRecipeRegistryV2(): Promise<NpAgentRecipeRegistryCanonicalV1> {
  const profile = await npCreateAgentR6UnattendedRecipeRegistryV1();
  const publisher = await npCreateAgentPublisherUncertaintyRecipeDefinitionV1();
  publisher.triggerKinds = ["manual", "schedule"];
  profile.recipes = profile.recipes.map((recipe) =>
    recipe.id === publisher.id ? publisher : recipe,
  );
  return npRequireAgentRecipeRegistryCanonical(profile);
}
