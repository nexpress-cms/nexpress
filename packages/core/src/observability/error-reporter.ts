/**
 * Pluggable error reporter. The default is a no-op so users who don't
 * need third-party tracking pay nothing; production deployments can
 * install a Sentry / Bugsnag / Honeybadger / Rollbar adapter via
 * `setErrorReporter()`.
 *
 * The framework reports errors at three boundaries:
 *  1. Unhandled exceptions in API route handlers (via `nxErrorResponse`).
 *  2. Plugin hook handlers that throw (via the plugin host).
 *  3. pg-boss job handlers that throw (registered by the worker process).
 *
 * Reporters MUST NOT throw — exceptions inside `captureException` are
 * caught and logged, never propagated.
 */
export interface NxErrorReportContext {
  /**
   * Free-form tags used by error trackers for filtering and grouping.
   * E.g. `{ source: "api", route: "/api/collections/posts" }`.
   */
  tags?: Record<string, string>;
  /** Optional user identity, populated when the error happened in a
   *  request context. */
  user?: { id?: string; email?: string; role?: string };
  /** Arbitrary extra context — request body shape, plugin id, job name. */
  extra?: Record<string, unknown>;
}

export interface NxErrorReporter {
  captureException(error: Error, context?: NxErrorReportContext): void | Promise<void>;
}

/** Default — does nothing. Replaceable via `setErrorReporter`. */
export const noopErrorReporter: NxErrorReporter = {
  captureException: () => {
    /* no-op */
  },
};

let currentReporter: NxErrorReporter = noopErrorReporter;

/** Replace the global error reporter. Call once at app boot. */
export function setErrorReporter(reporter: NxErrorReporter): void {
  currentReporter = reporter;
}

/** Returns the currently-installed reporter. Defaults to no-op. */
export function getErrorReporter(): NxErrorReporter {
  return currentReporter;
}

/**
 * Safe wrapper that swallows reporter exceptions so error reporting can
 * never itself crash the host. Logs the underlying capture failure via
 * `console.error` — using `getLogger()` here would risk a loop if the
 * logger is also broken.
 */
export async function reportError(error: Error, context?: NxErrorReportContext): Promise<void> {
  try {
    await currentReporter.captureException(error, context);
  } catch (reporterError) {
    // Last-resort: bypass the logger to avoid a circular failure path.
     
    console.error("[nexpress] error reporter itself threw:", reporterError);
  }
}

/** Reset to the default no-op reporter. Tests use this to undo `setErrorReporter`. */
export function resetErrorReporter(): void {
  currentReporter = noopErrorReporter;
}
