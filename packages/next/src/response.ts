import { NpError, NpValidationError, getLogger, reportError } from "@nexpress/core";
import {
  NpApiContractError,
  npApiErrorContractLimits,
  npCreateApiError,
  type NpApiError,
  type NpApiValidationIssue,
} from "@nexpress/core/api-contract";
import { NextResponse } from "next/server";

export type { NpApiError } from "@nexpress/core/api-contract";

export type NpErrorResponseInit = Omit<ResponseInit, "status">;

type OwnDataProperty = { found: true; value: unknown; enumerable: boolean } | { found: false };

function setDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function ownDataProperty(value: object, key: string): OwnDataProperty {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor
    ? {
        found: true,
        value: descriptor.value as unknown,
        enumerable: descriptor.enumerable ?? false,
      }
    : { found: false };
}

function plainDataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const property = ownDataProperty(value, key);
    if (!property.found || !property.enumerable) return null;
    setDataProperty(result, key, property.value);
  }
  return result;
}

function zodLikeIssues(error: Error): OwnDataProperty {
  return ownDataProperty(error, "issues");
}

function plainDataArray(value: unknown, maximum: number): unknown[] | null {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    return null;
  }
  const indexKeys = new Set(Array.from({ length: value.length }, (_, index) => index.toString()));
  if (
    Reflect.ownKeys(value).some(
      (key) => key !== "length" && !(typeof key === "string" && indexKeys.has(key)),
    )
  ) {
    return null;
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result.push(descriptor.value as unknown);
  }
  return result;
}

function validationField(issue: Record<string, unknown>): string {
  if (typeof issue.field === "string" && issue.field.trim()) return issue.field.trim();
  const path = plainDataArray(issue.path, 64);
  if (!path || path.length === 0) return "request";
  const segments = path.flatMap((segment) =>
    typeof segment === "string" || typeof segment === "number" ? [String(segment)] : [],
  );
  return segments.length > 0 ? segments.join(".") : "request";
}

function normalizeValidationIssues(value: unknown): NpApiValidationIssue[] {
  const entries = plainDataArray(value, npApiErrorContractLimits.validationIssues);
  if (!entries || entries.length === 0) {
    return [{ field: "request", message: "Invalid input" }];
  }

  const normalized: NpApiValidationIssue[] = [];
  for (const entry of entries) {
    const issue = plainDataRecord(entry);
    if (!issue) {
      normalized.push({ field: "request", message: "Invalid input" });
      continue;
    }
    normalized.push({
      field: validationField(issue),
      message:
        typeof issue.message === "string" && issue.message.trim()
          ? issue.message.trim()
          : "Invalid input",
    });
  }
  return normalized;
}

function jsonErrorResponse(body: NpApiError, init?: NpErrorResponseInit): NextResponse<NpApiError> {
  return NextResponse.json(body, { ...init, status: body.status });
}

function safeErrorProperty(error: Error, key: "name" | "message" | "stack"): string | undefined {
  try {
    const value = error[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function reportApiFailure(error: Error, contractError?: NpApiContractError): void {
  const name = safeErrorProperty(error, "name") ?? "Error";
  const message = safeErrorProperty(error, "message") ?? "Error details unavailable";
  const stack = safeErrorProperty(error, "stack");
  getLogger().error("Unhandled error in API route", {
    name,
    message,
    ...(stack !== undefined && { stack }),
    ...(contractError && { contractIssues: contractError.contractIssues }),
  });
  void reportError(error, {
    tags: { source: contractError ? "api.contract" : "api" },
  });
}

function opaqueErrorResponse(error: Error, init?: NpErrorResponseInit): NextResponse<NpApiError> {
  reportApiFailure(error);
  return jsonErrorResponse(
    npCreateApiError("INTERNAL_ERROR", "An unexpected error occurred", 500),
    init,
  );
}

export function npSuccessResponse<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function npErrorResponse(
  error: Error,
  init?: NpErrorResponseInit,
): NextResponse<NpApiError> {
  let candidate: NpApiError;
  try {
    if (error instanceof NpValidationError) {
      candidate = npCreateApiError(
        "VALIDATION_ERROR",
        error.message,
        error.statusCode,
        error.errors,
      );
    } else {
      const issues = zodLikeIssues(error);
      if (issues.found) {
        candidate = npCreateApiError(
          "VALIDATION_ERROR",
          "Invalid input",
          400,
          normalizeValidationIssues(issues.value),
        );
      } else if (error instanceof NpError) {
        candidate = npCreateApiError(error.code, error.message, error.statusCode, error.details);
      } else {
        return opaqueErrorResponse(error, init);
      }
    }
  } catch (contractError) {
    if (contractError instanceof NpApiContractError) {
      reportApiFailure(error, contractError);
      return jsonErrorResponse(
        npCreateApiError("INTERNAL_ERROR", "An unexpected error occurred", 500),
        init,
      );
    }
    return opaqueErrorResponse(error, init);
  }

  return jsonErrorResponse(candidate, init);
}
