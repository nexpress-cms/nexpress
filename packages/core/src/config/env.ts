/**
 * Env-var parsing helpers for operational defaults (#289).
 *
 * Operational thresholds — DB timeouts, worker heartbeat,
 * retention windows, OAuth state TTL, member quota windows —
 * had been baked into core code without env override. Each one
 * drives a real ops decision (compliance window, monitoring
 * sensitivity, slow-query protection) and operators must be
 * able to tune them without recompiling.
 *
 * The helper is shared so the parsing rules (rejection of zero,
 * negatives, malformed values; silent fallback) stay consistent
 * across every threshold. Production never refuses to boot
 * because a deployer typo'd a number — the safe-default win.
 */

/**
 * Parse `process.env[envVar]` as a positive integer. Falls back
 * silently when the variable is unset, empty, non-numeric,
 * zero, or negative.
 *
 * `parseInt` is intentionally used (not `Number`) so a value
 * like `"30s"` rounds to `30` rather than `NaN`. That matches
 * how the rest of NexPress reads numeric env (compare
 * `readNumber` in `packages/next/src/auth.ts`).
 */
export function readEnvPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
