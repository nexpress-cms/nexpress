import type { BrowserContext } from "@playwright/test";

/**
 * Give a high-request E2E case its own proxy rate-limit identity.
 *
 * TEST-NET-3 is reserved for documentation and cannot identify a real client.
 * Callers own suffix allocation so retries and repeated runs can use a fresh
 * bucket without changing production limits or waiting for the fixed window.
 */
export async function isolateE2ERateLimitBucket(
  context: BrowserContext,
  suffix: number,
): Promise<void> {
  if (!Number.isInteger(suffix) || suffix < 1 || suffix > 254) {
    throw new Error(
      `E2E rate-limit bucket suffix must be an integer from 1 through 254: ${suffix}`,
    );
  }

  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${suffix}` });
}
