/**
 * Public error-code contract (#290).
 *
 * `NpError.code` is the machine-readable string the API surface
 * sends to clients (`response.error.code`). The moment a client
 * branches on `error.code === "VALIDATION_ERROR"` it becomes
 * part of the public contract — adding a typo'd code or
 * renaming an existing one breaks every integration.
 *
 * `NpErrorCode` is the union of every code the framework
 * currently emits. Adding a new code requires extending this
 * union deliberately — no more "casual" string adoption that
 * accumulates over a year of PRs.
 *
 * The `NpError` constructor still accepts plain `string` so
 * out-of-tree plugins that throw their own codes keep working;
 * internal code paths use the union to get IntelliSense and
 * catch typos at compile time. The `(string & {})` trick on
 * the public type keeps editor completion narrow without
 * locking the runtime contract.
 *
 * **Stability**: codes follow semver. Renames or removals are
 * major-bump only. New codes may land in minor versions. See
 * `docs/api-error-codes.md` for the catalogue an operator /
 * client team should rely on.
 */
export type NpErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "TOO_MANY_REQUESTS"
  | "INVALID_URL"
  | "EMAIL_ADAPTER_MISSING_DEPENDENCY"
  | "EMAIL_DELIVERY_FAILED"
  | "SITE_CONTEXT_MISSING"
  | "INTERNAL_ERROR";

/**
 * The constructor signature accepts the union *or* an arbitrary
 * string. Inside the codebase, passing a literal that isn't in
 * the union triggers a TypeScript error in strict editors
 * (autocompletion narrows to `NpErrorCode`). External plugins
 * authoring their own codes keep working — they just won't get
 * the autocomplete win.
 */
export type NpErrorCodeInput = NpErrorCode | (string & Record<never, never>);

export class NpError extends Error {
  constructor(
    message: string,
    public readonly code: NpErrorCodeInput,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "NpError";
  }
}

export class NpForbiddenError extends NpError {
  constructor(collection: string, operation: string) {
    super(
      `Access denied: ${operation} on ${collection}`,
      "FORBIDDEN",
      403,
    );
    this.name = "NpForbiddenError";
  }
}

export class NpNotFoundError extends NpError {
  constructor(collection: string, id: string) {
    super(
      `Document not found: ${collection}/${id}`,
      "NOT_FOUND",
      404,
    );
    this.name = "NpNotFoundError";
  }
}

export class NpValidationError extends NpError {
  constructor(
    message: string,
    public readonly errors: Array<{ field: string; message: string }>,
  ) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "NpValidationError";
  }
}

export class NpAuthError extends NpError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "NpAuthError";
  }
}

export class NpConflictError extends NpError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "NpConflictError";
  }
}

/**
 * Per-actor rate limit / quota exceeded. Distinct from
 * `NpValidationError` because the request shape was valid — the
 * server is rejecting it on policy grounds. The 429 status lets
 * client UIs recognize the case and surface a "you've hit your
 * daily limit" message rather than a generic validation error.
 */
export class NpRateLimitError extends NpError {
  constructor(message: string) {
    super(message, "RATE_LIMITED", 429);
    this.name = "NpRateLimitError";
  }
}

/**
 * No site context resolved when one was required (#272). Thrown
 * by `requireSiteId()` on write paths. 500 because this is a
 * server-side wiring bug — the user request was well-formed,
 * but the framework couldn't tell which tenant to write to.
 * Promoted from a plain `Error` to a real `NpError` subclass so
 * the API layer surfaces it as a uniform error envelope and
 * clients can branch on the stable `SITE_CONTEXT_MISSING` code.
 */
export class NpSiteContextMissingError extends NpError {
  constructor(message: string) {
    super(message, "SITE_CONTEXT_MISSING", 500);
    this.name = "NpSiteContextMissingError";
  }
}
