import { NpValidationError, consumePasswordResetToken } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

function validateBody(body: unknown): { token: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }

  const { token, password } = body as { token?: unknown; password?: unknown };

  if (typeof token !== "string" || token.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset token is required" },
    ]);
  }

  if (typeof password !== "string" || password.length < 8) {
    throw new NpValidationError("Invalid input", [
      { field: "password", message: "Password must be at least 8 characters" },
    ]);
  }

  return { token, password };
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const { token, password } = validateBody(await readJsonBody(request));

    const result = await consumePasswordResetToken(getDb(), {
      token,
      newPassword: password,
    });

    return npSuccessResponse({
      ok: true,
      email: result.email,
      purpose: result.purpose,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
