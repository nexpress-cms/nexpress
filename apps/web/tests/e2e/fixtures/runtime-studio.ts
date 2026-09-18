import {
  npCreateInheritedAgentBudgetV1,
  npCreateDisabledAgentRuntimeSettingsV1,
} from "@nexpress/core/agent-contract";

export const id = "11111111-1111-4111-8111-111111111111";
export const versionId = "22222222-2222-4222-8222-222222222222";
export const principalId = "33333333-3333-4333-8333-333333333333";
export const digest = `cj1:sha256:${"A".repeat(43)}`;
export const at = "2026-09-14T00:00:00.000Z";
export const budget = npCreateInheritedAgentBudgetV1();
export const definition = {
  schemaVersion: "np.agent-configuration-definition.v1",
  name: "Worker observer",
  template: "operator",
  modelConnectionId: null,
  model: null,
  scopes: ["site:read"],
  autonomy: "observe",
  capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
  policyMode: "site",
  budget,
  settings: [
    {
      recipeId: "operator.worker-not-draining",
      recipeVersion: 1,
      staleAfterSeconds: 60,
      minimumPendingJobs: 1,
      checkIds: ["jobs.worker"],
    },
  ],
};
export const agent = {
  schemaVersion: "np.agent-configuration.v1",
  id,
  principalId,
  status: "draft",
  rowVersion: 1,
  versionId,
  version: 1,
  versionStatus: "draft",
  activeVersion: null,
  draftVersionId: versionId,
  manualRecipeIds: [],
  configHash: digest,
  definition,
  availableActions: [
    "agents.configurations.activate",
    "agents.configurations.archive",
    "agents.configurations.update",
  ],
  createdAt: at,
  updatedAt: at,
};
export const readiness = {
  doctor: "ready",
  policy: "ready",
  budget: "ready",
  vault: "not-required",
  integrityKey: "ready",
  worker: "ready",
};
export const catalog = {
  schemaVersion: "np.agent-runtime-catalog.v1",
  recipes: [
    {
      id: "operator.worker-not-draining",
      version: 1,
      allowedTemplates: ["operator"],
      providerMode: "forbidden",
      triggerKinds: ["manual"],
      capabilityIds: ["site.inspect"],
    },
  ],
  scopes: ["site:read"],
  connections: [],
  capabilities: [{ id: "site.inspect", modes: ["observe"] }],
  effectiveBudget: budget,
  defaultPolicyRules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
  selfDelegation: { userId: principalId },
};
