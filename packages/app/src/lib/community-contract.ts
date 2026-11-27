import { NpValidationError } from "@nexpress/core";
import {
  NpCommunityContractError,
  npRequireCommunityId,
  npRequireCommunityPagination,
  npRequireCommunityWindow,
} from "@nexpress/core/community-contract";

export function npReadReportIdFilter(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  if (values.length !== 1) {
    throw new NpValidationError("Invalid input", [
      { field: "reportId", message: "Specify one report id" },
    ]);
  }
  return npRequireCommunityRequest((value) => npRequireCommunityId(value, "reportId"), values[0]);
}

export function npRequireCommunityRequest<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      throw new NpValidationError(
        "Invalid input",
        error.contractIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
    throw error;
  }
}

function queryInteger(value: string | null, field: string): number | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new NpValidationError("Invalid input", [
      { field, message: "Must be a canonical non-negative integer" },
    ]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new NpValidationError("Invalid input", [
      { field, message: "Exceeds safe integer range" },
    ]);
  }
  return parsed;
}

export function npReadCommunityWindow(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  return npRequireCommunityRequest(npRequireCommunityWindow, {
    ...(searchParams.has("limit")
      ? { limit: queryInteger(searchParams.get("limit"), "limit") }
      : {}),
    ...(searchParams.has("offset")
      ? { offset: queryInteger(searchParams.get("offset"), "offset") }
      : {}),
  });
}

export function npReadCommunityPage(searchParams: URLSearchParams): {
  limit: number;
  page: number;
  offset: number;
} {
  return npRequireCommunityRequest(npRequireCommunityPagination, {
    ...(searchParams.has("limit")
      ? { limit: queryInteger(searchParams.get("limit"), "limit") }
      : {}),
    ...(searchParams.has("page") ? { page: queryInteger(searchParams.get("page"), "page") } : {}),
  });
}
