/**
 * Public error-code contract (#290).
 *
 * `NxError.code` is the machine-readable string the API surface
 * sends to clients (`response.error.code`). The moment a client
 * branches on `error.code === "VALIDATION_ERROR"` it becomes
 * part of the public contract — adding a typo'd code or
 * renaming an existing one breaks every integration.
 *
 * `NxErrorCode` is the union of every code the framework
 * currently emits. Adding a new code requires extending this
 * union deliberately — no more "casual" string adoption that
 * accumulates over a year of PRs.
 *
 * The `NxError` constructor still accepts plain `string` so
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
export type NxErrorCode =
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
 * (autocompletion narrows to `NxErrorCode`). External plugins
 * authoring their own codes keep working — they just won't get
 * the autocomplete win.
 */
export type NxErrorCodeInput = NxErrorCode | (string & Record<never, never>);

export class NxError extends Error {
  constructor(
    message: string,
    public readonly code: NxErrorCodeInput,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "NxError";
  }
}

export class NxForbiddenError extends NxError {
  constructor(collection: string, operation: string) {
    super(
      `Access denied: ${operation} on ${collection}`,
      "FORBIDDEN",
      403,
    );
    this.name = "NxForbiddenError";
  }
}

export class NxNotFoundError extends NxError {
  constructor(collection: string, id: string) {
    super(
      `Document not found: ${collection}/${id}`,
      "NOT_FOUND",
      404,
    );
    this.name = "NxNotFoundError";
  }
}

export class NxValidationError extends NxError {
  constructor(
    message: string,
    public readonly errors: Array<{ field: string; message: string }>,
  ) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "NxValidationError";
  }
}

export class NxAuthError extends NxError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "NxAuthError";
  }
}

export class NxConflictError extends NxError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "NxConflictError";
  }
}

/**
 * Per-actor rate limit / quota exceeded. Distinct from
 * `NxValidationError` because the request shape was valid — the
 * server is rejecting it on policy grounds. The 429 status lets
 * client UIs recognize the case and surface a "you've hit your
 * daily limit" message rather than a generic validation error.
 */
export class NxRateLimitError extends NxError {
  constructor(message: string) {
    super(message, "RATE_LIMITED", 429);
    this.name = "NxRateLimitError";
  }
}

/**
 * No site context resolved when one was required (#272). Thrown
 * by `requireSiteId()` on write paths. 500 because this is a
 * server-side wiring bug — the user request was well-formed,
 * but the framework couldn't tell which tenant to write to.
 * Promoted from a plain `Error` to a real `NxError` subclass so
 * the API layer surfaces it as a uniform error envelope and
 * clients can branch on the stable `SITE_CONTEXT_MISSING` code.
 */
export class NxSiteContextMissingError extends NxError {
  constructor(message: string) {
    super(message, "SITE_CONTEXT_MISSING", 500);
    this.name = "NxSiteContextMissingError";
  }
}
