import { NpValidationError } from "@nexpress/core";
import {
  NP_JOB_SOURCES,
  NP_JOB_STATES,
  npNormalizeJobData,
  npRequireJobId,
  npRequireJobQueueName,
  npRequireJobsPauseState,
  npRequireJobType,
  type NpJobData,
  type NpJobSource,
  type NpJobState,
  type NpJobType,
} from "@nexpress/core/jobs-contract";

const STATE_VALUES = new Set<string>(NP_JOB_STATES);
const SOURCE_VALUES = new Set<string>(NP_JOB_SOURCES);
const RETRYABLE_STATES = new Set<NpJobState>(["failed", "cancelled", "expired"]);

export interface NpJobListQuery {
  name?: string;
  state?: NpJobState;
  limit: number;
  offset: number;
  since?: Date;
  source?: NpJobSource;
}

export function npParseJobListQuery(params: URLSearchParams): NpJobListQuery {
  requireKnownParams(params, ["name", "state", "limit", "offset", "since", "source"]);
  const name = optionalQueueName(params.get("name"), "name");
  const state = optionalState(params.get("state"));
  const source = optionalSource(params.get("source"));
  const since = optionalDate(params.get("since"));
  return {
    ...(name ? { name } : {}),
    ...(state ? { state } : {}),
    ...(source ? { source } : {}),
    ...(since ? { since } : {}),
    limit: boundedInteger(params.get("limit"), "limit", 50, 1, 200),
    offset: boundedInteger(params.get("offset"), "offset", 0, 0, 100_000),
  };
}

export function npParseRetryAllQuery(params: URLSearchParams): {
  state: "failed" | "cancelled" | "expired";
  name?: string;
} {
  requireKnownParams(params, ["state", "name"]);
  const stateRaw = params.get("state") ?? "failed";
  if (!STATE_VALUES.has(stateRaw) || !RETRYABLE_STATES.has(stateRaw as NpJobState)) {
    invalid("state", "must be failed, cancelled, or expired");
  }
  const name = optionalQueueName(params.get("name"), "name");
  return {
    state: stateRaw as "failed" | "cancelled" | "expired",
    ...(name ? { name } : {}),
  };
}

export function npParseJobLogsQuery(params: URLSearchParams): {
  limit?: number;
  offset?: number;
} {
  requireKnownParams(params, ["limit", "offset"]);
  const limit = params.get("limit");
  const offset = params.get("offset");
  return {
    ...(limit === null ? {} : { limit: boundedInteger(limit, "limit", 200, 1, 1_000) }),
    ...(offset === null ? {} : { offset: boundedInteger(offset, "offset", 0, 0, 100_000) }),
  };
}

export function npParseEnqueueJobBody(value: unknown): {
  type: NpJobType;
  data: NpJobData;
} {
  const body = exactBody(value, ["type", "data"]);
  const type = parseInputContract("type", () => npRequireJobType(body.type));
  return {
    type,
    data: parseInputContract("data", () => npNormalizeJobData(body.data)),
  };
}

export function npParseJobId(value: unknown): string {
  return parseInputContract("id", () => npRequireJobId(value));
}

export function npParseEmptyJobBody(value: unknown): void {
  exactBody(value, []);
}

export function npParseEmptyJobQuery(params: URLSearchParams): void {
  requireKnownParams(params, []);
}

export function npParsePauseJobBody(value: unknown): { reason: string | null } {
  const body = exactBody(value, [], ["reason"]);
  if (body.reason === undefined || body.reason === null) return { reason: null };
  return {
    reason: parseInputContract(
      "reason",
      () =>
        npRequireJobsPauseState({
          paused: true,
          changedAt: new Date(0).toISOString(),
          changedByUserId: null,
          reason: body.reason,
        }).reason,
    ),
  };
}

export function npRequireJobApiResponse<T>(value: unknown, parser: (candidate: unknown) => T): T {
  try {
    return parser(value);
  } catch (error) {
    throw new Error(
      `Job API response contract violation: ${error instanceof Error ? error.message : "invalid response"}`,
      { cause: error },
    );
  }
}

function exactBody(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body", "must be a JSON object");
  }
  const body = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(body) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("body", "must be a plain JSON object");
  }
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(body)) {
    if (typeof key !== "string") invalid("body", "must not contain symbol properties");
    const descriptor = Object.getOwnPropertyDescriptor(body, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(key, "must be an enumerable plain data property");
    }
    keys.push(key);
  }
  const allowed = new Set([...required, ...optional]);
  const unsupported = keys.find((key) => !allowed.has(key));
  if (unsupported) invalid(unsupported, "is not supported");
  const present = new Set(keys);
  const missing = required.find((key) => !present.has(key));
  if (missing) invalid(missing, "is required");
  return body;
}

function requireKnownParams(params: URLSearchParams, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of new Set(params.keys())) {
    if (!allowedSet.has(key)) invalid(key, "is not supported");
    if (params.getAll(key).length !== 1) invalid(key, "must appear exactly once");
  }
}

function optionalQueueName(value: string | null, field: string): string | undefined {
  return value === null
    ? undefined
    : parseInputContract(field, () => npRequireJobQueueName(value, field));
}

function optionalState(value: string | null): NpJobState | undefined {
  if (value === null) return undefined;
  if (!STATE_VALUES.has(value)) invalid("state", `must be one of ${NP_JOB_STATES.join(", ")}`);
  return value as NpJobState;
}

function optionalSource(value: string | null): NpJobSource | undefined {
  if (value === null) return undefined;
  if (!SOURCE_VALUES.has(value)) invalid("source", `must be one of ${NP_JOB_SOURCES.join(", ")}`);
  return value as NpJobSource;
}

function optionalDate(value: string | null): Date | undefined {
  if (value === null) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    invalid("since", "must be a canonical UTC ISO timestamp");
  }
  return date;
}

function boundedInteger(
  value: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) invalid(field, "must be a non-negative integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    invalid(field, `must be between ${min.toString()} and ${max.toString()}`);
  }
  return parsed;
}

function invalid(field: string, message: string): never {
  throw new NpValidationError("Invalid input", [{ field, message }]);
}

function parseInputContract<T>(field: string, parser: () => T): T {
  try {
    return parser();
  } catch (error) {
    if (error instanceof NpValidationError) throw error;
    invalid(field, error instanceof Error ? error.message : "does not satisfy the job contract");
  }
}
