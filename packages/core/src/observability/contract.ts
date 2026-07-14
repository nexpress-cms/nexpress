import type {
  NpErrorReportContext,
  NpErrorReporter,
  NpLogContext,
  NpLogEvent,
  NpLoggerAdapter,
  NpObservabilityAdapters,
  NpObservabilityRuntimeConfig,
} from "./types.js";

export const npObservabilityContractLimits = {
  adapterKindLength: 64,
  messageLength: 64_000,
  contextKeys: 1_000,
  contextKeyLength: 160,
  tagKeys: 100,
  tagValueLength: 2_048,
  userValueLength: 2_048,
  failureMessageLength: 8_192,
} as const;

export type NpObservabilityContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpObservabilityContractIssue {
  readonly code: NpObservabilityContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class NpObservabilityContractError extends Error {
  readonly issues: NpObservabilityContractIssue[];

  constructor(message: string, issues: NpObservabilityContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpObservabilityContractError";
    this.issues = issues;
  }
}

const adapterKindPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const contextKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const logLevels = new Set(["debug", "info", "warn", "error"]);
const eventKeys = new Set(["level", "message", "context"]);
const reportContextKeys = new Set(["tags", "user", "extra"]);
const reportUserKeys = new Set(["id", "email", "role"]);
const runtimeKeys = new Set(["logger", "errorReporter"]);
const adapterOptionKeys = new Set(["logger", "errorReporter"]);

function issue(
  code: NpObservabilityContractIssueCode,
  path: string,
  message: string,
): NpObservabilityContractIssue {
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
  issues: NpObservabilityContractIssue[],
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      issues.push(
        issue(
          "unknown-field",
          `${path}.${typeof key === "string" ? key : (key.description ?? "symbol")}`,
          "is not supported by the observability contract.",
        ),
      );
    }
  }
}

function boundedString(
  value: unknown,
  maximum: number,
  options: { allowEmpty?: boolean; requireTrimmed?: boolean } = {},
): value is string {
  return (
    typeof value === "string" &&
    (options.allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    (!options.requireTrimmed || value === value.trim()) &&
    !value.includes("\0")
  );
}

function analyzeContext(
  value: unknown,
  path: string,
  maximumKeys: number,
): NpObservabilityContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const keys = Reflect.ownKeys(value);
  const issues: NpObservabilityContractIssue[] = [];
  if (keys.length > maximumKeys) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must contain at most ${maximumKeys.toString()} top-level fields.`,
      ),
    );
  }
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length > npObservabilityContractLimits.contextKeyLength ||
      !contextKeyPattern.test(key)
    ) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${typeof key === "string" ? key : (key.description ?? "symbol")}`,
          "must use a bounded alphanumeric structured-context key.",
        ),
      );
    }
  }
  return issues;
}

function analyzeLogger(value: unknown, path: string): NpObservabilityContractIssue[] {
  if (typeof value !== "object" || value === null) {
    return [issue("shape", path, "must be an object.")];
  }
  const candidate = value as Record<string, unknown>;
  const issues: NpObservabilityContractIssue[] = [];
  if (
    !boundedString(candidate.kind, npObservabilityContractLimits.adapterKindLength) ||
    !adapterKindPattern.test(candidate.kind)
  ) {
    issues.push(
      issue("invalid-field", `${path}.kind`, "must be a canonical lowercase adapter kind."),
    );
  }
  for (const method of ["debug", "info", "warn", "error"] as const) {
    if (typeof candidate[method] !== "function") {
      issues.push(issue("invalid-field", `${path}.${method}`, "must be a function."));
    }
  }
  for (const method of ["child", "shutdown"] as const) {
    if (candidate[method] !== undefined && typeof candidate[method] !== "function") {
      issues.push(issue("invalid-field", `${path}.${method}`, "must be a function when provided."));
    }
  }
  return issues;
}

export function npAnalyzeLogger(value: unknown): NpObservabilityContractIssue[] {
  return analyzeLogger(value, "observability.logger");
}

export function npRequireLogger(value: unknown, path = "observability.logger"): NpLoggerAdapter {
  const issues = analyzeLogger(value, path);
  if (issues.length > 0) throw new NpObservabilityContractError("Invalid logger adapter", issues);
  return value as NpLoggerAdapter;
}

export function npAnalyzeErrorReporter(value: unknown): NpObservabilityContractIssue[] {
  const path = "observability.errorReporter";
  if (typeof value !== "object" || value === null) {
    return [issue("shape", path, "must be an object.")];
  }
  const candidate = value as Record<string, unknown>;
  const issues: NpObservabilityContractIssue[] = [];
  if (
    !boundedString(candidate.kind, npObservabilityContractLimits.adapterKindLength) ||
    !adapterKindPattern.test(candidate.kind)
  ) {
    issues.push(
      issue("invalid-field", `${path}.kind`, "must be a canonical lowercase adapter kind."),
    );
  }
  if (typeof candidate.captureException !== "function") {
    issues.push(issue("invalid-field", `${path}.captureException`, "must be a function."));
  }
  if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
    issues.push(issue("invalid-field", `${path}.shutdown`, "must be a function when provided."));
  }
  return issues;
}

export function npRequireErrorReporter(value: unknown): NpErrorReporter {
  const issues = npAnalyzeErrorReporter(value);
  if (issues.length > 0) {
    throw new NpObservabilityContractError("Invalid error reporter adapter", issues);
  }
  return value as NpErrorReporter;
}

export function npAnalyzeLogEvent(
  value: unknown,
  path = "observability.log",
): NpObservabilityContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpObservabilityContractIssue[] = [];
  pushUnknownFields(value, eventKeys, path, issues);
  if (typeof value.level !== "string" || !logLevels.has(value.level)) {
    issues.push(issue("invalid-field", `${path}.level`, "must be debug, info, warn, or error."));
  }
  if (!boundedString(value.message, npObservabilityContractLimits.messageLength)) {
    issues.push(issue("invalid-field", `${path}.message`, "must be a bounded non-empty string."));
  }
  if (value.context !== undefined) {
    issues.push(
      ...analyzeContext(
        value.context,
        `${path}.context`,
        npObservabilityContractLimits.contextKeys,
      ),
    );
  }
  return issues;
}

export function npRequireLogEvent(value: unknown, path = "observability.log"): NpLogEvent {
  const issues = npAnalyzeLogEvent(value, path);
  if (issues.length > 0) throw new NpObservabilityContractError("Invalid log event", issues);
  return value as NpLogEvent;
}

export function npRequireLogContext(
  value: unknown,
  path = "observability.log.context",
): NpLogContext {
  const issues = analyzeContext(value, path, npObservabilityContractLimits.contextKeys);
  if (issues.length > 0) throw new NpObservabilityContractError("Invalid log context", issues);
  return value as NpLogContext;
}

export function npAnalyzeErrorReportContext(
  value: unknown,
  path = "observability.errorReport.context",
): NpObservabilityContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpObservabilityContractIssue[] = [];
  pushUnknownFields(value, reportContextKeys, path, issues);
  if (value.tags !== undefined) {
    const tags = value.tags;
    const tagIssues = analyzeContext(tags, `${path}.tags`, npObservabilityContractLimits.tagKeys);
    issues.push(...tagIssues);
    if (tagIssues.length === 0 && isPlainRecord(tags)) {
      for (const [key, tagValue] of Object.entries(tags)) {
        if (
          !boundedString(tagValue, npObservabilityContractLimits.tagValueLength, {
            requireTrimmed: true,
          })
        ) {
          issues.push(
            issue("invalid-field", `${path}.tags.${key}`, "must be a bounded non-empty string."),
          );
        }
      }
    }
  }
  if (value.user !== undefined) {
    if (!isPlainRecord(value.user)) {
      issues.push(issue("shape", `${path}.user`, "must be a plain object."));
    } else {
      pushUnknownFields(value.user, reportUserKeys, `${path}.user`, issues);
      for (const key of reportUserKeys) {
        const userValue = value.user[key];
        if (
          userValue !== undefined &&
          !boundedString(userValue, npObservabilityContractLimits.userValueLength, {
            requireTrimmed: true,
          })
        ) {
          issues.push(
            issue(
              "invalid-field",
              `${path}.user.${key}`,
              "must be a bounded non-empty string when provided.",
            ),
          );
        }
      }
    }
  }
  if (value.extra !== undefined) {
    issues.push(
      ...analyzeContext(value.extra, `${path}.extra`, npObservabilityContractLimits.contextKeys),
    );
  }
  return issues;
}

export function npRequireErrorReportContext(
  value: unknown,
  path = "observability.errorReport.context",
): NpErrorReportContext {
  const issues = npAnalyzeErrorReportContext(value, path);
  if (issues.length > 0) {
    throw new NpObservabilityContractError("Invalid error report context", issues);
  }
  return value as NpErrorReportContext;
}

export function npRequireReportedError(value: unknown): Error {
  if (!(value instanceof Error)) {
    throw new NpObservabilityContractError("Invalid reported error", [
      issue("invalid-field", "observability.errorReport.error", "must be an Error instance."),
    ]);
  }
  return value;
}

export function npReadObservabilityRuntimeConfig(
  env: Record<string, string | undefined>,
): NpObservabilityRuntimeConfig {
  const logger = env.NP_LOGGER_ADAPTER || "console";
  const errorReporter = env.NP_ERROR_REPORTER_ADAPTER || "noop";
  if (logger !== "console" && logger !== "custom") {
    throw new NpObservabilityContractError("Invalid observability runtime configuration", [
      issue("invalid-field", "env.NP_LOGGER_ADAPTER", 'must be exactly "console" or "custom".'),
    ]);
  }
  if (errorReporter !== "noop" && errorReporter !== "custom") {
    throw new NpObservabilityContractError("Invalid observability runtime configuration", [
      issue(
        "invalid-field",
        "env.NP_ERROR_REPORTER_ADAPTER",
        'must be exactly "noop" or "custom".',
      ),
    ]);
  }
  return { logger, errorReporter };
}

export function npRequireObservabilityRuntimeConfig(value: unknown): NpObservabilityRuntimeConfig {
  const path = "observability.runtime";
  if (!isPlainRecord(value)) {
    throw new NpObservabilityContractError("Invalid observability runtime configuration", [
      issue("shape", path, "must be a plain object."),
    ]);
  }
  const issues: NpObservabilityContractIssue[] = [];
  pushUnknownFields(value, runtimeKeys, path, issues);
  if (value.logger !== "console" && value.logger !== "custom") {
    issues.push(issue("invalid-field", `${path}.logger`, 'must be exactly "console" or "custom".'));
  }
  if (value.errorReporter !== "noop" && value.errorReporter !== "custom") {
    issues.push(
      issue("invalid-field", `${path}.errorReporter`, 'must be exactly "noop" or "custom".'),
    );
  }
  if (issues.length > 0) {
    throw new NpObservabilityContractError("Invalid observability runtime configuration", issues);
  }
  return value as unknown as NpObservabilityRuntimeConfig;
}

export function npRequireObservabilityAdapters(value: unknown): NpObservabilityAdapters {
  const path = "observability.adapters";
  if (!isPlainRecord(value)) {
    throw new NpObservabilityContractError("Invalid observability adapters", [
      issue("shape", path, "must be a plain object."),
    ]);
  }
  const issues: NpObservabilityContractIssue[] = [];
  pushUnknownFields(value, adapterOptionKeys, path, issues);
  if (value.logger !== undefined) issues.push(...analyzeLogger(value.logger, `${path}.logger`));
  if (value.errorReporter !== undefined) {
    const reporterIssues = npAnalyzeErrorReporter(value.errorReporter).map((entry) => ({
      ...entry,
      path: entry.path.replace("observability.errorReporter", `${path}.errorReporter`),
    }));
    issues.push(...reporterIssues);
  }
  if (issues.length > 0) {
    throw new NpObservabilityContractError("Invalid observability adapters", issues);
  }
  return value;
}

export function npObservabilityAdaptersMatchRuntimeConfig(
  config: NpObservabilityRuntimeConfig,
  logger: NpLoggerAdapter,
  errorReporter: NpErrorReporter,
): boolean {
  const validated = npRequireObservabilityRuntimeConfig(config);
  const validatedLogger = npRequireLogger(logger);
  const validatedReporter = npRequireErrorReporter(errorReporter);
  return (
    (validated.logger === "console"
      ? validatedLogger.kind === "console"
      : validatedLogger.kind !== "console") &&
    (validated.errorReporter === "noop"
      ? validatedReporter.kind === "noop"
      : validatedReporter.kind !== "noop")
  );
}

export function npRequireObservabilityVoidResult(value: unknown, path: string): void {
  if (value !== undefined) {
    throw new NpObservabilityContractError("Invalid observability adapter result", [
      issue("invariant", path, "must resolve to void."),
    ]);
  }
}
