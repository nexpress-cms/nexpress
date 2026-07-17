import {
  NpContentTransferContractError,
  npContentTransferContractLimits,
  npRequireContentTransferCollectionFilter,
  npRequireContentTransferDryRun,
  npRequireContentTransferEnvelope,
  type NpContentTransferEnvelope,
} from "@nexpress/core/content-transfer";
import { NpValidationError } from "@nexpress/core";
import { npApiErrorContractLimits } from "@nexpress/core/api-contract";
import type { NextRequest } from "next/server";

export interface NpContentTransferQuery {
  collections: string[] | null;
  dryRun: boolean;
}

function boundedText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let end = maximum;
  if (/^[\uDC00-\uDFFF]$/u.test(value[end] ?? "")) end -= 1;
  return `${value.slice(0, Math.max(0, end - 1))}…`;
}

export function npContentTransferValidationError(
  message: string,
  errors: Array<{ field: string; message: string }>,
): NpValidationError {
  const maximum = npApiErrorContractLimits.validationIssues;
  const entries =
    errors.length > 0
      ? errors
      : [{ field: "body", message: "Content transfer validation failed." }];
  const normalized = entries.slice(0, maximum).map((entry) => ({
    field: boundedText(entry.field, npApiErrorContractLimits.validationFieldLength),
    message: boundedText(entry.message, npApiErrorContractLimits.detailStringLength),
  }));
  if (entries.length > maximum) {
    normalized[maximum - 1] = {
      field: "body",
      message: `${(entries.length - maximum + 1).toString()} additional validation issue(s) were omitted.`,
    };
  }
  return new NpValidationError(
    boundedText(message, npApiErrorContractLimits.messageLength),
    normalized,
  );
}

export function npSummarizeContentTransferValues(values: readonly string[], maximum = 20): string {
  const visible = values.slice(0, maximum).join(", ");
  const remaining = values.length - Math.min(values.length, maximum);
  return remaining > 0 ? `${visible}, and ${remaining.toString()} more` : visible;
}

function toValidationError(error: NpContentTransferContractError): NpValidationError {
  return npContentTransferValidationError(
    "Invalid content transfer",
    error.issues.map((issue) => ({
      field: issue.path.replace(/^transfer\.?/u, "") || "body",
      message: issue.message,
    })),
  );
}

export function npRequireContentTransferRequestValue<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof NpContentTransferContractError) throw toValidationError(error);
    throw error;
  }
}

export function npReadContentTransferQuery(
  request: NextRequest,
  options: { allowDryRun: boolean },
): NpContentTransferQuery {
  const allowed = new Set(options.allowDryRun ? ["collections", "dryRun"] : ["collections"]);
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    if (!allowed.has(key)) {
      throw npContentTransferValidationError("Invalid content transfer query", [
        { field: key, message: `Unsupported query parameter "${key}"` },
      ]);
    }
    if (request.nextUrl.searchParams.getAll(key).length !== 1) {
      throw npContentTransferValidationError("Invalid content transfer query", [
        { field: key, message: "Query parameter must appear exactly once" },
      ]);
    }
  }

  return npRequireContentTransferRequestValue(() => ({
    collections: npRequireContentTransferCollectionFilter(
      request.nextUrl.searchParams.get("collections"),
    ),
    dryRun: options.allowDryRun
      ? npRequireContentTransferDryRun(request.nextUrl.searchParams.get("dryRun"))
      : false,
  }));
}

function bodyError(message: string): NpValidationError {
  return npContentTransferValidationError("Invalid content transfer", [{ field: "body", message }]);
}

export async function npReadContentTransferBody(
  request: NextRequest,
): Promise<NpContentTransferEnvelope> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw bodyError('Content-Type must be exactly "application/json"');
  }

  const contentLengthHeader = request.headers.get("content-length");
  let declaredLength: number | null = null;
  if (contentLengthHeader !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLengthHeader)) {
      throw bodyError("Content-Length must be a canonical non-negative integer");
    }
    declaredLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength > npContentTransferContractLimits.bodyBytes
    ) {
      throw bodyError(
        `Request body exceeds ${npContentTransferContractLimits.bodyBytes.toString()} bytes`,
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw bodyError("Request body must contain JSON");
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > npContentTransferContractLimits.bodyBytes) {
        await reader.cancel();
        throw bodyError(
          `Request body exceeds ${npContentTransferContractLimits.bodyBytes.toString()} bytes`,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof NpValidationError) throw error;
    throw bodyError("Request body could not be read");
  }
  if (declaredLength !== null && declaredLength !== received) {
    throw bodyError("Content-Length does not match the received request body");
  }
  if (received === 0) throw bodyError("Request body must contain JSON");

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw bodyError("Request body must be valid UTF-8 JSON");
  }
  return npRequireContentTransferRequestValue(() => npRequireContentTransferEnvelope(value));
}
