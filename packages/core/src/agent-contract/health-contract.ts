import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentContractResult } from "./types.js";

const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const HEALTH_SUMMARY_MAXIMUM_BYTES = 128 * 1024;

export const npAgentDiagnosticEntitiesV1 = [
  "principal",
  "service-token",
  "oauth-client",
  "oauth-request",
  "oauth-grant",
  "oauth-refresh-token",
  "oauth-code",
  "connection",
  "connection-config",
  "invocation",
  "connection-auth-request",
  "connection-operation",
  "connection-secret",
  "vault-operation",
  "vault-entry",
  "site-deletion-saga",
] as const;

export type NpAgentDiagnosticEntityV1 = (typeof npAgentDiagnosticEntitiesV1)[number];

export const npAgentDiagnosticStatesV1 = [
  "accepted",
  "absent",
  "active",
  "active_head",
  "ambiguous",
  "approval_required",
  "authorized",
  "awaiting_secret",
  "candidate",
  "cancelled",
  "cleaning",
  "committing",
  "completed",
  "consumed",
  "denied",
  "destroyed",
  "disabled",
  "error",
  "expired",
  "failed",
  "overlap",
  "pending",
  "prepared",
  "queued",
  "ready",
  "ready_to_commit",
  "retired",
  "retiring",
  "rejected",
  "revoked",
  "running",
  "started",
  "succeeded",
  "suspended",
  "waiting_inspection",
] as const;

export type NpAgentDiagnosticStateV1 = (typeof npAgentDiagnosticStatesV1)[number];

export const npAgentContractDiagnosticIssueCodesV1 = [
  "AGENT_AUTH_REQUEST_DIVERGED",
  "AGENT_CONNECTION_CONFIG_DIVERGED",
  "AGENT_CONNECTION_OPERATION_DIVERGED",
  "AGENT_CONNECTION_POINTER_DIVERGED",
  "AGENT_DELETION_SAGA_DIVERGED",
  "AGENT_EXPIRY_BACKLOG",
  "AGENT_RELATION_CROSS_SITE",
  "AGENT_RELATION_ORPHANED",
  "AGENT_ROW_STATE_INVALID",
  "AGENT_SCHEMA_CONSTRAINT_MISSING",
  "AGENT_SCHEMA_CONSTRAINT_UNVALIDATED",
  "AGENT_SCHEMA_TABLE_MISSING",
  "AGENT_SCHEMA_UNAVAILABLE",
  "AGENT_STALE_CONNECTION_OPERATION",
  "AGENT_STALE_INVOCATION",
  "AGENT_STALE_VAULT_OPERATION",
  "AGENT_VAULT_ENTRY_DIVERGED",
  "AGENT_VAULT_OPERATION_DIVERGED",
] as const;

export type NpAgentContractDiagnosticIssueCodeV1 =
  (typeof npAgentContractDiagnosticIssueCodesV1)[number];

export const npAgentAdapterReadinessStatesV1 = [
  "not-required",
  "ready",
  "unknown",
  "unavailable",
] as const;

export type NpAgentAdapterReadinessStateV1 = (typeof npAgentAdapterReadinessStatesV1)[number];

export interface NpAgentDiagnosticStateCountV1 {
  entity: NpAgentDiagnosticEntityV1;
  state: NpAgentDiagnosticStateV1;
  count: number;
  oldestAgeSeconds: number | null;
}

export interface NpAgentContractDiagnosticIssueV1 {
  code: NpAgentContractDiagnosticIssueCodeV1;
  count: number;
  oldestAgeSeconds: number | null;
}

export interface NpAgentAdapterReadinessV1 {
  state: NpAgentAdapterReadinessStateV1;
  requiredCount: number;
  availableCount: number;
}

/**
 * Client-safe read-only Agent health projection. It deliberately contains no
 * row ids, provider subjects, adapter fingerprints, locators, keyed digests,
 * canonical inputs, operation results, or credential material.
 */
export interface NpAgentHealthSummaryV1 {
  schemaVersion: "np.agent-health-summary.v1";
  generatedAt: string;
  state: "ok" | "warn" | "error";
  issueCount: number;
  issues: NpAgentContractDiagnosticIssueV1[];
  states: NpAgentDiagnosticStateCountV1[];
  readiness: {
    providers: NpAgentAdapterReadinessV1;
    vault: NpAgentAdapterReadinessV1;
  };
}

export const npAgentHealthSummaryExcludedKeysV1 = [
  "id",
  "siteId",
  "principalId",
  "connectionId",
  "secretVersionId",
  "adapterId",
  "adapterFingerprint",
  "vaultAdapter",
  "vaultAdapterFingerprint",
  "secretRef",
  "tokenHash",
  "stateHash",
  "requestHash",
  "requestDigest",
  "resultDigest",
  "accountSubjectDigest",
  "destinationFingerprint",
  "credential",
  "requestBody",
  "resultRedacted",
] as const;

const ENTITIES = new Set<string>(npAgentDiagnosticEntitiesV1);
const STATES = new Set<string>(npAgentDiagnosticStatesV1);
const ISSUE_CODES = new Set<string>(npAgentContractDiagnosticIssueCodesV1);
const READINESS_STATES = new Set<string>(npAgentAdapterReadinessStatesV1);
const SUMMARY_STATES = new Set<string>(["ok", "warn", "error"]);

function parseNullableAge(value: unknown, path: string): number | null {
  return value === null ? null : canonicalBodyInteger(value, path, 0, Number.MAX_SAFE_INTEGER);
}

function parseStateCounts(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentDiagnosticStateCountV1[] {
  const rows = canonicalBodyArray(value, path, 256, state);
  const result: NpAgentDiagnosticStateCountV1[] = [];
  let previous = "";
  rows.forEach((row, index) => {
    const rowPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      row,
      rowPath,
      ["entity", "state", "count", "oldestAgeSeconds"],
      ["entity", "state", "count", "oldestAgeSeconds"],
      state,
    );
    const entity = canonicalBodyEnum<NpAgentDiagnosticEntityV1>(
      record.entity,
      `${rowPath}.entity`,
      ENTITIES,
    );
    const rowState = canonicalBodyEnum<NpAgentDiagnosticStateV1>(
      record.state,
      `${rowPath}.state`,
      STATES,
    );
    const key = `${entity}\0${rowState}`;
    if (key <= previous) {
      failCanonicalBody(
        key === previous ? "duplicate" : "order",
        rowPath,
        "state summaries must be sorted unique by entity and state",
      );
    }
    previous = key;
    const count = canonicalBodyInteger(
      record.count,
      `${rowPath}.count`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const oldestAgeSeconds = parseNullableAge(
      record.oldestAgeSeconds,
      `${rowPath}.oldestAgeSeconds`,
    );
    if ((count === 0) !== (oldestAgeSeconds === null)) {
      failCanonicalBody(
        "invalid-field",
        rowPath,
        "empty states require a null age and populated states require an age",
      );
    }
    result.push({ entity, state: rowState, count, oldestAgeSeconds });
  });
  return result;
}

function parseIssues(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentContractDiagnosticIssueV1[] {
  const rows = canonicalBodyArray(value, path, npAgentContractDiagnosticIssueCodesV1.length, state);
  const result: NpAgentContractDiagnosticIssueV1[] = [];
  let previous = "";
  rows.forEach((row, index) => {
    const rowPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      row,
      rowPath,
      ["code", "count", "oldestAgeSeconds"],
      ["code", "count", "oldestAgeSeconds"],
      state,
    );
    const code = canonicalBodyEnum<NpAgentContractDiagnosticIssueCodeV1>(
      record.code,
      `${rowPath}.code`,
      ISSUE_CODES,
    );
    if (code <= previous) {
      failCanonicalBody(
        code === previous ? "duplicate" : "order",
        rowPath,
        "diagnostic issues must be sorted unique by code",
      );
    }
    previous = code;
    const count = canonicalBodyInteger(
      record.count,
      `${rowPath}.count`,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    result.push({
      code,
      count,
      oldestAgeSeconds: parseNullableAge(record.oldestAgeSeconds, `${rowPath}.oldestAgeSeconds`),
    });
  });
  return result;
}

function parseReadiness(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdapterReadinessV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    ["state", "requiredCount", "availableCount"],
    ["state", "requiredCount", "availableCount"],
    state,
  );
  const readinessState = canonicalBodyEnum<NpAgentAdapterReadinessStateV1>(
    record.state,
    `${path}.state`,
    READINESS_STATES,
  );
  const requiredCount = canonicalBodyInteger(
    record.requiredCount,
    `${path}.requiredCount`,
    0,
    SIGNED_32_BIT_MAXIMUM,
  );
  const availableCount = canonicalBodyInteger(
    record.availableCount,
    `${path}.availableCount`,
    0,
    requiredCount,
  );
  if (readinessState === "unknown" && availableCount !== 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.availableCount`,
      "unknown readiness cannot claim available adapters",
    );
  }
  const expectedState =
    readinessState === "unknown"
      ? "unknown"
      : requiredCount === 0
        ? "not-required"
        : availableCount === requiredCount
          ? "ready"
          : "unavailable";
  if (readinessState !== expectedState) {
    failCanonicalBody("invalid-field", `${path}.state`, "does not match the adapter counts");
  }
  return { state: readinessState, requiredCount, availableCount };
}

function parseHealthSummary(value: unknown): NpAgentHealthSummaryV1 {
  const path = "agent.health";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const cloned = cloneCanonicalRuntimeInput(value, path, HEALTH_SUMMARY_MAXIMUM_BYTES, {
    maximumDepth: 8,
  });
  const record = canonicalBodyRecord(
    cloned,
    path,
    ["schemaVersion", "generatedAt", "state", "issueCount", "issues", "states", "readiness"],
    ["schemaVersion", "generatedAt", "state", "issueCount", "issues", "states", "readiness"],
    state,
  );
  if (record.schemaVersion !== "np.agent-health-summary.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-health-summary.v1",
    );
  }
  const issues = parseIssues(record.issues, `${path}.issues`, state);
  const issueCount = canonicalBodyInteger(
    record.issueCount,
    `${path}.issueCount`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (issueCount !== issues.reduce((total, issue) => total + issue.count, 0)) {
    failCanonicalBody("invalid-field", `${path}.issueCount`, "must equal the issue total");
  }
  const readiness = canonicalBodyRecord(
    record.readiness,
    `${path}.readiness`,
    ["providers", "vault"],
    ["providers", "vault"],
    state,
  );
  const providers = parseReadiness(readiness.providers, `${path}.readiness.providers`, state);
  const vault = parseReadiness(readiness.vault, `${path}.readiness.vault`, state);
  const summaryState = canonicalBodyEnum<NpAgentHealthSummaryV1["state"]>(
    record.state,
    `${path}.state`,
    SUMMARY_STATES,
  );
  const expectedSummaryState =
    issueCount > 0
      ? "error"
      : providers.state === "ready" || providers.state === "not-required"
        ? vault.state === "ready" || vault.state === "not-required"
          ? "ok"
          : "warn"
        : "warn";
  if (summaryState !== expectedSummaryState) {
    failCanonicalBody("invalid-field", `${path}.state`, "does not match issues and readiness");
  }
  return {
    schemaVersion: "np.agent-health-summary.v1",
    generatedAt: canonicalBodyUtc(record.generatedAt, `${path}.generatedAt`),
    state: summaryState,
    issueCount,
    issues,
    states: parseStateCounts(record.states, `${path}.states`, state),
    readiness: { providers, vault },
  };
}

export function npAnalyzeAgentHealthSummaryV1(
  value: unknown,
): NpAgentContractResult<NpAgentHealthSummaryV1> {
  return analyzeCanonicalBody("agent.health", () => parseHealthSummary(value));
}

export function npRequireAgentHealthSummaryV1(value: unknown): NpAgentHealthSummaryV1 {
  return npRequireAgentContractResult(npAnalyzeAgentHealthSummaryV1(value));
}
