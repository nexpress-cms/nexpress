import {
  npNormalizeCacheInvalidationRequest,
  npRequireCacheInvalidationAdapter,
  npRequireCacheInvalidationResult,
} from "./contract.js";
import {
  npRecordCacheInvalidationFailure,
  npRecordCacheInvalidationResult,
} from "./diagnostics.js";
import type {
  NpCacheInvalidationAdapter,
  NpCacheInvalidationRequest,
  NpCacheInvalidationResult,
  NpNormalizedCacheInvalidationRequest,
} from "./types.js";

let adapter: NpCacheInvalidationAdapter | null = null;

export function setCacheInvalidationAdapter(next: NpCacheInvalidationAdapter): void {
  adapter = npRequireCacheInvalidationAdapter(next);
}

export function getOptionalCacheInvalidationAdapter(): NpCacheInvalidationAdapter | null {
  return adapter;
}

export function resetCacheInvalidationAdapter(expected?: NpCacheInvalidationAdapter): void {
  if (expected === undefined || adapter === expected) adapter = null;
}

function unavailableResult(
  request: NpNormalizedCacheInvalidationRequest,
): NpCacheInvalidationResult {
  return {
    status: "unavailable",
    paths: { requested: request.paths.length, succeeded: 0, failed: request.paths.length },
    tags: { requested: request.tags.length, succeeded: 0, failed: request.tags.length },
    cdn: { status: "not-configured", adapterKind: null },
  };
}

function requireCoverage(
  request: NpNormalizedCacheInvalidationRequest,
  result: NpCacheInvalidationResult,
): void {
  if (
    result.paths.requested !== request.paths.length ||
    result.tags.requested !== request.tags.length
  ) {
    throw new Error("Cache adapter result does not cover every normalized path and tag target.");
  }
}

export async function npRunCacheInvalidation(
  candidate: NpCacheInvalidationAdapter,
  request: NpCacheInvalidationRequest,
): Promise<NpCacheInvalidationResult> {
  const normalized = npNormalizeCacheInvalidationRequest(request);
  const current = npRequireCacheInvalidationAdapter(candidate);
  let rawResult: unknown;
  try {
    rawResult = await current.invalidate(normalized);
  } catch (error) {
    npRecordCacheInvalidationFailure("dispatch", current.kind, normalized.source, error);
    const result = unavailableResult(normalized);
    npRecordCacheInvalidationResult(result);
    return result;
  }
  let result: NpCacheInvalidationResult;
  try {
    result = npRequireCacheInvalidationResult(rawResult);
    requireCoverage(normalized, result);
  } catch (error) {
    npRecordCacheInvalidationFailure("result-contract", current.kind, normalized.source, error);
    result = unavailableResult(normalized);
  }
  npRecordCacheInvalidationResult(result);
  return result;
}

export async function npInvalidateCache(
  request: NpCacheInvalidationRequest,
): Promise<NpCacheInvalidationResult> {
  const normalized = npNormalizeCacheInvalidationRequest(request);
  const current = adapter;
  if (!current) {
    const result = unavailableResult(normalized);
    npRecordCacheInvalidationFailure(
      "dispatch",
      "unconfigured",
      normalized.source,
      new Error("No cache invalidation adapter is configured."),
    );
    npRecordCacheInvalidationResult(result);
    return result;
  }
  return npRunCacheInvalidation(current, normalized);
}

export async function npShutdownCacheInvalidationAdapter(): Promise<void> {
  const current = adapter;
  adapter = null;
  if (!current?.shutdown) return;
  try {
    const result: unknown = await current.shutdown();
    if (result !== undefined) {
      throw new Error("Cache invalidation adapter shutdown() must resolve to void.");
    }
  } catch (error) {
    npRecordCacheInvalidationFailure("shutdown", current.kind, null, error);
    throw error;
  }
}
