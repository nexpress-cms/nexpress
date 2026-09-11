import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseCanonicalAscii,
  parseSortedScopes,
  parseSortedUniqueEnumArray,
  parseSortedUniqueStrings,
} from "./canonical-runtime-primitives.js";
import {
  npRequireAgentCapabilityModesV1,
  npRequireAgentPolicyCanonical,
  npRequireAgentPolicyRulesV1,
} from "./canonical-notification-policy.js";
import { npRequireAgentContractResult } from "./contract.js";
import { npMeetAgentAutonomyModesV1 } from "./runtime-policy.js";
import { npRequireAgentBudgetV1, type NpAgentBudgetV1 } from "./wire-contract.js";
import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  npAgentAutonomyModes,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentRecipeIds,
  npAgentRecipeTemplates,
  type NpAgentAutonomyMode,
  type NpAgentCapabilityModeV1,
  type NpAgentContractResult,
  type NpAgentPolicyCanonicalV1,
  type NpAgentPolicyRulesV1,
  type NpAgentRecipeTemplate,
  type NpAgentScope,
} from "./types.js";

export const NP_AGENT_RUNTIME_SETTING_KEY = "agents.runtime";
export const npAgentConfigurationStatusesV1 = [
  "draft",
  "active",
  "paused",
  "error",
  "archived",
] as const;
export const npAgentVersionStatusesV1 = ["draft", "active", "retired"] as const;
export const npAgentPolicyModesV1 = ["site", "site_and_agent"] as const;
export type NpAgentConfigurationStatusV1 = (typeof npAgentConfigurationStatusesV1)[number];
export type NpAgentVersionStatusV1 = (typeof npAgentVersionStatusesV1)[number];
export type NpAgentPolicyModeV1 = (typeof npAgentPolicyModesV1)[number];

export type NpAgentRecipeSettingsV1 =
  | {
      recipeId: "publisher.stale-content";
      recipeVersion: 1;
      collectionSlugs: string[];
      staleAfterDays: number;
      candidateLimit: number;
      batchSize: number;
    }
  | {
      recipeId: "moderator.repeated-link-spam";
      recipeVersion: 1;
      collectionSlugs: string[];
      windowSeconds: number;
      minIndependentAccounts: number;
      minItems: number;
      automaticConfidenceBasisPoints: number;
    }
  | {
      recipeId: "operator.worker-not-draining";
      recipeVersion: 1;
      staleAfterSeconds: number;
      minimumPendingJobs: number;
      checkIds: string[];
    }
  | {
      recipeId: "guardian.credential-stuffing";
      recipeVersion: 1;
      audiences: Array<"staff" | "member">;
      windowSeconds: number;
      minimumFailures: number;
      minimumDistinctAccountBuckets: number;
      actorLimitTtlSeconds: number;
    }
  | {
      recipeId: "guardian.agent-abuse";
      recipeVersion: 1;
      windowSeconds: number;
      deniedScopeThreshold: number;
      repeatedProposalThreshold: number;
      costVelocityMicros: number;
      actionThreshold: number;
    };

export interface NpAgentConfigurationDefinitionV1 {
  schemaVersion: "np.agent-configuration-definition.v1";
  name: string;
  template: NpAgentRecipeTemplate;
  modelConnectionId: string | null;
  model: string | null;
  scopes: NpAgentScope[];
  autonomy: NpAgentAutonomyMode;
  capabilityModes: NpAgentCapabilityModeV1[];
  policyMode: NpAgentPolicyModeV1;
  budget: NpAgentBudgetV1;
  settings: NpAgentRecipeSettingsV1[];
}

export interface NpAgentPolicyDefinitionV1 {
  schemaVersion: "np.agent-policy-definition.v1";
  agentId: string | null;
  name: string;
  instructions: string;
  rules: NpAgentPolicyRulesV1;
}

export interface NpAgentRuntimeSettingsV1 {
  schemaVersion: "np.agent-runtime-settings.v1";
  enabled: boolean;
  allowedProviderIds: string[];
  budgetCeiling: NpAgentBudgetV1;
  defaultPolicyRules: NpAgentPolicyRulesV1;
  emergencyPause: {
    paused: boolean;
    reasonCode: string | null;
    actorFingerprint: string | null;
    changedAt: string | null;
  };
}

/** Private retained admission evidence. This is not a browser settings projection. */
export interface NpAgentRuntimeAdmissionSourcesV1 {
  schemaVersion: "np.agent-runtime-admission-sources.v1";
  frameworkPolicy: NpAgentPolicyCanonicalV1;
  frameworkPolicyVersion: number;
  /** Feature-setting hard rules, separate from retained site/Agent policy rows. */
  sitePolicy: NpAgentPolicyCanonicalV1;
  deploymentBudget: NpAgentBudgetV1;
  siteBudget: NpAgentBudgetV1;
}

const RECIPE_IDS = new Set<string>(npAgentRecipeIds);
const TEMPLATES = new Set<string>(npAgentRecipeTemplates);
const AUTONOMY = new Set<string>(npAgentAutonomyModes);
const POLICY_MODES = new Set<string>(npAgentPolicyModesV1);
const RECIPE_KEYS = {
  "publisher.stale-content": ["collectionSlugs", "staleAfterDays", "candidateLimit", "batchSize"],
  "moderator.repeated-link-spam": [
    "collectionSlugs",
    "windowSeconds",
    "minIndependentAccounts",
    "minItems",
    "automaticConfidenceBasisPoints",
  ],
  "operator.worker-not-draining": ["staleAfterSeconds", "minimumPendingJobs", "checkIds"],
  "guardian.credential-stuffing": [
    "audiences",
    "windowSeconds",
    "minimumFailures",
    "minimumDistinctAccountBuckets",
    "actorLimitTtlSeconds",
  ],
  "guardian.agent-abuse": [
    "windowSeconds",
    "deniedScopeThreshold",
    "repeatedProposalThreshold",
    "costVelocityMicros",
    "actionThreshold",
  ],
} as const;

function parseRecipeSettings(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRecipeSettingsV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    failCanonicalBody("shape", path, "must be an exact recipe settings object");
  const recipeId = canonicalBodyEnum<NpAgentRecipeSettingsV1["recipeId"]>(
    Object.getOwnPropertyDescriptor(value, "recipeId")?.value,
    `${path}.recipeId`,
    RECIPE_IDS,
  );
  const keys = ["recipeId", "recipeVersion", ...RECIPE_KEYS[recipeId]];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  if (row.recipeVersion !== 1)
    failCanonicalBody("invalid-field", `${path}.recipeVersion`, "must be 1");
  const integer = (key: string, min: number, max: number) =>
    canonicalBodyInteger(row[key], `${path}.${key}`, min, max);
  const count = (key: string) => integer(key, 1, 100_000);
  const duration = (key: string) => integer(key, 60, 86_400);
  const ids = (key: string) =>
    parseSortedUniqueStrings(row[key], `${path}.${key}`, 32, 96, state, {
      minimum: 1,
      identifier: true,
    });
  switch (recipeId) {
    case "publisher.stale-content":
      return {
        recipeId,
        recipeVersion: 1,
        collectionSlugs: ids("collectionSlugs"),
        staleAfterDays: integer("staleAfterDays", 30, 3_650),
        candidateLimit: integer("candidateLimit", 1, 50),
        batchSize: integer("batchSize", 1, 5),
      };
    case "moderator.repeated-link-spam":
      return {
        recipeId,
        recipeVersion: 1,
        collectionSlugs: ids("collectionSlugs"),
        windowSeconds: duration("windowSeconds"),
        minIndependentAccounts: count("minIndependentAccounts"),
        minItems: count("minItems"),
        automaticConfidenceBasisPoints: integer("automaticConfidenceBasisPoints", 0, 10_000),
      };
    case "operator.worker-not-draining":
      return {
        recipeId,
        recipeVersion: 1,
        staleAfterSeconds: duration("staleAfterSeconds"),
        minimumPendingJobs: count("minimumPendingJobs"),
        checkIds: ids("checkIds"),
      };
    case "guardian.credential-stuffing":
      return {
        recipeId,
        recipeVersion: 1,
        audiences: parseSortedUniqueEnumArray(
          row.audiences,
          `${path}.audiences`,
          new Set(["member", "staff"]),
          2,
          state,
          1,
        ),
        windowSeconds: duration("windowSeconds"),
        minimumFailures: count("minimumFailures"),
        minimumDistinctAccountBuckets: count("minimumDistinctAccountBuckets"),
        actorLimitTtlSeconds: integer(
          "actorLimitTtlSeconds",
          NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
          NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
        ),
      };
    case "guardian.agent-abuse":
      return {
        recipeId,
        recipeVersion: 1,
        windowSeconds: duration("windowSeconds"),
        deniedScopeThreshold: count("deniedScopeThreshold"),
        repeatedProposalThreshold: count("repeatedProposalThreshold"),
        costVelocityMicros: integer("costVelocityMicros", 0, Number.MAX_SAFE_INTEGER),
        actionThreshold: count("actionThreshold"),
      };
  }
}

export function npAnalyzeAgentRecipeSettingsV1(
  value: unknown,
): NpAgentContractResult<NpAgentRecipeSettingsV1> {
  const path = "agent.recipeSettings";
  return analyzeCanonicalBody(path, () =>
    parseRecipeSettings(cloneCanonicalRuntimeInput(value, path, 32 * 1024), path, {
      seen: new WeakSet<object>(),
    }),
  );
}

export function npRequireAgentRecipeSettingsV1(value: unknown): NpAgentRecipeSettingsV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRecipeSettingsV1(value),
    "Invalid Agent recipe settings",
  );
}

export function npAnalyzeAgentConfigurationDefinitionV1(
  value: unknown,
): NpAgentContractResult<NpAgentConfigurationDefinitionV1> {
  const path = "agent.configurationDefinition";
  return analyzeCanonicalBody(path, () => {
    const state = { seen: new WeakSet<object>() };
    const keys = [
      "schemaVersion",
      "name",
      "template",
      "modelConnectionId",
      "model",
      "scopes",
      "autonomy",
      "capabilityModes",
      "policyMode",
      "budget",
      "settings",
    ];
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, 256 * 1024),
      path,
      keys,
      keys,
      state,
    );
    if (row.schemaVersion !== "np.agent-configuration-definition.v1")
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-configuration-definition.v1",
      );
    const modelConnectionId =
      row.modelConnectionId === null
        ? null
        : canonicalBodyUuid(row.modelConnectionId, `${path}.modelConnectionId`);
    const model = row.model === null ? null : parseCanonicalAscii(row.model, `${path}.model`, 128);
    if ((modelConnectionId === null) !== (model === null))
      failCanonicalBody(
        "invalid-field",
        path,
        "model and connection must both be null or both be present",
      );
    const autonomy = canonicalBodyEnum<NpAgentAutonomyMode>(
      row.autonomy,
      `${path}.autonomy`,
      AUTONOMY,
    );
    const capabilityModes = npRequireAgentCapabilityModesV1(row.capabilityModes);
    if (
      capabilityModes.some(
        (entry) => npMeetAgentAutonomyModesV1(autonomy, entry.mode) !== entry.mode,
      )
    )
      failCanonicalBody(
        "invalid-field",
        `${path}.capabilityModes`,
        "must not grant permissions outside autonomy",
      );
    const entries = canonicalBodyArray(row.settings, `${path}.settings`, 8, state);
    if (entries.length === 0)
      failCanonicalBody("limit", `${path}.settings`, "requires at least one recipe");
    const settings = entries.map((entry, index) =>
      parseRecipeSettings(entry, `${path}.settings[${index}]`, state),
    );
    if (
      settings.some((entry, index) => index > 0 && settings[index - 1].recipeId >= entry.recipeId)
    )
      failCanonicalBody("order", `${path}.settings`, "must be sorted unique by recipe id");
    return {
      schemaVersion: "np.agent-configuration-definition.v1",
      name: canonicalRuntimeText(row.name, `${path}.name`, 120, { requireTrimmed: true }),
      template: canonicalBodyEnum<NpAgentRecipeTemplate>(
        row.template,
        `${path}.template`,
        TEMPLATES,
      ),
      modelConnectionId,
      model,
      scopes: parseSortedScopes(row.scopes, `${path}.scopes`, state),
      autonomy,
      capabilityModes,
      policyMode: canonicalBodyEnum<NpAgentPolicyModeV1>(
        row.policyMode,
        `${path}.policyMode`,
        POLICY_MODES,
      ),
      budget: npRequireAgentBudgetV1(row.budget),
      settings,
    };
  });
}

export function npRequireAgentConfigurationDefinitionV1(
  value: unknown,
): NpAgentConfigurationDefinitionV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentConfigurationDefinitionV1(value),
    "Invalid Agent configuration definition",
  );
}

export function npAnalyzeAgentPolicyDefinitionV1(
  value: unknown,
): NpAgentContractResult<NpAgentPolicyDefinitionV1> {
  const path = "agent.policyDefinition";
  return analyzeCanonicalBody(path, () => {
    const keys = ["schemaVersion", "agentId", "name", "instructions", "rules"];
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1["np.agent-policy.v1"]),
      path,
      keys,
      keys,
      { seen: new WeakSet<object>() },
    );
    if (row.schemaVersion !== "np.agent-policy-definition.v1")
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-policy-definition.v1",
      );
    const canonical = npRequireAgentPolicyCanonical({
      schemaVersion: "np.agent-policy.v1",
      instructions: row.instructions,
      rules: row.rules,
    });
    return {
      schemaVersion: "np.agent-policy-definition.v1",
      agentId: row.agentId === null ? null : canonicalBodyUuid(row.agentId, `${path}.agentId`),
      name: canonicalRuntimeText(row.name, `${path}.name`, 120, { requireTrimmed: true }),
      instructions: canonical.instructions,
      rules: canonical.rules,
    };
  });
}

export function npRequireAgentPolicyDefinitionV1(value: unknown): NpAgentPolicyDefinitionV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPolicyDefinitionV1(value),
    "Invalid Agent policy definition",
  );
}

export function npAnalyzeAgentRuntimeSettingsV1(
  value: unknown,
): NpAgentContractResult<NpAgentRuntimeSettingsV1> {
  const path = "agent.runtimeSettings";
  return analyzeCanonicalBody(path, () => {
    const state = { seen: new WeakSet<object>() };
    const keys = [
      "schemaVersion",
      "enabled",
      "allowedProviderIds",
      "budgetCeiling",
      "defaultPolicyRules",
      "emergencyPause",
    ];
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, 256 * 1024),
      path,
      keys,
      keys,
      state,
    );
    if (row.schemaVersion !== "np.agent-runtime-settings.v1")
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-runtime-settings.v1",
      );
    if (typeof row.enabled !== "boolean")
      failCanonicalBody("invalid-field", `${path}.enabled`, "must be boolean");
    const pauseKeys = ["paused", "reasonCode", "actorFingerprint", "changedAt"];
    const pause = canonicalBodyRecord(
      row.emergencyPause,
      `${path}.emergencyPause`,
      pauseKeys,
      pauseKeys,
      state,
    );
    if (typeof pause.paused !== "boolean")
      failCanonicalBody("invalid-field", `${path}.emergencyPause.paused`, "must be boolean");
    const reasonCode =
      pause.reasonCode === null
        ? null
        : canonicalRuntimeStableCode(pause.reasonCode, `${path}.emergencyPause.reasonCode`);
    const actorFingerprint =
      pause.actorFingerprint === null
        ? null
        : canonicalBodySha256Digest(
            pause.actorFingerprint,
            `${path}.emergencyPause.actorFingerprint`,
          );
    const changedAt =
      pause.changedAt === null
        ? null
        : canonicalBodyUtc(pause.changedAt, `${path}.emergencyPause.changedAt`);
    const allAbsent = reasonCode === null && actorFingerprint === null && changedAt === null;
    const allPresent = reasonCode !== null && actorFingerprint !== null && changedAt !== null;
    if ((!allAbsent && !allPresent) || (pause.paused && !allPresent))
      failCanonicalBody(
        "invalid-field",
        `${path}.emergencyPause`,
        "pause evidence must be complete and is required while paused",
      );
    return {
      schemaVersion: "np.agent-runtime-settings.v1",
      enabled: row.enabled,
      allowedProviderIds: parseSortedUniqueStrings(
        row.allowedProviderIds,
        `${path}.allowedProviderIds`,
        100,
        128,
        state,
        { identifier: true },
      ),
      budgetCeiling: npRequireAgentBudgetV1(row.budgetCeiling),
      defaultPolicyRules: npRequireAgentPolicyRulesV1(row.defaultPolicyRules),
      emergencyPause: { paused: pause.paused, reasonCode, actorFingerprint, changedAt },
    };
  });
}

export function npRequireAgentRuntimeSettingsV1(value: unknown): NpAgentRuntimeSettingsV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRuntimeSettingsV1(value),
    "Invalid Agent runtime settings",
  );
}

export function npAnalyzeAgentRuntimeAdmissionSourcesV1(
  value: unknown,
): NpAgentContractResult<NpAgentRuntimeAdmissionSourcesV1> {
  const path = "agent.runtimeAdmissionSources";
  return analyzeCanonicalBody(path, () => {
    const keys = [
      "schemaVersion",
      "frameworkPolicy",
      "frameworkPolicyVersion",
      "sitePolicy",
      "deploymentBudget",
      "siteBudget",
    ];
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(
        value,
        path,
        2 * npAgentCanonicalBodyMaxBytesV1["np.agent-policy.v1"] + 64 * 1024,
      ),
      path,
      keys,
      keys,
      { seen: new WeakSet<object>() },
    );
    if (row.schemaVersion !== "np.agent-runtime-admission-sources.v1")
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-runtime-admission-sources.v1",
      );
    const frameworkPolicy = npRequireAgentPolicyCanonical(row.frameworkPolicy);
    const sitePolicy = npRequireAgentPolicyCanonical(row.sitePolicy);
    if (frameworkPolicy.instructions !== "" || sitePolicy.instructions !== "")
      failCanonicalBody(
        "invalid-field",
        path,
        "retained hard-rule sources cannot contain instructions",
      );
    return {
      schemaVersion: "np.agent-runtime-admission-sources.v1",
      frameworkPolicy,
      frameworkPolicyVersion: canonicalBodyInteger(
        row.frameworkPolicyVersion,
        `${path}.frameworkPolicyVersion`,
        1,
        2_147_483_647,
      ),
      sitePolicy,
      deploymentBudget: npRequireAgentBudgetV1(row.deploymentBudget, { requireConcrete: true }),
      siteBudget: npRequireAgentBudgetV1(row.siteBudget),
    };
  });
}

export function npRequireAgentRuntimeAdmissionSourcesV1(
  value: unknown,
): NpAgentRuntimeAdmissionSourcesV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRuntimeAdmissionSourcesV1(value),
    "Invalid Agent runtime admission sources",
  );
}

export function npCreateInheritedAgentBudgetV1(): NpAgentBudgetV1 {
  return {
    schemaVersion: "np.agent-budget.v1",
    costCurrency: "USD",
    maxConcurrentRuns: null,
    maxConcurrentProviderCalls: null,
    runsPerHour: null,
    providerCallsPerHour: null,
    providerCallsPerRun: null,
    inputTokensPerRun: null,
    outputTokensPerRun: null,
    inputTokensPerDay: null,
    outputTokensPerDay: null,
    inputTokensPerMonth: null,
    outputTokensPerMonth: null,
    costMicrosPerDay: null,
    costMicrosPerMonth: null,
    attemptsPerRun: null,
    capabilityCallsPerRun: null,
    incidentAnalysesPerFingerprintPerDay: null,
    incidentAnalysisCooldownSeconds: null,
    directActionsPerHour: null,
    directActionsPerSubjectPerHour: null,
    warningBasisPoints: 8_000,
  };
}

export function npCreateDisabledAgentRuntimeSettingsV1(): NpAgentRuntimeSettingsV1 {
  return {
    schemaVersion: "np.agent-runtime-settings.v1",
    enabled: false,
    allowedProviderIds: [],
    budgetCeiling: npCreateInheritedAgentBudgetV1(),
    defaultPolicyRules: {
      schemaVersion: "np.agent-policy-rules.v1",
      capabilityModes: [],
      resources: {
        collections: null,
        navigationLocations: null,
        themeIds: null,
        settingKeys: null,
        incidentCategories: null,
        actorRestrictionScopes: null,
      },
      risk: {
        automaticActionMaximum: "read",
        requirePreviewAtOrAbove: "reversible",
        requireRecentAuthAtOrAbove: "sensitive",
      },
      providerDataMaximum: "public-only",
      automation: {
        quietHoursUtc: [],
        moderationAutoQuarantineMinBasisPoints: null,
        moderationTargetsPerRun: 0,
        guardianLimitActorMinSeverity: null,
        guardianRestrictionTtlSeconds: 900,
      },
      escalation: { minimumSeverity: "info", channels: ["admin"] },
      retentionDays: { events: 14, signals: 90, runDetails: 90, incidentsAndActions: 365 },
    },
    emergencyPause: { paused: false, reasonCode: null, actorFingerprint: null, changedAt: null },
  };
}
