import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  PROVIDER_COMPONENT_MAXIMUM,
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeIdempotencyKey,
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseAgentModelPricing,
  parseCanonicalAscii,
  parseCanonicalCapabilityId,
  parseCanonicalIdentifier,
  parseCanonicalInteger,
  parseCanonicalJsonObject,
  parseCanonicalJsonSchema,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  parseCanonicalUtc,
  parseCanonicalUuid,
  parseProviderDataClass,
  parseSortedUniqueEnumArray,
} from "./canonical-runtime-primitives.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCapabilityIds,
  npAgentGuardianAssessmentCodes,
  npAgentModerationReasonCodes,
  npAgentProviderDataClassRank,
  npAgentRecipeIds,
  npAgentRecipeTasks,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentEvidenceRequest,
  type NpAgentGuardianAssessmentCode,
  type NpAgentGuardianDecisionV1,
  type NpAgentInteractiveDecisionV1,
  type NpAgentJsonValue,
  type NpAgentModerationDecisionV1,
  type NpAgentModerationReasonCode,
  type NpAgentProviderContextClassificationV1,
  type NpAgentProviderDataClass,
  type NpAgentProviderInvokeOutcomeV1,
  type NpAgentProviderRequestCanonicalV1,
  type NpAgentProviderResponseCanonicalV1,
  type NpAgentProviderTaskOutputV1,
  type NpAgentProviderUsageV1,
  type NpAgentRecipeId,
  type NpAgentRecipeTask,
} from "./types.js";

const REQUEST_PURPOSE = "np.agent-provider-request.v1" as const;
const RESPONSE_PURPOSE = "np.agent-provider-response.v1" as const;
const RECIPE_IDS = new Set<string>(npAgentRecipeIds);
const RECIPE_TASKS = new Set<string>(npAgentRecipeTasks);
const MODERATION_CODES = new Set<string>(npAgentModerationReasonCodes);
const GUARDIAN_CODES = new Set<string>(npAgentGuardianAssessmentCodes);
const TRUSTED_CONTEXT_KINDS = new Set<string>(["policy", "schema", "capability", "server-fact"]);
const EVIDENCE_KINDS = new Set<string>(["content", "event", "signal", "incident", "ops-check"]);
const MAXIMUM_CONTEXT_ENTRIES = 64;
const MAXIMUM_CONTEXT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TOOLS = npAgentCapabilityIds.length;
const MAXIMUM_DECISION_CODES = 20;
type ProviderFailureErrorClass = Extract<
  NpAgentProviderInvokeOutcomeV1,
  { status: "failed" }
>["errorClass"];
const RETRYABLE_ERROR_CLASSES = new Set<ProviderFailureErrorClass>([
  "rate-limited",
  "transient",
  "timeout",
  "invalid-output",
]);
const RECIPE_TASK_BY_ID = {
  "publisher.stale-content": "interactive-capability",
  "moderator.repeated-link-spam": "moderation-classification",
  "operator.worker-not-draining": "interactive-capability",
  "guardian.credential-stuffing": "guardian-assessment",
  "guardian.agent-abuse": "guardian-assessment",
} as const satisfies Record<NpAgentRecipeId, NpAgentRecipeTask>;
const UTF8_ENCODER = new TextEncoder();
const PROVIDER_ERROR_CLASSES = new Set<ProviderFailureErrorClass>([
  "authentication",
  "rate-limited",
  "transient",
  "timeout",
  "invalid-request",
  "invalid-output",
  "content-policy",
  "cancelled",
  "unknown",
]);

export const npAgentProviderRequestCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "providerCallId",
  "runId",
  "sequence",
  "retryOfId",
  "idempotencyKey",
  "connection",
  "provider",
  "model",
  "recipe",
  "task",
  "instruction",
  "trustedContext",
  "untrustedEvidence",
  "classificationManifestDigest",
  "responseSchema",
  "responseSchemaDigest",
  "responseSchemaClassification",
  "tools",
  "limits",
  "pricing",
  "dataClass",
  "dataClassCeiling",
] as const satisfies readonly (keyof NpAgentProviderRequestCanonicalV1)[];

export const npAgentProviderRequestCanonicalExcludedKeysV1 = [
  "requestHash",
  "requestDigest",
  "requestRedacted",
  "state",
  "dispatchState",
  "usageReservationId",
  "responseDigest",
  "responseRedacted",
  "decision",
  "providerRequestId",
  "errorClass",
  "retryable",
  "usage",
  "finishReason",
  "latencyMs",
  "startedAt",
  "finishedAt",
  "diagnosticExpiresAt",
  "createdAt",
] as const;

export const npAgentProviderResponseCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "providerCallId",
  "runId",
  "requestDigest",
  "dispatchState",
  "outcome",
  "decision",
  "observedAt",
] as const satisfies readonly (keyof NpAgentProviderResponseCanonicalV1)[];

export const npAgentProviderResponseCanonicalExcludedKeysV1 = [
  "responseHash",
  "responseDigest",
  "responseRedacted",
  "requestRedacted",
  "usageReservationId",
  "state",
  "retryAttempt",
  "reconciledAt",
  "diagnosticExpiresAt",
  "createdAt",
  "finishedAt",
] as const;

function parseClassification(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  expectedSourceDigest?: string,
): NpAgentProviderContextClassificationV1 {
  const keys = ["dataClass", "classifierId", "classifierVersion", "sourceDigest"] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  const result: NpAgentProviderContextClassificationV1 = {
    dataClass: parseProviderDataClass(record.dataClass, `${path}.dataClass`),
    classifierId: parseCanonicalIdentifier(record.classifierId, `${path}.classifierId`),
    classifierVersion: parseCanonicalInteger(
      record.classifierVersion,
      `${path}.classifierVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    sourceDigest: parseCanonicalSha256(record.sourceDigest, `${path}.sourceDigest`),
  };
  if (expectedSourceDigest !== undefined && result.sourceDigest !== expectedSourceDigest) {
    failCanonicalBody(
      "invalid-field",
      `${path}.sourceDigest`,
      "must equal the classified source digest",
    );
  }
  return result;
}

function compareTuple(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function parseProviderRequestCanonical(value: unknown): NpAgentProviderRequestCanonicalV1 {
  const path = "agent.canonical.providerRequest";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[REQUEST_PURPOSE]),
    path,
    npAgentProviderRequestCanonicalIncludedKeysV1,
    npAgentProviderRequestCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== REQUEST_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${REQUEST_PURPOSE}`);
  }
  const connection = canonicalBodyRecord(
    record.connection,
    `${path}.connection`,
    [
      "id",
      "configSnapshotId",
      "configVersion",
      "configHash",
      "secretVersionId",
      "credentialVersion",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
    ],
    [
      "id",
      "configSnapshotId",
      "configVersion",
      "configHash",
      "secretVersionId",
      "credentialVersion",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
    ],
    state,
  );
  const recipe = canonicalBodyRecord(
    record.recipe,
    `${path}.recipe`,
    ["id", "version", "fingerprint"],
    ["id", "version", "fingerprint"],
    state,
  );
  const recipeId = canonicalBodyEnum<NpAgentRecipeId>(recipe.id, `${path}.recipe.id`, RECIPE_IDS);
  const instruction = canonicalBodyRecord(
    record.instruction,
    `${path}.instruction`,
    ["templateId", "templateVersion", "digest", "classification", "text"],
    ["templateId", "templateVersion", "digest", "classification", "text"],
    state,
  );
  const instructionDigest = parseCanonicalSha256(instruction.digest, `${path}.instruction.digest`);
  const instructionClassification = parseClassification(
    instruction.classification,
    `${path}.instruction.classification`,
    state,
    instructionDigest,
  );
  const trustedValues = canonicalBodyArray(
    record.trustedContext,
    `${path}.trustedContext`,
    MAXIMUM_CONTEXT_ENTRIES,
    state,
  );
  const trustedContext: NpAgentProviderRequestCanonicalV1["trustedContext"] = [];
  let previousTrusted: readonly string[] | undefined;
  trustedValues.forEach((entry, index) => {
    const entryPath = `${path}.trustedContext[${index.toString()}]`;
    const item = canonicalBodyRecord(
      entry,
      entryPath,
      ["id", "kind", "digest", "classification", "text"],
      ["id", "kind", "digest", "classification", "text"],
      state,
    );
    const digest = parseCanonicalSha256(item.digest, `${entryPath}.digest`);
    const current = {
      id: parseCanonicalAscii(item.id, `${entryPath}.id`, 128),
      kind: canonicalBodyEnum<"policy" | "schema" | "capability" | "server-fact">(
        item.kind,
        `${entryPath}.kind`,
        TRUSTED_CONTEXT_KINDS,
      ),
      digest,
      classification: parseClassification(
        item.classification,
        `${entryPath}.classification`,
        state,
        digest,
      ),
      text: canonicalRuntimeText(item.text, `${entryPath}.text`, PROVIDER_COMPONENT_MAXIMUM, {
        allowEmpty: true,
      }),
    };
    const tuple = [current.kind, current.id, current.digest] as const;
    if (previousTrusted !== undefined) {
      const order = compareTuple(tuple, previousTrusted);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted unique by (kind,id,digest)",
        );
      }
    }
    trustedContext.push(current);
    previousTrusted = tuple;
  });
  const evidenceValues = canonicalBodyArray(
    record.untrustedEvidence,
    `${path}.untrustedEvidence`,
    MAXIMUM_CONTEXT_ENTRIES,
    state,
  );
  const untrustedEvidence: NpAgentProviderRequestCanonicalV1["untrustedEvidence"] = [];
  let previousEvidence: readonly string[] | undefined;
  evidenceValues.forEach((entry, index) => {
    const entryPath = `${path}.untrustedEvidence[${index.toString()}]`;
    const item = canonicalBodyRecord(
      entry,
      entryPath,
      ["id", "kind", "digest", "observedAt", "classification", "text"],
      ["id", "kind", "digest", "observedAt", "classification", "text"],
      state,
    );
    const digest = parseCanonicalSha256(item.digest, `${entryPath}.digest`);
    const current = {
      id: parseCanonicalAscii(item.id, `${entryPath}.id`, 128),
      kind: canonicalBodyEnum<"content" | "event" | "signal" | "incident" | "ops-check">(
        item.kind,
        `${entryPath}.kind`,
        EVIDENCE_KINDS,
      ),
      digest,
      observedAt: parseCanonicalUtc(item.observedAt, `${entryPath}.observedAt`),
      classification: parseClassification(
        item.classification,
        `${entryPath}.classification`,
        state,
        digest,
      ),
      text: canonicalRuntimeText(item.text, `${entryPath}.text`, PROVIDER_COMPONENT_MAXIMUM, {
        allowEmpty: true,
      }),
    };
    const tuple = [current.kind, current.id, current.observedAt, current.digest] as const;
    if (previousEvidence !== undefined) {
      const order = compareTuple(tuple, previousEvidence);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted unique by (kind,id,observedAt,digest)",
        );
      }
    }
    untrustedEvidence.push(current);
    previousEvidence = tuple;
  });
  const responseSchemaDigest = parseCanonicalSha256(
    record.responseSchemaDigest,
    `${path}.responseSchemaDigest`,
  );
  const responseSchemaClassification = parseClassification(
    record.responseSchemaClassification,
    `${path}.responseSchemaClassification`,
    state,
    responseSchemaDigest,
  );
  const toolValues = canonicalBodyArray(record.tools, `${path}.tools`, MAXIMUM_TOOLS, state);
  const tools: NpAgentProviderRequestCanonicalV1["tools"] = [];
  let previousToolId: string | undefined;
  toolValues.forEach((entry, index) => {
    const entryPath = `${path}.tools[${index.toString()}]`;
    const item = canonicalBodyRecord(
      entry,
      entryPath,
      ["capabilityId", "descriptorFingerprint", "classification", "inputSchema"],
      ["capabilityId", "descriptorFingerprint", "classification", "inputSchema"],
      state,
    );
    const capabilityId = parseCanonicalCapabilityId(item.capabilityId, `${entryPath}.capabilityId`);
    if (previousToolId !== undefined && capabilityId <= previousToolId) {
      failCanonicalBody(
        capabilityId === previousToolId ? "duplicate" : "order",
        `${entryPath}.capabilityId`,
        "must be sorted unique by capability id",
      );
    }
    const descriptorFingerprint = parseCanonicalSha256(
      item.descriptorFingerprint,
      `${entryPath}.descriptorFingerprint`,
    );
    tools.push({
      capabilityId,
      descriptorFingerprint,
      classification: parseClassification(
        item.classification,
        `${entryPath}.classification`,
        state,
        descriptorFingerprint,
      ),
      inputSchema: parseCanonicalJsonSchema(item.inputSchema, `${entryPath}.inputSchema`),
    });
    previousToolId = capabilityId;
  });
  const limits = canonicalBodyRecord(
    record.limits,
    `${path}.limits`,
    ["maxInputTokens", "maxOutputTokens", "timeoutSeconds"],
    ["maxInputTokens", "maxOutputTokens", "timeoutSeconds"],
    state,
  );
  const provider = parseCanonicalIdentifier(record.provider, `${path}.provider`);
  const model = parseCanonicalAscii(record.model, `${path}.model`, 128);
  const pricing = parseAgentModelPricing(record.pricing, `${path}.pricing`, state);
  if (pricing.modelId !== model) {
    failCanonicalBody("invalid-field", `${path}.pricing.modelId`, "must equal the selected model");
  }
  const dataClass = parseProviderDataClass(record.dataClass, `${path}.dataClass`);
  const dataClassCeiling = parseProviderDataClass(
    record.dataClassCeiling,
    `${path}.dataClassCeiling`,
  );
  if (
    UTF8_ENCODER.encode(serializeAgentCanonicalJson({ trustedContext, untrustedEvidence }))
      .byteLength > MAXIMUM_CONTEXT_BYTES
  ) {
    failCanonicalBody(
      "limit",
      `${path}.trustedContext`,
      "trusted context and untrusted evidence may use at most 2 MiB combined",
    );
  }
  const classifications = [
    instructionClassification,
    ...trustedContext.map((entry) => entry.classification),
    ...untrustedEvidence.map((entry) => entry.classification),
    responseSchemaClassification,
    ...tools.map((entry) => entry.classification),
  ];
  const computedClass = classifications.reduce<NpAgentProviderDataClass>(
    (highest, current) =>
      npAgentProviderDataClassRank[current.dataClass] > npAgentProviderDataClassRank[highest]
        ? current.dataClass
        : highest,
    "public-only",
  );
  if (computedClass !== dataClass) {
    failCanonicalBody(
      "invalid-field",
      `${path}.dataClass`,
      "must equal the maximum classified component class",
    );
  }
  if (npAgentProviderDataClassRank[dataClass] > npAgentProviderDataClassRank[dataClassCeiling]) {
    failCanonicalBody("invalid-field", `${path}.dataClass`, "must not exceed dataClassCeiling");
  }
  const task = canonicalBodyEnum<NpAgentRecipeTask>(record.task, `${path}.task`, RECIPE_TASKS);
  if (task !== RECIPE_TASK_BY_ID[recipeId]) {
    failCanonicalBody("invalid-field", `${path}.task`, "must match the selected recipe task");
  }
  if (task !== "interactive-capability" && tools.length !== 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.tools`,
      "moderation and Guardian tasks must not expose capability tools",
    );
  }
  const result: NpAgentProviderRequestCanonicalV1 = {
    schemaVersion: REQUEST_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    providerCallId: parseCanonicalUuid(record.providerCallId, `${path}.providerCallId`),
    runId: parseCanonicalUuid(record.runId, `${path}.runId`),
    sequence: parseCanonicalInteger(record.sequence, `${path}.sequence`, 1, SIGNED_32_BIT_MAXIMUM),
    retryOfId:
      record.retryOfId === null ? null : parseCanonicalUuid(record.retryOfId, `${path}.retryOfId`),
    idempotencyKey: canonicalRuntimeIdempotencyKey(record.idempotencyKey, `${path}.idempotencyKey`),
    connection: {
      id: parseCanonicalUuid(connection.id, `${path}.connection.id`),
      configSnapshotId: parseCanonicalUuid(
        connection.configSnapshotId,
        `${path}.connection.configSnapshotId`,
      ),
      configVersion: parseCanonicalInteger(
        connection.configVersion,
        `${path}.connection.configVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      configHash: parseCanonicalSha256(connection.configHash, `${path}.connection.configHash`),
      secretVersionId: parseCanonicalUuid(
        connection.secretVersionId,
        `${path}.connection.secretVersionId`,
      ),
      credentialVersion: parseCanonicalInteger(
        connection.credentialVersion,
        `${path}.connection.credentialVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      adapterId: parseCanonicalIdentifier(connection.adapterId, `${path}.connection.adapterId`),
      adapterContractVersion: parseCanonicalInteger(
        connection.adapterContractVersion,
        `${path}.connection.adapterContractVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      adapterFingerprint: parseCanonicalSha256(
        connection.adapterFingerprint,
        `${path}.connection.adapterFingerprint`,
      ),
    },
    provider,
    model,
    recipe: {
      id: recipeId,
      version: parseCanonicalInteger(
        recipe.version,
        `${path}.recipe.version`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      fingerprint: parseCanonicalSha256(recipe.fingerprint, `${path}.recipe.fingerprint`),
    },
    task,
    instruction: {
      templateId: parseCanonicalIdentifier(
        instruction.templateId,
        `${path}.instruction.templateId`,
      ),
      templateVersion: parseCanonicalInteger(
        instruction.templateVersion,
        `${path}.instruction.templateVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      digest: instructionDigest,
      classification: instructionClassification,
      text: canonicalRuntimeText(
        instruction.text,
        `${path}.instruction.text`,
        PROVIDER_COMPONENT_MAXIMUM,
      ),
    },
    trustedContext,
    untrustedEvidence,
    classificationManifestDigest: parseCanonicalSha256(
      record.classificationManifestDigest,
      `${path}.classificationManifestDigest`,
    ),
    responseSchema: parseCanonicalJsonSchema(record.responseSchema, `${path}.responseSchema`),
    responseSchemaDigest,
    responseSchemaClassification,
    tools,
    limits: {
      maxInputTokens: parseCanonicalInteger(
        limits.maxInputTokens,
        `${path}.limits.maxInputTokens`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      maxOutputTokens: parseCanonicalInteger(
        limits.maxOutputTokens,
        `${path}.limits.maxOutputTokens`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      timeoutSeconds: parseCanonicalInteger(
        limits.timeoutSeconds,
        `${path}.limits.timeoutSeconds`,
        1,
        86_400,
      ),
    },
    pricing,
    dataClass,
    dataClassCeiling,
  };
  buildAgentCanonicalFoundationBytes(REQUEST_PURPOSE, result);
  return result;
}

function parseUsage(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentProviderUsageV1 {
  const keys = [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "tokenSource",
    "costMicros",
    "costSource",
  ] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  const result: NpAgentProviderUsageV1 = {
    inputTokens: parseCanonicalInteger(
      record.inputTokens,
      `${path}.inputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    cachedInputTokens: parseCanonicalInteger(
      record.cachedInputTokens,
      `${path}.cachedInputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    outputTokens: parseCanonicalInteger(
      record.outputTokens,
      `${path}.outputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    tokenSource: canonicalBodyEnum(
      record.tokenSource,
      `${path}.tokenSource`,
      new Set(["provider", "adapter-estimate"]),
    ),
    costMicros: parseCanonicalInteger(
      record.costMicros,
      `${path}.costMicros`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    costSource: canonicalBodyEnum(
      record.costSource,
      `${path}.costSource`,
      new Set(["provider", "adapter-estimate"]),
    ),
  };
  if (result.cachedInputTokens > result.inputTokens) {
    failCanonicalBody("invalid-field", `${path}.cachedInputTokens`, "must not exceed inputTokens");
  }
  return result;
}

function parseOutcome(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentProviderInvokeOutcomeV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact provider outcome branch");
  }
  const status = Object.getOwnPropertyDescriptor(value, "status")?.value;
  const common = [
    "schemaVersion",
    "status",
    "provider",
    "model",
    "providerRequestId",
    "output",
  ] as const;
  const keys =
    status === "succeeded"
      ? [...common, "usage", "finishReason", "latencyMs"]
      : [
          ...common,
          "errorClass",
          "safeCode",
          "retryable",
          "dispatchState",
          "usage",
          "finishReason",
          "latencyMs",
        ];
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  if (record.schemaVersion !== "np.agent-provider-invoke-outcome.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-provider-invoke-outcome.v1",
    );
  }
  const commonResult = {
    schemaVersion: "np.agent-provider-invoke-outcome.v1" as const,
    provider: parseCanonicalIdentifier(record.provider, `${path}.provider`),
    model: parseCanonicalAscii(record.model, `${path}.model`, 128),
    providerRequestId:
      record.providerRequestId === null
        ? null
        : parseCanonicalAscii(record.providerRequestId, `${path}.providerRequestId`, 256),
    latencyMs: parseCanonicalInteger(
      record.latencyMs,
      `${path}.latencyMs`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
  };
  if (status === "succeeded") {
    if (record.output === null) {
      failCanonicalBody("invalid-field", `${path}.output`, "must be non-null for success");
    }
    return {
      ...commonResult,
      status: "succeeded",
      output: record.output as NpAgentJsonValue,
      usage: parseUsage(record.usage, `${path}.usage`, state),
      finishReason: canonicalBodyEnum(
        record.finishReason,
        `${path}.finishReason`,
        new Set(["stop", "length", "tool"]),
      ),
    };
  }
  if (record.output !== null) {
    failCanonicalBody("invalid-field", `${path}.output`, "must be null outside success");
  }
  if (status === "ambiguous") {
    if (
      record.retryable !== false ||
      record.dispatchState !== "unknown" ||
      record.usage !== null ||
      record.finishReason !== null
    ) {
      failCanonicalBody("invalid-field", path, "must use the exact ambiguous outcome matrix");
    }
    return {
      ...commonResult,
      status: "ambiguous",
      output: null,
      errorClass: canonicalBodyEnum(
        record.errorClass,
        `${path}.errorClass`,
        new Set(["timeout", "unknown"]),
      ),
      safeCode: canonicalRuntimeStableCode(record.safeCode, `${path}.safeCode`),
      retryable: false,
      dispatchState: "unknown",
      usage: null,
      finishReason: null,
    };
  }
  if (status !== "failed") {
    failCanonicalBody("invalid-field", `${path}.status`, "must be succeeded, failed, or ambiguous");
  }
  const dispatchState = canonicalBodyEnum<"not-dispatched" | "dispatched">(
    record.dispatchState,
    `${path}.dispatchState`,
    new Set(["not-dispatched", "dispatched"]),
  );
  const usage = record.usage === null ? null : parseUsage(record.usage, `${path}.usage`, state);
  const finishReason =
    record.finishReason === null
      ? null
      : canonicalBodyEnum<"content-filter" | "cancelled">(
          record.finishReason,
          `${path}.finishReason`,
          new Set(["content-filter", "cancelled"]),
        );
  const errorClass = canonicalBodyEnum<ProviderFailureErrorClass>(
    record.errorClass,
    `${path}.errorClass`,
    PROVIDER_ERROR_CLASSES,
  );
  const retryable =
    typeof record.retryable === "boolean"
      ? record.retryable
      : failCanonicalBody("invalid-field", `${path}.retryable`, "must be boolean");
  if (
    dispatchState === "not-dispatched" &&
    (commonResult.providerRequestId !== null || usage !== null || finishReason !== null)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      "pre-dispatch failure forbids provider receipt, usage, and finish reason",
    );
  }
  if (dispatchState === "dispatched") {
    const expectedFinishReason =
      errorClass === "content-policy"
        ? "content-filter"
        : errorClass === "cancelled"
          ? "cancelled"
          : null;
    if (finishReason !== expectedFinishReason) {
      failCanonicalBody(
        "invalid-field",
        `${path}.finishReason`,
        "must match the dispatched failure class",
      );
    }
  }
  if (retryable && !RETRYABLE_ERROR_CLASSES.has(errorClass)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.retryable`,
      "may be true only for a replay-eligible failure class",
    );
  }
  return {
    ...commonResult,
    status: "failed",
    output: null,
    errorClass,
    safeCode: canonicalRuntimeStableCode(record.safeCode, `${path}.safeCode`),
    retryable,
    dispatchState,
    usage,
    finishReason,
  };
}

function parseEvidenceRequest(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentEvidenceRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact evidence request branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "document") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "collection", "documentId", "projection"],
      ["kind", "collection", "documentId", "projection"],
      state,
    );
    return {
      kind,
      collection: parseCanonicalIdentifier(record.collection, `${path}.collection`, 96),
      documentId: parseCanonicalAscii(record.documentId, `${path}.documentId`, 128),
      projection: canonicalBodyEnum<"metadata" | "bounded-text" | "schema">(
        record.projection,
        `${path}.projection`,
        new Set(["metadata", "bounded-text", "schema"]),
      ),
    };
  }
  if (kind === "incident") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "incidentId", "projection"],
      ["kind", "incidentId", "projection"],
      state,
    );
    return {
      kind,
      incidentId: parseCanonicalUuid(record.incidentId, `${path}.incidentId`),
      projection: canonicalBodyEnum<"signals" | "timeline" | "subject-state">(
        record.projection,
        `${path}.projection`,
        new Set(["signals", "timeline", "subject-state"]),
      ),
    };
  }
  if (kind === "run") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "runId", "projection"],
      ["kind", "runId", "projection"],
      state,
    );
    return {
      kind,
      runId: parseCanonicalUuid(record.runId, `${path}.runId`),
      projection: canonicalBodyEnum<"summary" | "actions" | "checks">(
        record.projection,
        `${path}.projection`,
        new Set(["summary", "actions", "checks"]),
      ),
    };
  }
  const record = canonicalBodyRecord(value, path, ["kind", "checkId"], ["kind", "checkId"], state);
  if (record.kind !== "ops-check") {
    failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported evidence request kind");
  }
  return {
    kind: "ops-check",
    checkId: parseCanonicalIdentifier(record.checkId, `${path}.checkId`, 96),
  };
}

function parseSortedDigests(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_DECISION_CODES, state);
  const result: string[] = [];
  let previous: string | undefined;
  entries.forEach((entry, index) => {
    const current = parseCanonicalSha256(entry, `${path}[${index.toString()}]`);
    if (previous !== undefined && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseInteractiveDecision(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentInteractiveDecisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact interactive decision branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "complete") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "summary"],
      ["kind", "summary"],
      state,
    );
    return {
      kind,
      summary: canonicalRuntimeText(record.summary, `${path}.summary`, 2_000, { allowEmpty: true }),
    };
  }
  if (kind === "propose-capability") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "capabilityId", "arguments", "rationale"],
      ["kind", "capabilityId", "arguments", "rationale"],
      state,
    );
    return {
      kind,
      capabilityId: parseCanonicalCapabilityId(record.capabilityId, `${path}.capabilityId`),
      arguments: parseCanonicalJsonObject(record.arguments, `${path}.arguments`),
      rationale: canonicalRuntimeText(record.rationale, `${path}.rationale`, 2_000),
    };
  }
  const record = canonicalBodyRecord(
    value,
    path,
    ["kind", "resource"],
    ["kind", "resource"],
    state,
  );
  if (record.kind !== "request-evidence") {
    failCanonicalBody(
      "invalid-field",
      `${path}.kind`,
      "is not a supported interactive decision kind",
    );
  }
  return {
    kind: "request-evidence",
    resource: parseEvidenceRequest(record.resource, `${path}.resource`, state),
  };
}

function parseModerationDecision(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentModerationDecisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact moderation decision branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "request-evidence") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "resource"],
      ["kind", "resource"],
      state,
    );
    return { kind, resource: parseEvidenceRequest(record.resource, `${path}.resource`, state) };
  }
  const keys = [
    "kind",
    "label",
    "confidenceBasisPoints",
    "reasonCodes",
    "evidenceDigests",
    "summary",
  ] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  if (record.kind !== "classification") {
    failCanonicalBody(
      "invalid-field",
      `${path}.kind`,
      "must be classification or request-evidence",
    );
  }
  return {
    kind: "classification",
    label: canonicalBodyEnum(
      record.label,
      `${path}.label`,
      new Set(["spam", "abuse", "benign", "uncertain"]),
    ),
    confidenceBasisPoints: parseCanonicalInteger(
      record.confidenceBasisPoints,
      `${path}.confidenceBasisPoints`,
      0,
      10_000,
    ),
    reasonCodes: parseSortedUniqueEnumArray<NpAgentModerationReasonCode>(
      record.reasonCodes,
      `${path}.reasonCodes`,
      MODERATION_CODES,
      MAXIMUM_DECISION_CODES,
      state,
    ),
    evidenceDigests: parseSortedDigests(record.evidenceDigests, `${path}.evidenceDigests`, state),
    summary: canonicalRuntimeText(record.summary, `${path}.summary`, 2_000, { allowEmpty: true }),
  };
}

function parseGuardianDecision(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianDecisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact Guardian decision branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "request-evidence") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "resource"],
      ["kind", "resource"],
      state,
    );
    return { kind, resource: parseEvidenceRequest(record.resource, `${path}.resource`, state) };
  }
  const keys = [
    "kind",
    "disposition",
    "confidenceBasisPoints",
    "assessmentCodes",
    "evidenceDigests",
    "summary",
  ] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  if (record.kind !== "assessment") {
    failCanonicalBody("invalid-field", `${path}.kind`, "must be assessment or request-evidence");
  }
  return {
    kind: "assessment",
    disposition: canonicalBodyEnum(
      record.disposition,
      `${path}.disposition`,
      new Set(["consistent", "inconclusive", "unlikely"]),
    ),
    confidenceBasisPoints: parseCanonicalInteger(
      record.confidenceBasisPoints,
      `${path}.confidenceBasisPoints`,
      0,
      10_000,
    ),
    assessmentCodes: parseSortedUniqueEnumArray<NpAgentGuardianAssessmentCode>(
      record.assessmentCodes,
      `${path}.assessmentCodes`,
      GUARDIAN_CODES,
      MAXIMUM_DECISION_CODES,
      state,
    ),
    evidenceDigests: parseSortedDigests(record.evidenceDigests, `${path}.evidenceDigests`, state),
    summary: canonicalRuntimeText(record.summary, `${path}.summary`, 2_000, { allowEmpty: true }),
  };
}

function parseTaskOutput(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentProviderTaskOutputV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    ["task", "decision"],
    ["task", "decision"],
    state,
  );
  const task = canonicalBodyEnum<NpAgentRecipeTask>(record.task, `${path}.task`, RECIPE_TASKS);
  return task === "interactive-capability"
    ? { task, decision: parseInteractiveDecision(record.decision, `${path}.decision`, state) }
    : task === "moderation-classification"
      ? { task, decision: parseModerationDecision(record.decision, `${path}.decision`, state) }
      : { task, decision: parseGuardianDecision(record.decision, `${path}.decision`, state) };
}

function parseProviderResponseCanonical(value: unknown): NpAgentProviderResponseCanonicalV1 {
  const path = "agent.canonical.providerResponse";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[RESPONSE_PURPOSE]),
    path,
    npAgentProviderResponseCanonicalIncludedKeysV1,
    npAgentProviderResponseCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== RESPONSE_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${RESPONSE_PURPOSE}`);
  }
  const outcome = parseOutcome(record.outcome, `${path}.outcome`, state);
  const dispatchState = canonicalBodyEnum<"not-dispatched" | "dispatched" | "unknown">(
    record.dispatchState,
    `${path}.dispatchState`,
    new Set(["not-dispatched", "dispatched", "unknown"]),
  );
  const expectedDispatchState =
    outcome.status === "succeeded"
      ? "dispatched"
      : outcome.status === "ambiguous"
        ? "unknown"
        : outcome.dispatchState;
  if (dispatchState !== expectedDispatchState) {
    failCanonicalBody(
      "invalid-field",
      `${path}.dispatchState`,
      "must agree with the outcome branch",
    );
  }
  const decision =
    record.decision === null ? null : parseTaskOutput(record.decision, `${path}.decision`, state);
  if ((outcome.status === "succeeded") !== (decision !== null)) {
    failCanonicalBody("invalid-field", `${path}.decision`, "must be non-null exactly for success");
  }
  if (
    outcome.status === "succeeded" &&
    decision !== null &&
    serializeAgentCanonicalJson(outcome.output) !== serializeAgentCanonicalJson(decision)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.decision`,
      "must equal the parsed successful output",
    );
  }
  const result: NpAgentProviderResponseCanonicalV1 = {
    schemaVersion: RESPONSE_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    providerCallId: parseCanonicalUuid(record.providerCallId, `${path}.providerCallId`),
    runId: parseCanonicalUuid(record.runId, `${path}.runId`),
    requestDigest: parseCanonicalSha256(record.requestDigest, `${path}.requestDigest`),
    dispatchState,
    outcome,
    decision,
    observedAt: parseCanonicalUtc(record.observedAt, `${path}.observedAt`),
  };
  buildAgentCanonicalFoundationBytes(RESPONSE_PURPOSE, result);
  return result;
}

export function npAnalyzeAgentProviderRequestCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentProviderRequestCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.providerRequest", () =>
    parseProviderRequestCanonical(value),
  );
}

export function npRequireAgentProviderRequestCanonical(
  value: unknown,
): NpAgentProviderRequestCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentProviderRequestCanonical(value),
    "Invalid Agent provider-request canonical body",
  );
}

export function npBuildAgentProviderRequestCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-provider-request.v1", NpAgentProviderRequestCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    REQUEST_PURPOSE,
    npRequireAgentProviderRequestCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-provider-request.v1",
    NpAgentProviderRequestCanonicalV1
  >;
}

export async function npDigestAgentProviderRequestCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentProviderRequestCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export function npAnalyzeAgentProviderResponseCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentProviderResponseCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.providerResponse", () =>
    parseProviderResponseCanonical(value),
  );
}

export function npRequireAgentProviderResponseCanonical(
  value: unknown,
): NpAgentProviderResponseCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentProviderResponseCanonical(value),
    "Invalid Agent provider-response canonical body",
  );
}

export function npBuildAgentProviderResponseCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-provider-response.v1",
  NpAgentProviderResponseCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    RESPONSE_PURPOSE,
    npRequireAgentProviderResponseCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-provider-response.v1",
    NpAgentProviderResponseCanonicalV1
  >;
}

export async function npDigestAgentProviderResponseCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentProviderResponseCanonicalBytes(value).domainSeparatedUtf8,
  );
}
