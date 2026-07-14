import { InMemoryRateLimiter } from "./in-memory.js";
import {
  NpRateLimitContractError,
  npRequireRateLimitDecision,
  npRequireRateLimiterAdapter,
  npRequireRateLimitRequest,
} from "./contract.js";
import type { NpRateLimitDecision, NpRateLimiterAdapter, NpRateLimitRequest } from "./types.js";

/**
 * Phase 23.7 — singleton registration for the rate limiter, mirroring
 * the existing `setStorageAdapter` / `setJobQueue` pattern. Boot wires
 * the desired adapter once; the proxy reads it on every request via
 * `getRateLimiter()`.
 *
 * `getRateLimiter()` lazily installs the in-memory default the first
 * time it's called without an explicit setup. That keeps single-node
 * deployments zero-config — they get the same behavior they had
 * before the adapter contract existed without touching their boot
 * code.
 */

let rateLimiter: NpRateLimiterAdapter | null = null;

export function setRateLimiter(adapter: NpRateLimiterAdapter | null): void {
  rateLimiter = adapter === null ? null : npRequireRateLimiterAdapter(adapter);
}

export function getRateLimiter(): NpRateLimiterAdapter {
  if (!rateLimiter) {
    rateLimiter = new InMemoryRateLimiter();
  }
  return rateLimiter;
}

export function getOptionalRateLimiter(): NpRateLimiterAdapter | null {
  return rateLimiter;
}

/** Validate and dispatch one check through the selected adapter. */
export async function npCheckRateLimit(
  request: NpRateLimitRequest,
  adapter?: NpRateLimiterAdapter,
): Promise<NpRateLimitDecision> {
  const validatedRequest = npRequireRateLimitRequest(request);
  const validatedAdapter = npRequireRateLimiterAdapter(adapter ?? getRateLimiter());
  const result: unknown = await validatedAdapter.check(
    validatedRequest.key,
    validatedRequest.limit,
    validatedRequest.windowMs,
  );
  return npRequireRateLimitDecision(result, validatedRequest);
}

/**
 * Detach and close the registered adapter. The detach happens first
 * so a failed teardown cannot leave a half-closed client installed.
 */
export async function npShutdownRateLimiter(): Promise<void> {
  const current = rateLimiter;
  rateLimiter = null;
  if (!current?.shutdown) return;
  const result: unknown = await current.shutdown();
  if (result !== undefined) {
    throw new NpRateLimitContractError("Invalid rate-limit adapter result", [
      {
        code: "invariant",
        path: "rateLimit.adapter.shutdown.result",
        message: "must resolve to void.",
      },
    ]);
  }
}
