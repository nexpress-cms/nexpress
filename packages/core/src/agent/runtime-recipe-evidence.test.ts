import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npDigestAgentRecipeRegistryCanonical } from "../agent-contract/canonical-recipe-registry.js";
import {
  npCreateAgentR6UnattendedRecipeRegistryV1,
  npCreateAgentR6UnattendedRecipeRegistryV2,
  npCreateAgentR6UnattendedRecipeRegistryV3,
  npCreateAgentR6AssessmentRecipeRegistryV1,
  npCreateAgentR6AssessmentRecipeRegistryV2,
} from "../agent-contract/r6-recipe-registry.js";
import { npRequireAgentRuntimeRecipeEvidenceV1 } from "./runtime-recipe-evidence.js";

describe("Current Runtime recipe evidence", () => {
  it("matches the public contextual canonical fingerprints for complete unattended and assessment profiles", async () => {
    for (const factory of [
      npCreateAgentR6UnattendedRecipeRegistryV1,
      npCreateAgentR6UnattendedRecipeRegistryV2,
      npCreateAgentR6UnattendedRecipeRegistryV3,
      npCreateAgentR6AssessmentRecipeRegistryV1,
      npCreateAgentR6AssessmentRecipeRegistryV2,
    ]) {
      const registry = await factory();
      const evidence = npRequireAgentRuntimeRecipeEvidenceV1(registry);
      expect(evidence.registry).toEqual(registry);
      expect(evidence.registryFingerprint).toBe(
        await npDigestAgentRecipeRegistryCanonical(registry, registry.recipes),
      );
      for (const { recipe, fingerprint } of evidence.definitions)
        expect(fingerprint).toBe(
          await npDigestAgentRecipeRegistryCanonical(
            { ...registry, projection: "definition", recipes: [recipe] },
            registry.recipes,
          ),
        );
    }
  });

  it("checks the entire registry and requires a complete registry projection", async () => {
    const registry = await npCreateAgentR6UnattendedRecipeRegistryV2();
    expect(() =>
      npRequireAgentRuntimeRecipeEvidenceV1({
        ...registry,
        projection: "definition",
        recipes: [registry.recipes[2]],
      }),
    ).toThrow();
    const malformed = structuredClone(registry);
    malformed.recipes[0].responseSchema.properties = { unbounded: { type: "string" } };
    expect(() => npRequireAgentRuntimeRecipeEvidenceV1(malformed)).toThrow();
    expect(() =>
      npRequireAgentRuntimeRecipeEvidenceV1({
        ...registry,
        recipes: [...registry.recipes].reverse(),
      }),
    ).toThrow();
  });

  it("revalidates changed sibling bodies and keeps prior evidence separate from mutable inputs", async () => {
    const registry = await npCreateAgentR6UnattendedRecipeRegistryV2();
    const before = npRequireAgentRuntimeRecipeEvidenceV1(registry);
    const instruction = registry.recipes[1].instruction!;
    instruction.text += "\nA new explicit installation.";
    instruction.digest = `cj1:sha256:${createHash("sha256").update(instruction.text).digest("base64url")}`;
    const after = npRequireAgentRuntimeRecipeEvidenceV1(registry);
    expect(after.registryFingerprint).not.toBe(before.registryFingerprint);
    expect(after.definitions[1].fingerprint).not.toBe(before.definitions[1].fingerprint);
    expect(after.definitions[2].fingerprint).toBe(before.definitions[2].fingerprint);
    expect(before.registry).not.toEqual(registry);
    registry.recipes[1].instruction!.templateVersion = 0;
    expect(() => npRequireAgentRuntimeRecipeEvidenceV1(registry)).toThrow();
  });
});
