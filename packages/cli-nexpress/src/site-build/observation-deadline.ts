import { SiteBuildError } from "./artifact-io.js";

/** Trusted in-process cancellation; neither a JSON deadline nor execution authority. */
export interface NpSiteBuildObservationCancellationV1 {
  signal?: AbortSignal;
  /** Forward the observer context's monotonic budget, never a new per-route budget. */
  remainingMs?: () => number;
}

export function assertSiteBuildObservationActiveV1(
  context: NpSiteBuildObservationCancellationV1,
): void {
  if (context.signal?.aborted || (context.remainingMs && context.remainingMs() <= 0))
    throw new SiteBuildError("unavailable");
}

/**
 * Signals expiry without racing the owner promise. The caller MUST await the
 * observer and its cleanup before disposing. A callback which ignores the signal
 * cannot be forcibly stopped by JavaScript; only cooperative, owning observers
 * provide cancellation. Cleanup may finish after the execution budget expires.
 */
export function createSiteBuildObservationDeadlineV1(
  timeoutMs: number,
  parent?: AbortSignal,
): {
  signal: AbortSignal;
  remainingMs: () => number;
  assertActive: () => void;
  dispose: () => void;
} {
  // The complete observer uses the reviewed Core command budget (up to one
  // hour). Each native/browser job retains its own shorter fixed limit.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)
    throw new SiteBuildError("input");
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const remainingMs = () =>
    controller.signal.aborted ? 0 : Math.max(0, Math.ceil(deadline - performance.now()));
  return {
    signal: controller.signal,
    remainingMs,
    assertActive: () =>
      assertSiteBuildObservationActiveV1({ signal: controller.signal, remainingMs }),
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
