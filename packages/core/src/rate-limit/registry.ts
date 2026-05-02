import { InMemoryRateLimiter } from "./in-memory.js";
import type { NxRateLimiterAdapter } from "./types.js";

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

let rateLimiter: NxRateLimiterAdapter | null = null;

export function setRateLimiter(adapter: NxRateLimiterAdapter | null): void {
  rateLimiter = adapter;
}

export function getRateLimiter(): NxRateLimiterAdapter {
  if (!rateLimiter) {
    rateLimiter = new InMemoryRateLimiter();
  }
  return rateLimiter;
}

export function getOptionalRateLimiter(): NxRateLimiterAdapter | null {
  return rateLimiter;
}
