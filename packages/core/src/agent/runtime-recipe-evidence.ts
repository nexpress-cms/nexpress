import { createHash } from "node:crypto";
import { buildAgentCanonicalFoundationBytes } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentRecipeRegistryCanonical } from "../agent-contract/canonical-recipe-registry.js";
import type { NpAgentRecipeRegistryCanonicalV1 } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";

const purpose = "np.agent-recipe-registry.v1";

/** Internal retained-registry evidence, rebuilt from the current row on every read. */
export function npRequireAgentRuntimeRecipeEvidenceV1(value: unknown) {
  const registry = npRequireAgentRecipeRegistryCanonical(value);
  if (registry.projection !== "registry")
    throw new NpAgentGatewayError(
      "RUNTIME_DEFINITION_INVALID",
      409,
      "Agent runtime operation is unavailable.",
    );
  const digest = (body: NpAgentRecipeRegistryCanonicalV1): `cj1:sha256:${string}` => {
    const bytes = buildAgentCanonicalFoundationBytes(purpose, body);
    return `cj1:sha256:${createHash("sha256").update(bytes.domainSeparatedUtf8).digest("base64url")}`;
  };
  // The parser has checked the whole registry, including ordering and schemas.
  // Each definition is an exact member of that same normalized snapshot. Avoid
  // reparsing both it and all its installed siblings for each fingerprint.
  return {
    registry,
    registryFingerprint: digest(registry),
    definitions: registry.recipes.map((recipe) => ({
      recipe,
      fingerprint: digest({ ...registry, projection: "definition", recipes: [recipe] }),
    })),
  };
}
