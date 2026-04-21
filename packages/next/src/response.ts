import { NxError } from "@nexpress/core";
import { NextResponse } from "next/server";

export interface NxApiError {
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

export function nxSuccessResponse<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function nxErrorResponse(error: Error): NextResponse<NxApiError> {
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

  if (error instanceof NxError) {
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message },
        status: error.statusCode,
      },
      { status: error.statusCode },
    );
  }

  return NextResponse.json(
    {
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      status: 500,
    },
    { status: 500 },
  );
}
