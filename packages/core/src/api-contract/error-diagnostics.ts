import { npIsApiError } from "./contract.js";

/** Optional transport metadata; the exact API error body remains unchanged. */
export const npApiErrorDiagnosticsHeader = "x-np-error-diagnostics";

export interface NpApiErrorDiagnosticsV1 {
  version: 1;
  status: number;
  code: string;
  supportReference: string;
  recovery: "retry-read" | "reauthenticate" | "reconcile" | "check-outcome" | "none";
}

const FIELDS = ["version", "status", "code", "supportReference", "recovery"] as const;
const SUPPORT_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRecovery(value: unknown, status: number): value is NpApiErrorDiagnosticsV1["recovery"] {
  switch (value) {
    case "retry-read":
      return status === 429 || status === 502 || status === 503 || status === 504;
    case "reauthenticate":
      return status === 401 || status === 403;
    case "reconcile":
      return status === 409;
    case "check-outcome":
      return status >= 500;
    case "none":
      return true;
    default:
      return false;
  }
}

/**
 * Accept only metadata bound to the already validated error response. Recovery is
 * a server declaration, never permission to replay a mutation automatically.
 * Missing or malformed metadata stays unavailable; it is not inferred from status.
 */
export function npParseApiErrorDiagnosticsV1(
  value: string | null,
  expected: { status: number; code: string },
): NpApiErrorDiagnosticsV1 | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== FIELDS.length ||
    !FIELDS.every((field) => Object.hasOwn(record, field)) ||
    record.version !== 1 ||
    typeof record.status !== "number" ||
    typeof record.code !== "string" ||
    record.status !== expected.status ||
    record.code !== expected.code ||
    !npIsApiError({
      status: record.status,
      error: {
        code: record.code,
        message: "Request failed",
        ...(record.code === "VALIDATION_ERROR"
          ? { details: [{ field: "request", message: "Invalid input" }] }
          : {}),
      },
    }) ||
    typeof record.supportReference !== "string" ||
    !SUPPORT_REFERENCE.test(record.supportReference) ||
    !isRecovery(record.recovery, record.status)
  ) {
    return null;
  }
  return {
    version: 1,
    status: record.status,
    code: record.code,
    supportReference: record.supportReference,
    recovery: record.recovery,
  };
}
