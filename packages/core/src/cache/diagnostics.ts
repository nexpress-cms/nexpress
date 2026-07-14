import { npCacheContractLimits } from "./contract.js";
import type {
  NpCacheInvalidationDiagnostics,
  NpCacheInvalidationFailure,
  NpCacheInvalidationFailureOperation,
  NpCacheInvalidationResult,
  NpCacheInvalidationSource,
} from "./types.js";

let attempts = 0;
let applied = 0;
let partial = 0;
let unavailable = 0;
let dispatchFailures = 0;
let resultContractFailures = 0;
let shutdownFailures = 0;
let lastFailure: NpCacheInvalidationFailure | null = null;

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function failureMessage(error: unknown): string {
  try {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      npCacheContractLimits.failureMessageLength,
    );
  } catch {
    return "Cache invalidation failed with an unprintable value.";
  }
}

export function npRecordCacheInvalidationResult(result: NpCacheInvalidationResult): void {
  attempts = increment(attempts);
  if (result.status === "applied") applied = increment(applied);
  else if (result.status === "partial") partial = increment(partial);
  else unavailable = increment(unavailable);
}

export function npRecordCacheInvalidationFailure(
  operation: NpCacheInvalidationFailureOperation,
  adapterKind: string,
  source: NpCacheInvalidationSource | null,
  error: unknown,
): void {
  if (operation === "dispatch") dispatchFailures = increment(dispatchFailures);
  else if (operation === "result-contract") {
    resultContractFailures = increment(resultContractFailures);
  } else {
    shutdownFailures = increment(shutdownFailures);
  }
  lastFailure = {
    operation,
    adapterKind,
    source,
    message: failureMessage(error),
    occurredAt: new Date().toISOString(),
  };
}

export function getCacheInvalidationDiagnostics(): NpCacheInvalidationDiagnostics {
  return {
    attempts,
    applied,
    partial,
    unavailable,
    dispatchFailures,
    resultContractFailures,
    shutdownFailures,
    lastFailure,
  };
}

export function resetCacheInvalidationDiagnostics(): void {
  attempts = 0;
  applied = 0;
  partial = 0;
  unavailable = 0;
  dispatchFailures = 0;
  resultContractFailures = 0;
  shutdownFailures = 0;
  lastFailure = null;
}
