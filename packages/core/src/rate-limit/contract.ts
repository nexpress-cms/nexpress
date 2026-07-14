import type {
  NpRateLimitDecision,
  NpRateLimiterAdapter,
  NpRateLimitRequest,
  NpRateLimitRuntimeConfig,
} from "./types.js";

export const npRateLimitContractLimits = {
  adapterKindLength: 64,
  keyLength: 2_048,
  limit: 1_000_000,
  windowMs: 2_678_400_000,
} as const;

export type NpRateLimitContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpRateLimitContractIssue {
  readonly code: NpRateLimitContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class NpRateLimitContractError extends Error {
  readonly issues: NpRateLimitContractIssue[];

  constructor(message: string, issues: NpRateLimitContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpRateLimitContractError";
    this.issues = issues;
  }
}

const requestKeys = new Set(["key", "limit", "windowMs"]);
const decisionKeys = new Set(["limited", "retryAfterSeconds"]);
const adapterKindPattern = /^[a-z][a-z0-9-]{0,63}$/u;

function issue(
  code: NpRateLimitContractIssueCode,
  path: string,
  message: string,
): NpRateLimitContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pushUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpRateLimitContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(
        issue("unknown-field", `${path}.${key}`, `unsupported rate-limit field "${key}".`),
      );
    }
  }
}

export function npAnalyzeRateLimitRequest(
  value: unknown,
  path = "rateLimit.request",
): NpRateLimitContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpRateLimitContractIssue[] = [];
  pushUnknownFields(value, requestKeys, path, issues);
  if (
    typeof value.key !== "string" ||
    value.key.length === 0 ||
    value.key.length > npRateLimitContractLimits.keyLength
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.key`,
        `must be a non-empty string no longer than ${npRateLimitContractLimits.keyLength.toString()} characters.`,
      ),
    );
  }
  if (
    typeof value.limit !== "number" ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > npRateLimitContractLimits.limit
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.limit`,
        `must be an integer from 1 through ${npRateLimitContractLimits.limit.toString()}.`,
      ),
    );
  }
  if (
    typeof value.windowMs !== "number" ||
    !Number.isSafeInteger(value.windowMs) ||
    value.windowMs < 1 ||
    value.windowMs > npRateLimitContractLimits.windowMs
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.windowMs`,
        `must be an integer from 1 through ${npRateLimitContractLimits.windowMs.toString()}.`,
      ),
    );
  }
  return issues;
}

export function npRequireRateLimitRequest(
  value: unknown,
  path = "rateLimit.request",
): NpRateLimitRequest {
  const issues = npAnalyzeRateLimitRequest(value, path);
  if (issues.length > 0) throw new NpRateLimitContractError("Invalid rate-limit request", issues);
  return value as NpRateLimitRequest;
}

export function npAnalyzeRateLimitDecision(
  value: unknown,
  request: NpRateLimitRequest,
  path = "rateLimit.decision",
): NpRateLimitContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpRateLimitContractIssue[] = [];
  pushUnknownFields(value, decisionKeys, path, issues);
  if (typeof value.limited !== "boolean") {
    issues.push(issue("invalid-field", `${path}.limited`, "must be a boolean."));
  }
  const maximumRetry = Math.ceil(request.windowMs / 1_000);
  if (
    typeof value.retryAfterSeconds !== "number" ||
    !Number.isSafeInteger(value.retryAfterSeconds) ||
    value.retryAfterSeconds < 1 ||
    value.retryAfterSeconds > maximumRetry
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.retryAfterSeconds`,
        `must be an integer from 1 through ${maximumRetry.toString()} for this window.`,
      ),
    );
  }
  return issues;
}

export function npRequireRateLimitDecision(
  value: unknown,
  request: NpRateLimitRequest,
  path = "rateLimit.decision",
): NpRateLimitDecision {
  const issues = npAnalyzeRateLimitDecision(value, request, path);
  if (issues.length > 0) throw new NpRateLimitContractError("Invalid rate-limit decision", issues);
  return value as NpRateLimitDecision;
}

export function npRequireRateLimiterAdapter(value: unknown): NpRateLimiterAdapter {
  const issues: NpRateLimitContractIssue[] = [];
  if (typeof value !== "object" || value === null) {
    issues.push(issue("shape", "rateLimit.adapter", "must be an object."));
  } else {
    const candidate = value as { kind?: unknown; check?: unknown; shutdown?: unknown };
    if (
      typeof candidate.kind !== "string" ||
      candidate.kind.length > npRateLimitContractLimits.adapterKindLength ||
      !adapterKindPattern.test(candidate.kind)
    ) {
      issues.push(
        issue(
          "invalid-field",
          "rateLimit.adapter.kind",
          "must be a canonical lowercase adapter kind.",
        ),
      );
    }
    if (typeof candidate.check !== "function") {
      issues.push(issue("invalid-field", "rateLimit.adapter.check", "must be a function."));
    }
    if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
      issues.push(
        issue("invalid-field", "rateLimit.adapter.shutdown", "must be a function when provided."),
      );
    }
  }
  if (issues.length > 0) throw new NpRateLimitContractError("Invalid rate-limit adapter", issues);
  return value as NpRateLimiterAdapter;
}

export function npReadRateLimitRuntimeConfig(
  env: Record<string, string | undefined>,
): NpRateLimitRuntimeConfig {
  const value = env.NP_RATE_LIMIT_ADAPTER;
  const adapter = value === undefined || value === "" ? "memory" : value;
  if (adapter !== "memory" && adapter !== "custom") {
    throw new NpRateLimitContractError("Invalid rate-limit runtime configuration", [
      issue("invalid-field", "env.NP_RATE_LIMIT_ADAPTER", 'must be exactly "memory" or "custom".'),
    ]);
  }
  return { adapter };
}
