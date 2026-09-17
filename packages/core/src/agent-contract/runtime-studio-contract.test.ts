import { npAnalyzeAgentRuntimeStudioEffectiveQueryV1 } from "./runtime-studio-contract.js";
import {
  npAnalyzeAgentRuntimeStudioMutationResultV1,
  npAnalyzeAgentRuntimeStudioOverviewV1,
} from "./runtime-studio-contract.js";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
} from "./runtime-contract.js";
import {
  npAgentRuntimeStudioContractV1,
  npAnalyzeAgentRuntimeStudioBudgetV1,
  npAnalyzeAgentRuntimeStudioCatalogV1,
  npAnalyzeAgentRuntimeStudioConfigurationV1,
  npAnalyzeAgentRuntimeStudioConfigurationsPageV1,
  npAnalyzeAgentRuntimeStudioEffectiveV1,
  npAnalyzeAgentRuntimeStudioPolicyV1,
  npAnalyzeAgentRuntimeStudioQueryV1,
  npAnalyzeAgentRuntimeStudioTriggerV1,
  npBuildAgentRuntimeDefinitionBytesV1,
  npBuildAgentRuntimeStudioDefinitionInputV1,
  npRequireAgentRuntimeStudioConfigurationV1,
} from "./runtime-studio-contract.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
const id = "11111111-1111-4111-8111-111111111111";
const time = "2026-09-14T00:00:00.000Z";
const hash = `cj1:sha256:${"A".repeat(43)}`;
function config() {
  return {
    schemaVersion: "np.agent-configuration.v1",
    id,
    principalId: id,
    status: "draft",
    rowVersion: 1,
    versionId: id,
    version: 1,
    versionStatus: "draft",
    draftVersionId: id,
    activeVersion: null,
    manualRecipeIds: [],
    configHash: hash,
    definition: {
      schemaVersion: "np.agent-configuration-definition.v1",
      name: "Operator",
      template: "operator",
      modelConnectionId: null,
      model: null,
      scopes: ["site:read"],
      autonomy: "observe",
      capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
      policyMode: "site",
      budget: npCreateInheritedAgentBudgetV1(),
      settings: [
        {
          recipeId: "operator.worker-not-draining",
          recipeVersion: 1,
          staleAfterSeconds: 60,
          minimumPendingJobs: 1,
          checkIds: ["jobs.health"],
        },
      ],
    },
    availableActions: ["agents.configurations.activate"],
    createdAt: time,
    updatedAt: time,
  };
}
const budget = () => ({
  schemaVersion: "np.agent-runtime-budget.v1",
  rowVersion: 1,
  siteCeiling: npCreateInheritedAgentBudgetV1(),
  deploymentCeiling: npCreateInheritedAgentBudgetV1(),
  effectiveCeiling: npCreateInheritedAgentBudgetV1(),
  measurement: "unavailable",
  usage: null,
});
const policy = () => ({
  schemaVersion: "np.agent-policy-detail.v1",
  id,
  rowVersion: 1,
  version: 1,
  status: "draft",
  contentHash: hash,
  definition: {
    schemaVersion: "np.agent-policy-definition.v1",
    agentId: null,
    name: "Policy",
    instructions: "Guidance does not grant authority.",
    rules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
  },
  availableActions: ["agents.policies.validate"],
  createdAt: time,
});
const trigger = () => ({
  schemaVersion: "np.agent-trigger-detail.v1",
  agentId: id,
  agentVersionId: id,
  definition: { type: "manual", id },
  enabled: true,
  nextRunAt: null,
  createdAt: time,
  updatedAt: time,
});
const catalog = () => ({
  schemaVersion: "np.agent-runtime-catalog.v1",
  recipes: [],
  scopes: [],
  connections: [],
  capabilities: [],
  selfDelegation: null,
  effectiveBudget: npCreateInheritedAgentBudgetV1(),
  defaultPolicyRules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
});
describe("Runtime Studio read boundary", () => {
  it("fixes bounded lists, strict kind-specific filters and default order", () => {
    expect(npAnalyzeAgentRuntimeStudioQueryV1("configurations", {})).toEqual({
      ok: true,
      value: { limit: 25 },
    });
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { limit: "25" },
      { siteId: "other" },
      { sort: "name" },
      { status: "retired" },
      { name: " padded " },
      { cursor: "x".repeat(2049) },
    ])
      expect(npAnalyzeAgentRuntimeStudioQueryV1("configurations", query).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeStudioQueryV1("policies", { status: "retired", agentId: id }).ok,
    ).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioQueryV1("triggers", { status: "active" }).ok).toBe(false);
  });
  it("reuses exact editable definitions and does not expose private evidence", () => {
    expect(npRequireAgentRuntimeStudioConfigurationV1(config())).toEqual(config());
    expect(npAnalyzeAgentRuntimeStudioPolicyV1(policy()).ok).toBe(true);
    for (const field of [
      "credential",
      "locator",
      "runtimeSettings",
      "rawBody",
      "canonicalInput",
      "internalError",
      "chainOfThought",
    ]) {
      expect(
        npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), [field]: "private" }).ok,
      ).toBe(false);
      expect(npAnalyzeAgentRuntimeStudioPolicyV1({ ...policy(), [field]: "private" }).ok).toBe(
        false,
      );
    }
    expect(
      npAnalyzeAgentRuntimeStudioConfigurationV1({
        ...config(),
        definition: { ...config().definition, providerToken: "private" },
      }).ok,
    ).toBe(false);
  });
  it("rejects accessors without executing hostile code", () => {
    let called = false;
    const value = config();
    Object.defineProperty(value, "definition", {
      enumerable: true,
      get() {
        called = true;
        throw Error("secret");
      },
    });
    expect(npAnalyzeAgentRuntimeStudioConfigurationV1(value).ok).toBe(false);
    expect(called).toBe(false);
    expect(
      npAnalyzeAgentRuntimeStudioQueryV1("configurations", Object.create({ limit: 25 })).ok,
    ).toBe(false);
  });
  it("keeps actions in the exact existing mutation family and unique sorted order", () => {
    for (const availableActions of [
      ["agents.policies.activate"],
      ["agents.configurations.create"],
      ["agents.configurations.activate", "agents.configurations.activate"],
      ["agents.configurations.pause", "agents.configurations.activate"],
    ])
      expect(npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), availableActions }).ok).toBe(
        false,
      );
  });
  it("rejects invalid timestamps and version preconditions", () => {
    for (const patch of [
      { rowVersion: 0 },
      { version: 0 },
      { configHash: "raw" },
      { updatedAt: "2026-09-13T00:00:00.000Z" },
    ])
      expect(npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), ...patch }).ok).toBe(false);
  });
  it("keeps unknown measurements distinct from measured zero", () => {
    expect(npAnalyzeAgentRuntimeStudioBudgetV1(budget()).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioBudgetV1({ ...budget(), measurement: "available" }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRuntimeStudioBudgetV1({ ...budget(), usage: {} }).ok).toBe(false);
  });
  it("reuses trigger definitions and never invents a manual next schedule", () => {
    expect(npAnalyzeAgentRuntimeStudioTriggerV1(trigger()).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioTriggerV1({ ...trigger(), nextRunAt: time }).ok).toBe(false);
    expect(npAnalyzeAgentRuntimeStudioTriggerV1({ ...trigger(), filterHash: hash }).ok).toBe(false);
  });
  it("excludes recipe instructions, schemas and hidden provider settings from choices", () => {
    expect(npAnalyzeAgentRuntimeStudioCatalogV1(catalog()).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioCatalogV1({ ...catalog(), deploymentPolicy: {} }).ok).toBe(
      false,
    );
    expect(
      npAnalyzeAgentRuntimeStudioCatalogV1({
        ...catalog(),
        connections: [{ id, alias: "Model", models: ["model"], credentials: "secret" }],
      }).ok,
    ).toBe(false);
  });
  it("keeps review errors closed and readiness internally consistent", () => {
    const value = {
      schemaVersion: "np.agent-effective-config.v1",
      id,
      rowVersion: 1,
      versionId: id,
      configHash: hash,
      ready: false,
      blockers: ["RUNTIME_READINESS_BLOCKED"],
      policyRefs: [],
      readiness: {
        doctor: "blocked",
        policy: "ready",
        budget: "ready",
        vault: "not-required",
        integrityKey: "ready",
        worker: "unavailable",
      },
    };
    expect(npAnalyzeAgentRuntimeStudioEffectiveV1(value).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioEffectiveV1({ ...value, ready: true }).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeStudioEffectiveV1({ ...value, blockers: ["SQL password"] }).ok,
    ).toBe(false);
  });
  it("bounds shared cursor pages and validates each row", () => {
    const page = {
      schemaVersion: "np.agent-configurations-page.v1",
      items: [config()],
      nextCursor: null,
    };
    expect(npAnalyzeAgentRuntimeStudioConfigurationsPageV1(page).ok).toBe(true);
    expect(
      npAnalyzeAgentRuntimeStudioConfigurationsPageV1({
        ...page,
        items: Array.from({ length: 101 }, config),
      }).ok,
    ).toBe(false);
  });
  it("shares browser and server canonical definition hash bytes", async () => {
    for (const definition of [config().definition, policy().definition, budget().siteCeiling]) {
      const bytes = npBuildAgentRuntimeDefinitionBytesV1(definition);
      const result = await npBuildAgentRuntimeStudioDefinitionInputV1(definition);
      expect(result.definitionJson).toBe(bytes.definitionJson);
      expect(result.definitionHash).toBe(
        `cj1:sha256:${createHash("sha256").update(bytes.bytes).digest("base64url")}`,
      );
      expect(new TextDecoder().decode(bytes.bytes)).toBe(
        `np.agent-runtime-definition.v1\0${bytes.definitionJson}`,
      );
    }
  });
  it("projects exact acknowledgements without mutation bodies", () => {
    expect(
      npAnalyzeAgentRuntimeStudioMutationResultV1({ resourceId: id, replayed: false }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRuntimeStudioMutationResultV1({ resourceId: id, replayed: false, output: {} })
        .ok,
    ).toBe(false);
  });
  it("shows unavailable operations honestly and rejects mismatched live status", () => {
    const status = {
      schemaVersion: "np.agent-runtime-status.v1",
      siteId: "main",
      revision: 1,
      enabled: false,
      paused: false,
      generatedAt: time,
      readiness: {
        doctor: "unavailable",
        policy: "unavailable",
        budget: "unavailable",
        vault: "not-required",
        integrityKey: "unavailable",
        worker: "unavailable",
      },
    };
    const overview = { schemaVersion: "np.agent-runtime-overview.v1", status, operations: null };
    expect(npAnalyzeAgentRuntimeStudioOverviewV1(overview).ok).toBe(true);
    const operations = {
      runtime: {
        enabled: false,
        paused: false,
        total: 0,
        active: 0,
        queued: 0,
        waitingApproval: 0,
        oldestQueuedAgeSeconds: null,
      },
      events: {
        total: 0,
        pending: 0,
        expired: 0,
        expiredPending: 0,
        oldestPendingAgeSeconds: null,
      },
      triggers: { total: 0, enabled: 0, due: 0, oldestDueAgeSeconds: null },
    };
    expect(npAnalyzeAgentRuntimeStudioOverviewV1({ ...overview, operations }).ok).toBe(true);
    expect(
      npAnalyzeAgentRuntimeStudioOverviewV1({
        ...overview,
        operations: { ...operations, runtime: { ...operations.runtime, enabled: true } },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRuntimeStudioOverviewV1({
        ...overview,
        operations: { ...operations, events: { ...operations.events, total: -1 } },
      }).ok,
    ).toBe(false);
  });
  it("keeps selected draft and active version references consistent", () => {
    expect(
      npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), draftVersionId: null }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), status: "active" }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRuntimeStudioConfigurationV1({ ...config(), status: "archived" }).ok).toBe(
      false,
    );
    expect(
      npAnalyzeAgentRuntimeStudioConfigurationV1({
        ...config(),
        status: "archived",
        draftVersionId: null,
        availableActions: [],
      }).ok,
    ).toBe(true);
  });
  it("allows only the explicit active review selector", () => {
    expect(npAnalyzeAgentRuntimeStudioEffectiveQueryV1({})).toEqual({ ok: true, value: {} });
    expect(npAnalyzeAgentRuntimeStudioEffectiveQueryV1({ version: "active" }).ok).toBe(true);
    expect(npAnalyzeAgentRuntimeStudioEffectiveQueryV1({ version: "draft" }).ok).toBe(false);
    expect(
      npAnalyzeAgentRuntimeStudioEffectiveQueryV1({ version: "active", versionId: id }).ok,
    ).toBe(false);
  });
  it("locks discovery fingerprint", () => {
    expect(
      createHash("sha256")
        .update(serializeAgentCanonicalJson(npAgentRuntimeStudioContractV1))
        .digest("hex"),
    ).toMatchInlineSnapshot(`"88d191bcbd3fda0f5bb23d9fe23c3fc54683b064ab9384290b21056c2a6dd057"`);
  });
});

it("accepts legacy catalog recipes and exposes only validated bounded manual schemas", () => {
  const recipe = {
    id: "publisher.stale-content",
    version: 1,
    allowedTemplates: ["publisher"],
    providerMode: "required",
    triggerKinds: ["manual"],
    capabilityIds: ["content.query"],
  };
  expect(npAnalyzeAgentRuntimeStudioCatalogV1({ ...catalog(), recipes: [recipe] }).ok).toBe(true);
  const manualInputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { topic: { type: "string", maxLength: 100 } },
    required: ["topic"],
  };
  const result = npAnalyzeAgentRuntimeStudioCatalogV1({
    ...catalog(),
    recipes: [{ ...recipe, manualInputSchema }],
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.recipes[0]?.manualInputSchema).toEqual(manualInputSchema);
  expect(
    npAnalyzeAgentRuntimeStudioCatalogV1({
      ...catalog(),
      recipes: [
        { ...recipe, manualInputSchema: { ...manualInputSchema, additionalProperties: true } },
      ],
    }).ok,
  ).toBe(false);
});
