import {
  NxForbiddenError,
  NxValidationError,
  hasRole,
  nxSettings,
  DEFAULT_THEME,
} from "@nexpress/core";
import type { NxThemeTokens } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidTheme(value: unknown): value is NxThemeTokens {
  return isRecord(value) && isRecord(value.colors) && isRecord(value.typography) && isRecord(value.shape);
}

export async function GET(_request: NextRequest) {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(nxSettings)
      .where(eq(nxSettings.key, "theme"))
      .limit(1);

    return nxSuccessResponse(row?.value ?? DEFAULT_THEME);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings/theme", "update");
    }

    const theme = await request.json();

    if (!isValidTheme(theme)) {
      throw new NxValidationError("Invalid input", [
        { field: "theme", message: "Theme must have colors, typography, and shape objects" },
      ]);
    }

    const db = getDb();
    const now = new Date();

    await db
      .insert(nxSettings)
      .values({ key: "theme", value: theme, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: nxSettings.key,
        set: { value: theme, updatedAt: now, updatedBy: user.id },
      });

    const { revalidateTag } = await import("next/cache");
    revalidateTag("nx:theme");

    return nxSuccessResponse(theme);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
