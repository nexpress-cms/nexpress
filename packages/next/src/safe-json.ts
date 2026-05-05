import { NpValidationError } from "@nexpress/core";
import type { NextRequest } from "next/server";

/**
 * Parse `request.json()` and convert any parse failure into an
 * `NpValidationError` (which the response mapper turns into a 400 with
 * a friendly `{ error: { code: "VALIDATION_ERROR", … } }`).
 *
 * Routes used to call `await request.json()` directly inside the
 * outer `try` and rely on `npErrorResponse(error)` for the catch.
 * That worked for `NpError` subclasses and zod issues, but plain
 * `SyntaxError` from a malformed body fell through to
 * `INTERNAL_ERROR` 500 — confusing for clients (their input mistake
 * looks like our server failure) and noisy for observability (every
 * malformed body triggered an unhandled-error report).
 */
export async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }
}
