import { npAgentContractLimits, npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
} from "./canonical-foundation.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCausalDepthMaximumV1,
  npAgentProviderDataClasses,
  npAgentRecipeIds,
  npAgentRunAdmissionOrigins,
  npAgentRunAdmissionPolicyKinds,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
  type NpAgentProviderDataClass,
  type NpAgentRecipeId,
  type NpAgentRunAdmissionAgentV1,
  type NpAgentRunAdmissionCanonicalV1,
  type NpAgentRunAdmissionConnectionV1,
  type NpAgentRunAdmissionLineageV1,
  type NpAgentRunAdmissionOrigin,
  type NpAgentRunAdmissionPolicyKind,
  type NpAgentRunAdmissionPolicyRefV1,
  type NpAgentRunAdmissionRecipeV1,
} from "./types.js";

const PURPOSE = "np.agent-run-admission.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const MAXIMUM_BODY_BYTES = npAgentCanonicalBodyMaxBytesV1[PURPOSE];
const MAXIMUM_POLICY_REFS = MAXIMUM_BODY_BYTES;
const MAXIMUM_DEADLINE_MILLISECONDS = 86_400 * 1_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const PRICING_FINGERPRINT_PATTERN = /^pr1:sha256:[A-Za-z0-9_-]{43}$/u;
const ORIGINS = new Set<string>(npAgentRunAdmissionOrigins);
const POLICY_KINDS = new Set<string>(npAgentRunAdmissionPolicyKinds);
const PROVIDER_DATA_CLASSES = new Set<string>(npAgentProviderDataClasses);
const RECIPE_IDS = new Set<string>(npAgentRecipeIds);
const PREFLIGHT_LIMITS = {
  maximumDepth: npAgentContractLimits.invocationDepth,
  maximumNodes: MAXIMUM_BODY_BYTES,
  maximumArrayItems: MAXIMUM_BODY_BYTES,
  maximumObjectProperties: npAgentContractLimits.invocationObjectProperties,
  maximumStringCharacters: MAXIMUM_BODY_BYTES,
  maximumCanonicalBytes: MAXIMUM_BODY_BYTES,
} as const;

export const npAgentRunAdmissionCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "origin",
  "principalId",
  "invocationId",
  "triggerId",
  "agent",
  "lineage",
  "recipe",
  "goal",
  "eventRef",
  "policyRefs",
  "runLimitsHash",
  "budgetSnapshotHash",
  "idempotencyKey",
  "connection",
  "admittedAt",
  "deadlineAt",
] as const satisfies readonly (keyof NpAgentRunAdmissionCanonicalV1)[];

export const npAgentRunAdmissionCanonicalExcludedKeysV1 = [
  "admissionHash",
  "admissionFingerprint",
  "runId",
  "state",
  "attempt",
  "providerRequestId",
  "usage",
  "result",
  "errorCode",
  "errorMessage",
  "queuedAt",
  "startedAt",
  "leaseUntil",
  "finishedAt",
] as const;

export const npAgentRunAdmissionAgentIncludedKeysV1 = [
  "id",
  "versionId",
  "configHash",
] as const satisfies readonly (keyof NpAgentRunAdmissionAgentV1)[];

export const npAgentRunAdmissionLineageIncludedKeysV1 = [
  "rootRunId",
  "parentRunId",
  "causalDepth",
  "causalEventId",
  "causalActionId",
] as const satisfies readonly (keyof NpAgentRunAdmissionLineageV1)[];

export const npAgentRunAdmissionRecipeIncludedKeysV1 = [
  "id",
  "version",
  "fingerprint",
  "instructionTemplateId",
  "instructionTemplateVersion",
  "instructionDigest",
  "responseSchemaDigest",
  "manualInputSchemaDigest",
] as const satisfies readonly (keyof NpAgentRunAdmissionRecipeV1)[];

export const npAgentRunAdmissionPolicyRefIncludedKeysV1 = [
  "kind",
  "id",
  "version",
  "digest",
] as const satisfies readonly (keyof NpAgentRunAdmissionPolicyRefV1)[];

export const npAgentRunAdmissionConnectionIncludedKeysV1 = [
  "id",
  "configSnapshotId",
  "configVersion",
  "configHash",
  "dataClassCeiling",
  "pricingId",
  "pricingVersion",
  "pricingFingerprint",
  "pricingEffectiveAt",
] as const satisfies readonly (keyof NpAgentRunAdmissionConnectionV1)[];

function parsePreflightObject(value: unknown, path: string): NpAgentJsonObject {
  const result = npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, PREFLIGHT_LIMITS),
    "Invalid Agent run-admission canonical body",
  );
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    failCanonicalBody("shape", path, "must be an object-root canonical body");
  }
  return result;
}

function parseGoal(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npAgentContractLimits.promptArgumentCharacters
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be 1..${npAgentContractLimits.promptArgumentCharacters.toString()} safe text characters`,
    );
  }
  return value;
}

function parseIdempotencyKey(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must be 1..128 ASCII letters, digits, period, underscore, colon, or hyphen",
    );
  }
  return value;
}

function parsePricingFingerprint(value: unknown, path: string): string {
  if (typeof value !== "string" || !PRICING_FINGERPRINT_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical pr1 pricing fingerprint");
  }
  return value;
}

function assertSafeJsonIntegers(value: NpAgentJsonValue, path: string): void {
  if (typeof value === "number") {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      failCanonicalBody("unsafe-value", path, "must not contain an unsafe JSON integer");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeJsonIntegers(entry, `${path}[${index.toString()}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    assertSafeJsonIntegers(entry, `${path}.${key}`);
  }
}

function parseEventRef(value: unknown, path: string): NpAgentJsonObject | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be null or one object-root canonical event reference");
  }
  const result = value as NpAgentJsonObject;
  assertSafeJsonIntegers(result, path);
  return result;
}

function parseAgent(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunAdmissionAgentV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunAdmissionAgentIncludedKeysV1,
    npAgentRunAdmissionAgentIncludedKeysV1,
    state,
  );
  return {
    id: canonicalBodyUuid(record.id, `${path}.id`),
    versionId: canonicalBodyUuid(record.versionId, `${path}.versionId`),
    configHash: canonicalBodySha256Digest(record.configHash, `${path}.configHash`),
  };
}

function parseNullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : canonicalBodyUuid(value, path);
}

function parseLineage(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunAdmissionLineageV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunAdmissionLineageIncludedKeysV1,
    npAgentRunAdmissionLineageIncludedKeysV1,
    state,
  );
  const result: NpAgentRunAdmissionLineageV1 = {
    rootRunId: canonicalBodyUuid(record.rootRunId, `${path}.rootRunId`),
    parentRunId: parseNullableUuid(record.parentRunId, `${path}.parentRunId`),
    causalDepth: canonicalBodyInteger(
      record.causalDepth,
      `${path}.causalDepth`,
      0,
      npAgentCausalDepthMaximumV1,
    ),
    causalEventId: parseNullableUuid(record.causalEventId, `${path}.causalEventId`),
    causalActionId: parseNullableUuid(record.causalActionId, `${path}.causalActionId`),
  };
  if (result.causalDepth === 0) {
    if (
      result.parentRunId !== null ||
      result.causalEventId !== null ||
      result.causalActionId !== null
    ) {
      failCanonicalBody(
        "invalid-field",
        path,
        "a root lineage requires null parent and causal ids",
      );
    }
  } else if (result.parentRunId === null) {
    failCanonicalBody("invalid-field", `${path}.parentRunId`, "is required for a child lineage");
  }
  if ((result.causalEventId === null) !== (result.causalActionId === null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.causalEventId`,
      "causal event and action ids must be both null or both non-null",
    );
  }
  return result;
}

function parseRecipe(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunAdmissionRecipeV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunAdmissionRecipeIncludedKeysV1,
    npAgentRunAdmissionRecipeIncludedKeysV1,
    state,
  );
  const instructionNulls = [
    record.instructionTemplateId,
    record.instructionTemplateVersion,
    record.instructionDigest,
  ].map((entry) => entry === null);
  if (!instructionNulls.every((entry) => entry === instructionNulls[0])) {
    failCanonicalBody(
      "invalid-field",
      `${path}.instructionTemplateId`,
      "instruction id, version, and digest must be all null or all non-null",
    );
  }
  const hasInstruction = !instructionNulls[0];
  return {
    id: canonicalBodyEnum<NpAgentRecipeId>(record.id, `${path}.id`, RECIPE_IDS),
    version: canonicalBodyInteger(record.version, `${path}.version`, 1, SIGNED_32_BIT_MAXIMUM),
    fingerprint: canonicalBodySha256Digest(record.fingerprint, `${path}.fingerprint`),
    instructionTemplateId: hasInstruction
      ? canonicalBodyIdentifier(record.instructionTemplateId, `${path}.instructionTemplateId`)
      : null,
    instructionTemplateVersion: hasInstruction
      ? canonicalBodyInteger(
          record.instructionTemplateVersion,
          `${path}.instructionTemplateVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        )
      : null,
    instructionDigest: hasInstruction
      ? canonicalBodySha256Digest(record.instructionDigest, `${path}.instructionDigest`)
      : null,
    responseSchemaDigest: canonicalBodySha256Digest(
      record.responseSchemaDigest,
      `${path}.responseSchemaDigest`,
    ),
    manualInputSchemaDigest:
      record.manualInputSchemaDigest === null
        ? null
        : canonicalBodySha256Digest(
            record.manualInputSchemaDigest,
            `${path}.manualInputSchemaDigest`,
          ),
  };
}

function comparePolicyRefs(
  left: NpAgentRunAdmissionPolicyRefV1,
  right: NpAgentRunAdmissionPolicyRefV1,
): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  const leftId = left.id ?? "";
  const rightId = right.id ?? "";
  if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  if (left.version !== right.version) return left.version - right.version;
  if (left.digest === right.digest) return 0;
  return left.digest < right.digest ? -1 : 1;
}

function parsePolicyRefs(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunAdmissionPolicyRefV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_POLICY_REFS, state);
  const result: NpAgentRunAdmissionPolicyRefV1[] = [];
  let previous: NpAgentRunAdmissionPolicyRefV1 | undefined;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      npAgentRunAdmissionPolicyRefIncludedKeysV1,
      npAgentRunAdmissionPolicyRefIncludedKeysV1,
      state,
    );
    const current: NpAgentRunAdmissionPolicyRefV1 = {
      kind: canonicalBodyEnum<NpAgentRunAdmissionPolicyKind>(
        record.kind,
        `${entryPath}.kind`,
        POLICY_KINDS,
      ),
      id: record.id === null ? null : canonicalBodyAscii(record.id, `${entryPath}.id`, 128),
      version: canonicalBodyInteger(
        record.version,
        `${entryPath}.version`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      digest: canonicalBodySha256Digest(record.digest, `${entryPath}.digest`),
    };
    if (previous !== undefined) {
      const order = comparePolicyRefs(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted unique by (kind,id-or-empty,version,digest)",
        );
      }
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseConnection(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunAdmissionConnectionV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunAdmissionConnectionIncludedKeysV1,
    npAgentRunAdmissionConnectionIncludedKeysV1,
    state,
  );
  return {
    id: canonicalBodyUuid(record.id, `${path}.id`),
    configSnapshotId: canonicalBodyUuid(record.configSnapshotId, `${path}.configSnapshotId`),
    configVersion: canonicalBodyInteger(
      record.configVersion,
      `${path}.configVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    configHash: canonicalBodySha256Digest(record.configHash, `${path}.configHash`),
    dataClassCeiling: canonicalBodyEnum<NpAgentProviderDataClass>(
      record.dataClassCeiling,
      `${path}.dataClassCeiling`,
      PROVIDER_DATA_CLASSES,
    ),
    pricingId: canonicalBodyAscii(record.pricingId, `${path}.pricingId`, 128),
    pricingVersion: canonicalBodyInteger(
      record.pricingVersion,
      `${path}.pricingVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    pricingFingerprint: parsePricingFingerprint(
      record.pricingFingerprint,
      `${path}.pricingFingerprint`,
    ),
    pricingEffectiveAt: canonicalBodyUtc(record.pricingEffectiveAt, `${path}.pricingEffectiveAt`),
  };
}

function parseRunAdmissionCanonical(value: unknown): NpAgentRunAdmissionCanonicalV1 {
  const path = "agent.canonical.runAdmission";
  const preflight = parsePreflightObject(value, path);
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    preflight,
    path,
    npAgentRunAdmissionCanonicalIncludedKeysV1,
    npAgentRunAdmissionCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }

  const origin = canonicalBodyEnum<NpAgentRunAdmissionOrigin>(
    record.origin,
    `${path}.origin`,
    ORIGINS,
  );
  const invocationId = parseNullableUuid(record.invocationId, `${path}.invocationId`);
  const triggerId = parseNullableUuid(record.triggerId, `${path}.triggerId`);
  const agent = record.agent === null ? null : parseAgent(record.agent, `${path}.agent`, state);
  const recipe =
    record.recipe === null ? null : parseRecipe(record.recipe, `${path}.recipe`, state);
  const connection =
    record.connection === null
      ? null
      : parseConnection(record.connection, `${path}.connection`, state);

  if (origin === "gateway") {
    if (invocationId === null) {
      failCanonicalBody(
        "invalid-field",
        `${path}.invocationId`,
        "is required for Gateway admission",
      );
    }
    if (triggerId !== null || agent !== null || recipe !== null || connection !== null) {
      failCanonicalBody(
        "invalid-field",
        path,
        "Gateway admission requires null trigger, Agent, recipe, and connection",
      );
    }
  } else if (agent === null || recipe === null) {
    failCanonicalBody(
      "invalid-field",
      path,
      "Runtime admission requires a non-null Agent and recipe",
    );
  }
  if (connection !== null && recipe?.instructionDigest === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.connection`,
      "a provider connection requires a non-null recipe instruction triple",
    );
  }

  const admittedAt = canonicalBodyUtc(record.admittedAt, `${path}.admittedAt`);
  const deadlineAt = canonicalBodyUtc(record.deadlineAt, `${path}.deadlineAt`);
  const duration = Date.parse(deadlineAt) - Date.parse(admittedAt);
  if (duration <= 0 || duration > MAXIMUM_DEADLINE_MILLISECONDS) {
    failCanonicalBody(
      "invalid-field",
      `${path}.deadlineAt`,
      "must be after admittedAt and no more than 24 hours later",
    );
  }

  const result: NpAgentRunAdmissionCanonicalV1 = {
    schemaVersion: PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    origin,
    principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
    invocationId,
    triggerId,
    agent,
    lineage: parseLineage(record.lineage, `${path}.lineage`, state),
    recipe,
    goal: parseGoal(record.goal, `${path}.goal`),
    eventRef: parseEventRef(record.eventRef, `${path}.eventRef`),
    policyRefs: parsePolicyRefs(record.policyRefs, `${path}.policyRefs`, state),
    runLimitsHash: canonicalBodySha256Digest(record.runLimitsHash, `${path}.runLimitsHash`),
    budgetSnapshotHash: canonicalBodySha256Digest(
      record.budgetSnapshotHash,
      `${path}.budgetSnapshotHash`,
    ),
    idempotencyKey: parseIdempotencyKey(record.idempotencyKey, `${path}.idempotencyKey`),
    connection,
    admittedAt,
    deadlineAt,
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentRunAdmissionCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentRunAdmissionCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.runAdmission", () =>
    parseRunAdmissionCanonical(value),
  );
}

export function npRequireAgentRunAdmissionCanonical(
  value: unknown,
): NpAgentRunAdmissionCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRunAdmissionCanonical(value),
    "Invalid Agent run-admission canonical body",
  );
}

export function npBuildAgentRunAdmissionCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-run-admission.v1", NpAgentRunAdmissionCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentRunAdmissionCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-run-admission.v1",
    NpAgentRunAdmissionCanonicalV1
  >;
}

export async function npDigestAgentRunAdmissionCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentRunAdmissionCanonicalBytes(value).domainSeparatedUtf8,
  );
}
