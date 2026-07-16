import type { NpApiErrorDetailValue, NpErrorCodeInput } from "./api-contract/types.js";

export type { NpErrorCode, NpErrorCodeInput } from "./api-contract/types.js";

/**
 * Public error-code contract (#290).
 *
 * `NpError.code` is the machine-readable string the API surface
 * sends to clients (`response.error.code`). The moment a client
 * branches on `error.code === "VALIDATION_ERROR"` it becomes
 * part of the public contract — adding a typo'd code or
 * renaming an existing one breaks every integration.
 *
 * `NpErrorCode` and its fixed status map live in the client-safe
 * `api-contract` subpath. Adding a framework code requires extending
 * both deliberately — no more casual string/status drift.
 *
 * The `NpError` constructor still accepts extension strings so plugins can
 * own documented codes. `npErrorResponse()` validates their uppercase grammar,
 * status, message, and details before anything reaches a client.
 *
 * See `docs/api-error-codes.md` for stability and authoring rules.
 */
export class NpError extends Error {
  constructor(
    message: string,
    public readonly code: NpErrorCodeInput,
    public readonly statusCode: number = 500,
    public readonly details?: NpApiErrorDetailValue,
  ) {
    super(message);
    this.name = "NpError";
  }
}

export class NpForbiddenError extends NpError {
  constructor(collection: string, operation: string) {
    super(`Access denied: ${operation} on ${collection}`, "FORBIDDEN", 403);
    this.name = "NpForbiddenError";
  }
}

export class NpNotFoundError extends NpError {
  constructor(collection: string, id: string) {
    super(`Document not found: ${collection}/${id}`, "NOT_FOUND", 404);
    this.name = "NpNotFoundError";
  }
}

export class NpValidationError extends NpError {
  constructor(
    message: string,
    public readonly errors: Array<{ field: string; message: string }>,
  ) {
    super(message, "VALIDATION_ERROR", 400, errors);
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
  constructor(message: string, details?: NpApiErrorDetailValue) {
    super(message, "CONFLICT", 409, details);
    this.name = "NpConflictError";
  }
}

export class NpMethodNotAllowedError extends NpError {
  constructor(message: string = "Method not allowed") {
    super(message, "METHOD_NOT_ALLOWED", 405);
    this.name = "NpMethodNotAllowedError";
  }
}

export class NpServiceUnavailableError extends NpError {
  constructor(message: string = "Service unavailable") {
    super(message, "SERVICE_UNAVAILABLE", 503);
    this.name = "NpServiceUnavailableError";
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
