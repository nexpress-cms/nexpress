import { describe, expect, it } from "vitest";
import {
  npAnalyzeAgentConfigurationDefinitionV1,
  npAnalyzeAgentPolicyDefinitionV1,
  npAnalyzeAgentRecipeSettingsV1,
  npAnalyzeAgentRuntimeSettingsV1,
  npAnalyzeAgentRuntimeAdmissionSourcesV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
  npRequireAgentConfigurationDefinitionV1,
  npRequireAgentRuntimeSettingsV1,
  npRequireAgentRuntimeAdmissionSourcesV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRecipeSettingsV1,
  type NpAgentRuntimeAdmissionSourcesV1,
} from "./runtime-contract.js";
import { npAgentBudgetDimensionKeysV1 } from "./wire-contract.js";
import {
  npRequireAgentPolicyCanonical,
  npRequireAgentPolicyRulesV1,
} from "./canonical-notification-policy.js";

const recipes: NpAgentRecipeSettingsV1[] = [
  {
    recipeId: "guardian.agent-abuse",
    recipeVersion: 1,
    windowSeconds: 60,
    deniedScopeThreshold: 1,
    repeatedProposalThreshold: 1,
    costVelocityMicros: 0,
    actionThreshold: 1,
  },
  {
    recipeId: "guardian.credential-stuffing",
    recipeVersion: 1,
    audiences: ["member", "staff"],
    windowSeconds: 60,
    minimumFailures: 1,
    minimumDistinctAccountBuckets: 1,
    actorLimitTtlSeconds: 60,
  },
  {
    recipeId: "moderator.repeated-link-spam",
    recipeVersion: 1,
    collectionSlugs: ["posts"],
    windowSeconds: 60,
    minIndependentAccounts: 1,
    minItems: 1,
    automaticConfidenceBasisPoints: 10_000,
  },
  {
    recipeId: "operator.worker-not-draining",
    recipeVersion: 1,
    staleAfterSeconds: 60,
    minimumPendingJobs: 1,
    checkIds: ["jobs.health"],
  },
  {
    recipeId: "publisher.stale-content",
    recipeVersion: 1,
    collectionSlugs: ["posts"],
    staleAfterDays: 30,
    candidateLimit: 50,
    batchSize: 5,
  },
];

function configuration(): NpAgentConfigurationDefinitionV1 {
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name: "Runtime test",
    template: "custom",
    modelConnectionId: null,
    model: null,
    scopes: ["site:read"],
    autonomy: "observe",
    capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
    policyMode: "site",
    budget: npCreateInheritedAgentBudgetV1(),
    settings: structuredClone(recipes),
  };
}

describe("Runtime settings and Agent definitions", () => {
  it("keeps absence disabled and creates independent exact inheritance defaults", () => {
    const first = npCreateDisabledAgentRuntimeSettingsV1();
    expect(npRequireAgentRuntimeSettingsV1(first)).toEqual(first);
    expect(first).toMatchObject({
      enabled: false,
      allowedProviderIds: [],
      emergencyPause: { paused: false, reasonCode: null, actorFingerprint: null, changedAt: null },
    });
    expect(first.defaultPolicyRules.capabilityModes).toEqual([]);
    first.defaultPolicyRules.resources.collections = ["posts"];
    expect(
      npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules.resources.collections,
    ).toBeNull();
  });

  it("requires complete pause evidence and rejects unknown authority/settings fields", () => {
    const settings = npCreateDisabledAgentRuntimeSettingsV1();
    expect(npAnalyzeAgentRuntimeSettingsV1({ ...settings, rowVersion: 1 }).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeSettingsV1({
        ...settings,
        emergencyPause: { ...settings.emergencyPause, paused: true },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRuntimeSettingsV1({
        ...settings,
        emergencyPause: { ...settings.emergencyPause, reasonCode: "PAUSED" },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRuntimeSettingsV1({
        ...settings,
        allowedProviderIds: ["provider-b", "provider-a"],
      }).ok,
    ).toBe(false);
    expect(
      npRequireAgentRuntimeSettingsV1({
        ...settings,
        emergencyPause: {
          paused: true,
          reasonCode: "OPERATOR_PAUSED",
          actorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
          changedAt: "2026-09-11T00:00:00.000Z",
        },
      }).emergencyPause.paused,
    ).toBe(true);
  });

  it("uses all five exact recipe settings branches and their own bounds", () => {
    for (const recipe of recipes) {
      expect(npAnalyzeAgentRecipeSettingsV1(recipe)).toEqual({ ok: true, value: recipe });
      expect(npAnalyzeAgentRecipeSettingsV1({ ...recipe, prompt: "Increase authority" }).ok).toBe(
        false,
      );
      expect(npAnalyzeAgentRecipeSettingsV1({ ...recipe, recipeVersion: 2 }).ok).toBe(false);
    }
    expect(npAnalyzeAgentRecipeSettingsV1({ ...recipes[0], windowSeconds: 59 }).ok).toBe(false);
    expect(npAnalyzeAgentRecipeSettingsV1({ ...recipes[1], actorLimitTtlSeconds: 3_601 }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRecipeSettingsV1({ ...recipes[2], collectionSlugs: [] }).ok).toBe(false);
    expect(
      npAnalyzeAgentRecipeSettingsV1({ ...recipes[3], checkIds: ["jobs.health", "jobs.health"] })
        .ok,
    ).toBe(false);
    expect(npAnalyzeAgentRecipeSettingsV1({ ...recipes[4], batchSize: 6 }).ok).toBe(false);
    expect(npAnalyzeAgentRecipeSettingsV1({ ...recipes[4], staleAfterDays: 29 }).ok).toBe(false);
  });

  it("closes configuration fields, provider pairing, mode permissions, and recipe ordering", () => {
    const value = configuration();
    expect(npRequireAgentConfigurationDefinitionV1(value)).toEqual(value);
    expect(
      npAnalyzeAgentConfigurationDefinitionV1({ ...value, activeVersionId: "forged" }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentConfigurationDefinitionV1({ ...value, model: "model-a" }).ok).toBe(false);
    expect(npAnalyzeAgentConfigurationDefinitionV1({ ...value, settings: [] }).ok).toBe(false);
    expect(
      npAnalyzeAgentConfigurationDefinitionV1({ ...value, settings: [...value.settings].reverse() })
        .ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentConfigurationDefinitionV1({
        ...value,
        autonomy: "approved",
        capabilityModes: [{ capabilityId: "site.inspect", mode: "guarded" }],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentConfigurationDefinitionV1({
        ...value,
        autonomy: "approved",
        capabilityModes: [{ capabilityId: "site.inspect", mode: "advise" }],
      }).ok,
    ).toBe(true);
  });

  it("keeps policy instructions separate and reuses the canonical rules parser", () => {
    const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
    const input = {
      schemaVersion: "np.agent-policy-definition.v1",
      agentId: null,
      name: "Site policy",
      instructions: "Operator-authored instructions",
      rules,
    };
    expect(npAnalyzeAgentPolicyDefinitionV1(input)).toEqual({ ok: true, value: input });
    expect(npRequireAgentPolicyRulesV1(rules)).toEqual(
      npRequireAgentPolicyCanonical({
        schemaVersion: "np.agent-policy.v1",
        instructions: input.instructions,
        rules,
      }).rules,
    );
    expect(
      npAnalyzeAgentPolicyDefinitionV1({
        ...input,
        rules: { ...rules, instructions: "Hidden authority" },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentPolicyDefinitionV1({ ...input, instructions: "정".repeat(100_000) }).ok,
    ).toBe(true);
  });

  it("contains hostile graphs without invoking getters or retaining aliases", () => {
    let reads = 0;
    const value = configuration();
    Object.defineProperty(value, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "untrusted";
      },
    });
    expect(npAnalyzeAgentConfigurationDefinitionV1(value).ok).toBe(false);
    expect(reads).toBe(0);
    const ordinary = configuration();
    const parsed = npRequireAgentConfigurationDefinitionV1(ordinary);
    parsed.settings[0].recipeVersion = 1;
    expect(parsed.settings).not.toBe(ordinary.settings);
    expect(
      npAnalyzeAgentRuntimeSettingsV1(Object.create(npCreateDisabledAgentRuntimeSettingsV1())).ok,
    ).toBe(false);
  });

  it("retains exact existing policy/budget bodies without instructions or inherited deployment limits", () => {
    const deploymentBudget = npCreateInheritedAgentBudgetV1();
    for (const key of npAgentBudgetDimensionKeysV1) deploymentBudget[key] = 1;
    const value: NpAgentRuntimeAdmissionSourcesV1 = {
      schemaVersion: "np.agent-runtime-admission-sources.v1",
      frameworkPolicy: {
        schemaVersion: "np.agent-policy.v1",
        instructions: "",
        rules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
      },
      frameworkPolicyVersion: 1,
      sitePolicy: {
        schemaVersion: "np.agent-policy.v1",
        instructions: "",
        rules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
      },
      deploymentBudget,
      siteBudget: npCreateInheritedAgentBudgetV1(),
    };
    const parsed = npRequireAgentRuntimeAdmissionSourcesV1(value);
    expect(parsed).toEqual(value);
    expect(parsed.frameworkPolicy.rules).not.toBe(value.frameworkPolicy.rules);
    expect(parsed.deploymentBudget).not.toBe(value.deploymentBudget);
    for (const invalid of [
      { ...value, secret: "untrusted" },
      { ...value, schemaVersion: "np.agent-runtime-settings.v1" },
      { ...value, frameworkPolicyVersion: 0 },
      { ...value, frameworkPolicyVersion: 2_147_483_648 },
      { ...value, frameworkPolicy: { ...value.frameworkPolicy, instructions: "Grant authority" } },
      { ...value, sitePolicy: { ...value.sitePolicy, instructions: "Grant authority" } },
      { ...value, deploymentBudget: { ...deploymentBudget, inputTokensPerDay: null } },
      { ...value, siteBudget: { ...value.siteBudget, undocumentedCeiling: 1 } },
    ])
      expect(npAnalyzeAgentRuntimeAdmissionSourcesV1(invalid).ok).toBe(false);
    let reads = 0;
    const hostile = { ...value };
    Object.defineProperty(hostile, "frameworkPolicy", {
      enumerable: true,
      get() {
        reads += 1;
        return value.frameworkPolicy;
      },
    });
    expect(npAnalyzeAgentRuntimeAdmissionSourcesV1(hostile).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
