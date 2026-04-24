import { NxValidationError, consumePasswordResetToken } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

function validateBody(body: unknown): { token: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }

  const { token, password } = body as { token?: unknown; password?: unknown };

  if (typeof token !== "string" || token.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Reset token is required" },
    ]);
  }

  if (typeof password !== "string" || password.length < 8) {
    throw new NxValidationError("Invalid input", [
      { field: "password", message: "Password must be at least 8 characters" },
    ]);
  }

  return { token, password };
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const { token, password } = validateBody(await request.json());

    const result = await consumePasswordResetToken(getDb(), {
      token,
      newPassword: password,
    });

    return nxSuccessResponse({
      ok: true,
      email: result.email,
      purpose: result.purpose,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
