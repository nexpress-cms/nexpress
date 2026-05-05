import { NpError, NpValidationError, getLogger, reportError } from "@nexpress/core";
import { NextResponse } from "next/server";

export interface NpApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  status: number;
}

interface ZodLikeError extends Error {
  issues: unknown;
}

function isZodLikeError(error: Error): error is ZodLikeError {
  return "issues" in error;
}

export function npSuccessResponse<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function npErrorResponse(error: Error): NextResponse<NpApiError> {
  if (isZodLikeError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: error.issues,
        },
        status: 400,
      },
      { status: 400 },
    );
  }

  if (error instanceof NpError) {
    const details = error instanceof NpValidationError ? error.errors : undefined;

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(details !== undefined && { details }),
        },
        status: error.statusCode,
      },
      { status: error.statusCode },
    );
  }

  // Unexpected errors are opaque to the client (no stack leak), but they
  // should still surface in logs and to the configured error reporter so
  // an operator can debug the cause.
  getLogger().error("Unhandled error in API route", {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
  // Fire-and-forget: reportError swallows reporter failures, and we
  // don't want to block the response on a Sentry/Datadog round-trip.
  void reportError(error, { tags: { source: "api" } });

  return NextResponse.json(
    {
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      status: 500,
    },
    { status: 500 },
  );
}
