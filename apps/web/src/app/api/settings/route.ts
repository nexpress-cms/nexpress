import {
  NxForbiddenError,
  NxValidationError,
  hasRole,
  nxSettings,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings", "read");
    }

    const db = getDb();
    const rows = await db.select().from(nxSettings);
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return nxSuccessResponse(settings);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings", "update");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";

    if (!key) {
      throw new NxValidationError("Invalid input", [
        { field: "key", message: "Setting key is required" },
      ]);
    }

    if (body.value === undefined) {
      throw new NxValidationError("Invalid input", [
        { field: "value", message: "Setting value is required" },
      ]);
    }

    const db = getDb();
    const now = new Date();

    const [result] = await db
      .insert(nxSettings)
      .values({ key, value: body.value, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: nxSettings.key,
        set: { value: body.value, updatedAt: now, updatedBy: user.id },
      })
      .returning();

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
