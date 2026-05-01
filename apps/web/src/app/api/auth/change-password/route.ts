import {
  hashPassword,
  invalidateAllSessions,
  NxAuthError,
  NxValidationError,
  verifyPassword,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { clearAuthCookies, requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

interface PasswordRow extends Record<string, unknown> {
  password: string;
}

function validateChangePasswordBody(
  body: unknown,
): { currentPassword: string; newPassword: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }

  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "currentPassword", message: "Current password is required" },
    ]);
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new NxValidationError("Invalid input", [
      { field: "newPassword", message: "New password must be at least 8 characters" },
    ]);
  }

  return { currentPassword, newPassword };
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);


    const { currentPassword, newPassword } = validateChangePasswordBody(await readJsonBody(request));
    const db = getDb();
    const result = await db.$client.query<PasswordRow>(
      "select password from nx_users where id = $1 limit 1",
      [user.id],
    );
    const storedUser = result.rows[0];

    if (!storedUser) {
      throw new NxAuthError();
    }

    const validPassword = await verifyPassword(storedUser.password, currentPassword);

    if (!validPassword) {
      throw new NxAuthError("Current password is incorrect");
    }

    await db.$client.query(
      "update nx_users set password = $1, updated_at = $2 where id = $3",
      [await hashPassword(newPassword), new Date(), user.id],
    );

    await invalidateAllSessions(user.id, db);

    const response = nxSuccessResponse({ success: true });
    clearAuthCookies(response);

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
