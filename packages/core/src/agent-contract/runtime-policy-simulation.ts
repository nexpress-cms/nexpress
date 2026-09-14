import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { npRequireAgentPolicyRulesV1 } from "./canonical-notification-policy.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentAutonomyAllowsV1,
  npAgentPolicyLayerMaximumV1,
  npIsAgentPolicyQuietTimeV1,
  npMeetAgentAutonomyModesV1,
  npResolveAgentPolicyV1,
  type NpAgentResolvedPolicyV1,
  type NpAgentRuntimePermissionV1,
} from "./runtime-policy.js";
import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  npAgentActorRestrictionScopes,
  npAgentAutonomyModes,
  npAgentCapabilityIds,
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  npAgentProviderDataClassRank,
  type NpAgentAutonomyMode,
  type NpAgentCapabilityId,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentPolicyRulesV1,
} from "./types.js";

const FIXTURE_VERSION = "np.agent-policy-simulation-fixture.v1";
const REPORT_VERSION = "np.agent-policy-simulation-report.v1";
const SUITE = "autonomy-and-quiet-hours";
export const npAgentPolicySimulationFixtureJsonV1 = serializeAgentCanonicalJson({
  schemaVersion: FIXTURE_VERSION,
  suite: SUITE,
});
const LIMITATIONS = ["authority", "budgets", "provider-readiness", "capability-execution"] as const;
const MINUTES = [0, 360, 720, 1080, 1439] as const;
const PERMISSIONS: readonly NpAgentRuntimePermissionV1[] = [
  "read",
  "propose",
  "execute-automatic",
  "request-approval",
  "execute-approved",
];
const WINDOW_MAXIMUM = npAgentPolicyLayerMaximumV1 * 8;
const REPORT_MAXIMUM_BYTES = 262_144;

export interface NpAgentPolicySimulationFixtureV1 {
  schemaVersion: typeof FIXTURE_VERSION;
  suite: typeof SUITE;
}
export interface NpAgentPolicySimulationCaseV1 extends Omit<
  NpAgentResolvedPolicyV1,
  "capabilityModes"
> {
  autonomy: NpAgentAutonomyMode;
  capabilities: Array<{
    capabilityId: NpAgentCapabilityId;
    mode: NpAgentAutonomyMode;
    permissions: NpAgentRuntimePermissionV1[];
  }>;
  quietTimeChecks: Array<{ minuteUtc: number; quiet: boolean }>;
}
export interface NpAgentPolicySimulationReportV1 {
  schemaVersion: typeof REPORT_VERSION;
  nonAuthorizing: true;
  policyId: string;
  policyVersion: number;
  policyHash: string;
  fixtureHash: string;
  cases: NpAgentPolicySimulationCaseV1[];
  limitations: Array<(typeof LIMITATIONS)[number]>;
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
) {
  return canonicalBodyRecord(value, path, keys, keys, state);
}
function literal<T extends string | boolean>(value: unknown, expected: T, path: string): T {
  if (value !== expected)
    failCanonicalBody("invalid-field", path, "must match the versioned simulation contract");
  return expected;
}
function requireFixture(value: unknown): NpAgentPolicySimulationFixtureV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.policySimulation.fixture", () => {
      const path = "agent.policySimulation.fixture";
      const row = exactRecord(value, path, ["schemaVersion", "suite"], { seen: new WeakSet() });
      return {
        schemaVersion: literal(row.schemaVersion, FIXTURE_VERSION, `${path}.schemaVersion`),
        suite: literal(row.suite, SUITE, `${path}.suite`),
      };
    }),
    "Invalid Agent policy simulation fixture",
  );
}

/** Only the canonical fixed fixture is accepted; duplicate keys and arbitrary facts cannot enter. */
export function npRequireAgentPolicySimulationFixtureJsonV1(
  json: unknown,
): NpAgentPolicySimulationFixtureV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.policySimulation.fixtureJson", () => {
      if (typeof json !== "string" || json.length > 256)
        failCanonicalBody(
          "limit",
          "agent.policySimulation.fixtureJson",
          "must be at most 256 characters",
        );
      const parsed = requireFixture(JSON.parse(json) as unknown);
      if (serializeAgentCanonicalJson(parsed) !== json)
        failCanonicalBody(
          "invalid-field",
          "agent.policySimulation.fixtureJson",
          "must use the canonical versioned fixture JSON",
        );
      return parsed;
    }),
    "Invalid Agent policy simulation fixture JSON",
  );
}

export async function npDigestAgentPolicySimulationFixtureV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  const fixture = requireFixture(value);
  // Owner-specific framing: this digest cannot be confused with a policy or execution input.
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(`${FIXTURE_VERSION}\n${serializeAgentCanonicalJson(fixture)}`),
  );
}
export async function npBuildAgentPolicySimulationFixtureInputV1(): Promise<{
  fixtureJson: string;
  fixtureHash: string;
}> {
  const fixture: NpAgentPolicySimulationFixtureV1 = {
    schemaVersion: FIXTURE_VERSION,
    suite: SUITE,
  };
  return {
    fixtureJson: npAgentPolicySimulationFixtureJsonV1,
    fixtureHash: await npDigestAgentPolicySimulationFixtureV1(fixture),
  };
}

function timeAtMinute(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
}
function permissionsFor(mode: NpAgentAutonomyMode): NpAgentRuntimePermissionV1[] {
  return PERMISSIONS.filter((permission) => npAgentAutonomyAllowsV1(mode, permission));
}

/** Pure policy comparison. These permission sets do not grant authority or admit any operation. */
export function npSimulateAgentPolicyV1(input: {
  policyId: string;
  policyVersion: number;
  policyHash: string;
  fixtureHash: string;
  layers: NpAgentPolicyRulesV1[];
}): NpAgentPolicySimulationReportV1 {
  const cases = npAgentAutonomyModes.map((autonomy): NpAgentPolicySimulationCaseV1 => {
    const resolved = npResolveAgentPolicyV1({
      autonomy,
      capabilityModes: [...npAgentCapabilityIds]
        .sort()
        .map((capabilityId) => ({ capabilityId, mode: autonomy })),
      layers: input.layers,
    });
    const { capabilityModes, ...configuration } = resolved;
    return {
      autonomy,
      ...configuration,
      capabilities: capabilityModes.map((entry) => ({
        ...entry,
        permissions: permissionsFor(entry.mode),
      })),
      quietTimeChecks: MINUTES.map((minuteUtc) => ({
        minuteUtc,
        quiet: npIsAgentPolicyQuietTimeV1(resolved, timeAtMinute(minuteUtc)),
      })),
    };
  });
  return npRequireAgentPolicySimulationReportV1({
    schemaVersion: REPORT_VERSION,
    nonAuthorizing: true,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    fixtureHash: input.fixtureHash,
    cases,
    limitations: [...LIMITATIONS],
  });
}

function parseCase(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  expectedAutonomy: NpAgentAutonomyMode,
): NpAgentPolicySimulationCaseV1 {
  const row = exactRecord(
    value,
    path,
    [
      "autonomy",
      "capabilities",
      "resources",
      "risk",
      "providerDataMaximum",
      "automation",
      "escalation",
      "retentionDays",
      "quietTimeChecks",
    ],
    state,
  );
  const autonomy = literal(row.autonomy, expectedAutonomy, `${path}.autonomy`);
  const capabilities = canonicalBodyArray(
    row.capabilities,
    `${path}.capabilities`,
    npAgentCapabilityIds.length,
    state,
  ).map((entry, index) => {
    const entryPath = `${path}.capabilities[${index.toString()}]`;
    const capability = exactRecord(
      entry,
      entryPath,
      ["capabilityId", "mode", "permissions"],
      state,
    );
    const mode = canonicalBodyEnum<NpAgentAutonomyMode>(
      capability.mode,
      `${entryPath}.mode`,
      new Set(npAgentAutonomyModes),
    );
    const expected = permissionsFor(mode);
    if (npMeetAgentAutonomyModesV1(mode, autonomy) !== mode)
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.mode`,
        "must not widen the synthetic autonomy case",
      );
    const permissions = canonicalBodyArray(
      capability.permissions,
      `${entryPath}.permissions`,
      PERMISSIONS.length,
      state,
    );
    if (
      permissions.length !== expected.length ||
      permissions.some((permission, i) => permission !== expected[i])
    )
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.permissions`,
        "must reflect the actual autonomy permission set",
      );
    return {
      capabilityId: canonicalBodyEnum<NpAgentCapabilityId>(
        capability.capabilityId,
        `${entryPath}.capabilityId`,
        new Set(npAgentCapabilityIds),
      ),
      mode,
      permissions: expected,
    };
  });
  const automation = exactRecord(
    row.automation,
    `${path}.automation`,
    [
      "quietHoursUtc",
      "moderationAutoQuarantineMinBasisPoints",
      "moderationTargetsPerRun",
      "guardianLimitActorMinSeverity",
      "guardianRestrictionTtlSeconds",
    ],
    state,
  );
  let previousEnd = -1;
  const quietHoursUtc = canonicalBodyArray(
    automation.quietHoursUtc,
    `${path}.automation.quietHoursUtc`,
    WINDOW_MAXIMUM,
    state,
  ).map((entry, index) => {
    const entryPath = `${path}.automation.quietHoursUtc[${index.toString()}]`;
    const window = exactRecord(entry, entryPath, ["startMinute", "endMinute"], state);
    const startMinute = canonicalBodyInteger(
      window.startMinute,
      `${entryPath}.startMinute`,
      0,
      1439,
    );
    const endMinute = canonicalBodyInteger(window.endMinute, `${entryPath}.endMinute`, 1, 1440);
    if (startMinute <= previousEnd || endMinute <= startMinute)
      failCanonicalBody("order", entryPath, "must be the sorted normalized union of quiet periods");
    previousEnd = endMinute;
    return { startMinute, endMinute };
  });
  // Stored rules allow eight periods; a union across 16 real layers can have 128.
  const rules = npRequireAgentPolicyRulesV1({
    schemaVersion: "np.agent-policy-rules.v1",
    capabilityModes: capabilities.map(({ capabilityId, mode }) => ({ capabilityId, mode })),
    resources: row.resources,
    risk: row.risk,
    providerDataMaximum: row.providerDataMaximum,
    automation: { ...automation, quietHoursUtc: [] },
    escalation: row.escalation,
    retentionDays: row.retentionDays,
  });
  const resolved: NpAgentResolvedPolicyV1 = {
    ...rules,
    automation: { ...rules.automation, quietHoursUtc },
  };
  const checks = canonicalBodyArray(
    row.quietTimeChecks,
    `${path}.quietTimeChecks`,
    MINUTES.length,
    state,
  );
  if (checks.length !== MINUTES.length)
    failCanonicalBody("limit", `${path}.quietTimeChecks`, "requires the five versioned UTC probes");
  const quietTimeChecks = checks.map((entry, index) => {
    const entryPath = `${path}.quietTimeChecks[${index.toString()}]`;
    const check = exactRecord(entry, entryPath, ["minuteUtc", "quiet"], state);
    const minuteUtc = canonicalBodyInteger(check.minuteUtc, `${entryPath}.minuteUtc`, 0, 1439);
    if (minuteUtc !== MINUTES[index])
      failCanonicalBody("order", `${entryPath}.minuteUtc`, "must match the versioned UTC probe");
    return {
      minuteUtc,
      quiet: literal(
        check.quiet,
        npIsAgentPolicyQuietTimeV1(resolved, timeAtMinute(minuteUtc)),
        `${entryPath}.quiet`,
      ),
    };
  });
  return {
    autonomy,
    capabilities,
    resources: rules.resources,
    risk: rules.risk,
    providerDataMaximum: rules.providerDataMaximum,
    automation: resolved.automation,
    escalation: rules.escalation,
    retentionDays: rules.retentionDays,
    quietTimeChecks,
  };
}

export function npRequireAgentPolicySimulationReportV1(
  value: unknown,
): NpAgentPolicySimulationReportV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.policySimulation.report", () => {
      const path = "agent.policySimulation.report";
      const state: CanonicalBodyInspectionState = { seen: new WeakSet() };
      const row = exactRecord(
        cloneCanonicalRuntimeInput(value, path, REPORT_MAXIMUM_BYTES),
        path,
        [
          "schemaVersion",
          "nonAuthorizing",
          "policyId",
          "policyVersion",
          "policyHash",
          "fixtureHash",
          "cases",
          "limitations",
        ],
        state,
      );
      const cases = canonicalBodyArray(
        row.cases,
        `${path}.cases`,
        npAgentAutonomyModes.length,
        state,
      );
      if (cases.length !== npAgentAutonomyModes.length)
        failCanonicalBody("limit", `${path}.cases`, "requires all four autonomy cases");
      const limitations = canonicalBodyArray(
        row.limitations,
        `${path}.limitations`,
        LIMITATIONS.length,
        state,
      );
      if (
        limitations.length !== LIMITATIONS.length ||
        limitations.some((entry, i) => entry !== LIMITATIONS[i])
      )
        failCanonicalBody(
          "invalid-field",
          `${path}.limitations`,
          "must preserve all non-authorizing limitations",
        );
      return {
        schemaVersion: literal(row.schemaVersion, REPORT_VERSION, `${path}.schemaVersion`),
        nonAuthorizing: literal(row.nonAuthorizing, true, `${path}.nonAuthorizing`),
        policyId: canonicalBodyUuid(row.policyId, `${path}.policyId`),
        policyVersion: canonicalBodyInteger(
          row.policyVersion,
          `${path}.policyVersion`,
          1,
          2_147_483_647,
        ),
        policyHash: canonicalBodySha256Digest(row.policyHash, `${path}.policyHash`),
        fixtureHash: canonicalBodySha256Digest(row.fixtureHash, `${path}.fixtureHash`),
        cases: npAgentAutonomyModes.map((mode, index) =>
          parseCase(cases[index], `${path}.cases[${index.toString()}]`, state, mode),
        ),
        limitations: [...LIMITATIONS],
      };
    }),
    "Invalid Agent policy simulation report",
  );
}

function objectSchema(properties: NpAgentJsonObject): NpAgentJsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
function integerSchema(minimum: number, maximum: number): NpAgentJsonObject {
  return { type: "integer", minimum, maximum };
}
function nullableSchema(schema: NpAgentJsonObject): NpAgentJsonObject {
  return { anyOf: [{ type: "null" }, schema] };
}
function stringSetSchema(items: NpAgentJsonObject): NpAgentJsonObject {
  return nullableSchema({ type: "array", maxItems: 100, uniqueItems: true, items });
}
const RESOURCE_STRING = {
  type: "string",
  minLength: 1,
  maxLength: 96,
  pattern: "^[a-z][a-z0-9_-]{0,39}(?:\\.[a-z][a-z0-9_-]{0,39})*$",
};
const RISK_THRESHOLD = nullableSchema({
  type: "string",
  maxLength: 96,
  enum: ["reversible", "sensitive", "destructive"],
});
const CASE_SCHEMA = objectSchema({
  autonomy: { type: "string", maxLength: 96, enum: [...npAgentAutonomyModes] },
  capabilities: {
    type: "array",
    maxItems: npAgentCapabilityIds.length,
    items: objectSchema({
      capabilityId: { type: "string", maxLength: 96, enum: [...npAgentCapabilityIds] },
      mode: { type: "string", maxLength: 96, enum: [...npAgentAutonomyModes] },
      permissions: {
        type: "array",
        maxItems: PERMISSIONS.length,
        uniqueItems: true,
        items: { type: "string", maxLength: 96, enum: [...PERMISSIONS] },
      },
    }),
  },
  resources: objectSchema({
    collections: stringSetSchema(RESOURCE_STRING),
    navigationLocations: stringSetSchema(RESOURCE_STRING),
    themeIds: stringSetSchema(RESOURCE_STRING),
    settingKeys: stringSetSchema(RESOURCE_STRING),
    incidentCategories: stringSetSchema({
      type: "string",
      maxLength: 96,
      enum: [...npAgentIncidentCategories],
    }),
    actorRestrictionScopes: stringSetSchema({
      type: "string",
      maxLength: 96,
      enum: [...npAgentActorRestrictionScopes],
    }),
  }),
  risk: objectSchema({
    automaticActionMaximum: { type: "string", maxLength: 96, enum: ["read", "reversible"] },
    requirePreviewAtOrAbove: RISK_THRESHOLD,
    requireRecentAuthAtOrAbove: RISK_THRESHOLD,
  }),
  providerDataMaximum: {
    type: "string",
    maxLength: 96,
    enum: Object.keys(npAgentProviderDataClassRank),
  },
  automation: objectSchema({
    quietHoursUtc: {
      type: "array",
      maxItems: WINDOW_MAXIMUM,
      items: objectSchema({
        startMinute: integerSchema(0, 1439),
        endMinute: integerSchema(1, 1440),
      }),
    },
    moderationAutoQuarantineMinBasisPoints: nullableSchema(integerSchema(0, 10000)),
    moderationTargetsPerRun: integerSchema(0, 2_147_483_647),
    guardianLimitActorMinSeverity: nullableSchema({
      type: "string",
      maxLength: 96,
      enum: ["high", "critical"],
    }),
    guardianRestrictionTtlSeconds: integerSchema(
      NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
      NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
    ),
  }),
  escalation: objectSchema({
    minimumSeverity: { type: "string", maxLength: 96, enum: [...npAgentIncidentSeverities] },
    channels: {
      type: "array",
      maxItems: 5,
      uniqueItems: true,
      items: {
        type: "string",
        maxLength: 96,
        enum: ["admin", "email", "siem", "slack", "webhook"],
      },
    },
  }),
  retentionDays: objectSchema({
    events: integerSchema(1, 14),
    signals: integerSchema(1, 90),
    runDetails: integerSchema(1, 90),
    incidentsAndActions: integerSchema(1, 365),
  }),
  quietTimeChecks: {
    type: "array",
    minItems: MINUTES.length,
    maxItems: MINUTES.length,
    items: objectSchema({
      minuteUtc: { type: "integer", enum: [...MINUTES] },
      quiet: { type: "boolean" },
    }),
  },
});
const REPORT_SCHEMA: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: REPORT_VERSION },
    nonAuthorizing: { const: true },
    policyId: { type: "string", format: "uuid", minLength: 36, maxLength: 36 },
    policyVersion: integerSchema(1, 2_147_483_647),
    policyHash: {
      type: "string",
      pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
      minLength: 54,
      maxLength: 54,
    },
    fixtureHash: {
      type: "string",
      pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
      minLength: 54,
      maxLength: 54,
    },
    cases: { type: "array", minItems: 4, maxItems: 4, items: CASE_SCHEMA },
    limitations: { const: [...LIMITATIONS] },
  },
  required: [
    "schemaVersion",
    "nonAuthorizing",
    "policyId",
    "policyVersion",
    "policyHash",
    "fixtureHash",
    "cases",
    "limitations",
  ],
};

// Canonical schema inspection forbids aliased objects, including reused leaf schemas.
export const npAgentPolicySimulationReportSchemaV1 = JSON.parse(
  JSON.stringify(REPORT_SCHEMA),
) as NpAgentJsonSchema;
