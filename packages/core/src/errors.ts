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
