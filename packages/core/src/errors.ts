export class NxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
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
