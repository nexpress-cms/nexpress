import {
  npErrorCodes,
  npErrorStatusByCode,
  type NpApiContractIssue,
  type NpApiError,
  type NpApiErrorDetailValue,
  type NpApiValidationIssue,
  type NpErrorCode,
  type NpErrorCodeInput,
} from "./types.js";

export const npApiErrorContractLimits = {
  codeLength: 64,
  messageLength: 2_000,
  validationIssues: 100,
  validationFieldLength: 256,
  detailDepth: 8,
  detailNodes: 1_000,
  detailArrayItems: 200,
  detailObjectKeys: 200,
  detailKeyLength: 128,
  detailStringLength: 8_000,
} as const;

export const npApiErrorCodePattern = "^[A-Z][A-Z0-9_]{0,63}$";

const CODE_PATTERN = new RegExp(npApiErrorCodePattern, "u");
const KNOWN_CODES = new Set<string>(npErrorCodes);
const INVALID = Symbol("invalid-api-error-value");

interface DetailState {
  nodes: number;
}

export class NpApiContractError extends Error {
  readonly contractIssues: NpApiContractIssue[];

  constructor(message: string, issues: NpApiContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpApiContractError";
    this.contractIssues = issues;
  }
}

function issue(
  issues: NpApiContractIssue[],
  code: NpApiContractIssue["code"],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function setDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function plainDataRecord(
  value: unknown,
  path: string,
  allowed: readonly string[] | null,
  issues: NpApiContractIssue[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issue(issues, "shape", path, "must be a plain object");
    return null;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    issue(issues, "shape", path, "must be a plain object");
    return null;
  }

  const allowedKeys = allowed ? new Set(allowed) : null;
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      issue(issues, "shape", path, "must not contain symbol properties");
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      issue(issues, "shape", `${path}.${key}`, "must be an enumerable plain data property");
      continue;
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      issue(issues, "unknown-field", `${path}.${key}`, "is not part of the API error contract");
      continue;
    }
    setDataProperty(record, key, descriptor.value as unknown);
  }
  return record;
}

function plainDataArray(
  value: unknown,
  path: string,
  maximum: number,
  issues: NpApiContractIssue[],
): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    issue(issues, "shape", path, "must be a plain array");
    return null;
  }
  if (value.length > maximum) {
    issue(issues, "limit", path, `may contain at most ${maximum.toString()} entries`);
    return null;
  }

  const indexKeys = new Set(Array.from({ length: value.length }, (_, index) => index.toString()));
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" || (typeof key === "string" && indexKeys.has(key))) continue;
    issue(issues, "shape", path, "must not contain non-index array properties");
  }

  const entries: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index.toString()}]`;
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      issue(issues, "shape", entryPath, "must be an enumerable plain data element");
      continue;
    }
    entries.push(descriptor.value as unknown);
  }
  return entries;
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !hasUnsafeText(value)
  );
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function parseDetail(
  value: unknown,
  path: string,
  depth: number,
  state: DetailState,
  issues: NpApiContractIssue[],
): NpApiErrorDetailValue | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > npApiErrorContractLimits.detailNodes) {
    issue(issues, "limit", path, "exceeds the API error detail node limit");
    return INVALID;
  }
  if (depth > npApiErrorContractLimits.detailDepth) {
    issue(issues, "limit", path, "exceeds the API error detail depth limit");
    return INVALID;
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "unsafe-value", path, "must be a finite JSON number");
      return INVALID;
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > npApiErrorContractLimits.detailStringLength || hasUnsafeText(value)) {
      issue(issues, "unsafe-value", path, "must be bounded safe text");
      return INVALID;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const entries = plainDataArray(value, path, npApiErrorContractLimits.detailArrayItems, issues);
    if (!entries) return INVALID;
    const parsed: NpApiErrorDetailValue[] = [];
    for (const [index, entry] of entries.entries()) {
      const item = parseDetail(entry, `${path}[${index.toString()}]`, depth + 1, state, issues);
      if (item !== INVALID) parsed.push(item);
    }
    return parsed;
  }

  const record = plainDataRecord(value, path, null, issues);
  if (!record) return INVALID;
  const keys = Object.keys(record);
  if (keys.length > npApiErrorContractLimits.detailObjectKeys) {
    issue(issues, "limit", path, "contains too many detail fields");
    return INVALID;
  }
  const parsed: { [key: string]: NpApiErrorDetailValue } = {};
  for (const key of keys) {
    if (
      key.length === 0 ||
      key.length > npApiErrorContractLimits.detailKeyLength ||
      hasUnsafeText(key)
    ) {
      issue(issues, "unsafe-value", `${path}.${key}`, "uses an invalid detail key");
      continue;
    }
    const item = parseDetail(record[key], `${path}.${key}`, depth + 1, state, issues);
    if (item !== INVALID) setDataProperty(parsed, key, item);
  }
  return parsed;
}

function parseValidationDetails(
  value: unknown,
  issues: NpApiContractIssue[],
): NpApiValidationIssue[] | typeof INVALID {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "shape", "apiError.error.details", "must be a non-empty validation issue array");
    return INVALID;
  }
  const entries = plainDataArray(
    value,
    "apiError.error.details",
    npApiErrorContractLimits.validationIssues,
    issues,
  );
  if (!entries) return INVALID;

  const parsed: NpApiValidationIssue[] = [];
  for (const [index, entry] of entries.entries()) {
    const path = `apiError.error.details[${index.toString()}]`;
    const record = plainDataRecord(entry, path, ["field", "message"], issues);
    if (!record) continue;
    if (!safeText(record.field, npApiErrorContractLimits.validationFieldLength)) {
      issue(issues, "unsafe-value", `${path}.field`, "must be bounded, trimmed safe text");
    }
    if (!safeText(record.message, npApiErrorContractLimits.messageLength)) {
      issue(issues, "unsafe-value", `${path}.message`, "must be bounded, trimmed safe text");
    }
    if (
      safeText(record.field, npApiErrorContractLimits.validationFieldLength) &&
      safeText(record.message, npApiErrorContractLimits.messageLength)
    ) {
      parsed.push({ field: record.field, message: record.message });
    }
  }
  return parsed;
}

function parseApiErrorUnsafe(value: unknown): {
  issues: NpApiContractIssue[];
  value?: NpApiError;
} {
  const issues: NpApiContractIssue[] = [];
  const root = plainDataRecord(value, "apiError", ["error", "status"], issues);
  if (!root) return { issues };
  const error = plainDataRecord(
    root.error,
    "apiError.error",
    ["code", "message", "details"],
    issues,
  );
  if (!error) return { issues };

  const code = error.code;
  const status = root.status;
  if (
    typeof code !== "string" ||
    code.length > npApiErrorContractLimits.codeLength ||
    !CODE_PATTERN.test(code)
  ) {
    issue(
      issues,
      "invalid-code",
      "apiError.error.code",
      "must be a canonical uppercase error code",
    );
  }
  if (!safeText(error.message, npApiErrorContractLimits.messageLength)) {
    issue(issues, "unsafe-value", "apiError.error.message", "must be bounded, trimmed safe text");
  }
  if (!Number.isInteger(status) || typeof status !== "number" || status < 400 || status > 599) {
    issue(issues, "invalid-status", "apiError.status", "must be an integer HTTP error status");
  }

  if (typeof code === "string" && KNOWN_CODES.has(code) && typeof status === "number") {
    const expected = npErrorStatusByCode[code as NpErrorCode];
    if (status !== expected) {
      issue(
        issues,
        "status-mismatch",
        "apiError.status",
        `${code} must use HTTP ${expected.toString()}`,
      );
    }
  }

  let details: NpApiErrorDetailValue | typeof INVALID | undefined;
  if (code === "VALIDATION_ERROR") {
    details = parseValidationDetails(error.details, issues);
  } else if (Object.hasOwn(error, "details")) {
    details = parseDetail(error.details, "apiError.error.details", 0, { nodes: 0 }, issues);
  }

  if (
    issues.length > 0 ||
    typeof code !== "string" ||
    typeof error.message !== "string" ||
    typeof status !== "number" ||
    details === INVALID
  ) {
    return { issues };
  }

  return {
    issues,
    value: {
      error: {
        code,
        message: error.message,
        ...(details !== undefined && { details }),
      },
      status,
    },
  };
}

function parseApiError(value: unknown): {
  issues: NpApiContractIssue[];
  value?: NpApiError;
} {
  try {
    return parseApiErrorUnsafe(value);
  } catch {
    return {
      issues: [
        {
          code: "unsafe-value",
          path: "apiError",
          message: "could not be inspected safely",
        },
      ],
    };
  }
}

export function npAnalyzeApiError(value: unknown): NpApiContractIssue[] {
  return parseApiError(value).issues;
}

export function npIsApiError(value: unknown): value is NpApiError {
  return parseApiError(value).issues.length === 0;
}

export function npRequireApiError(value: unknown): NpApiError {
  const parsed = parseApiError(value);
  if (!parsed.value) {
    throw new NpApiContractError("Invalid API error response", parsed.issues);
  }
  return parsed.value;
}

export function npCreateApiError(
  code: NpErrorCodeInput,
  message: string,
  status: number,
  details?: NpApiErrorDetailValue,
): NpApiError {
  return npRequireApiError({
    error: { code, message, ...(details !== undefined && { details }) },
    status,
  });
}
