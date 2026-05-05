import {
  NpForbiddenError,
  NpValidationError,
  can,
  npSettings,
  DEFAULT_THEME,
} from "@nexpress/core";
import type { NpThemeTokens } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/bootstrap";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidTheme(value: unknown): value is NpThemeTokens {
  return (
    isRecord(value) && isRecord(value.colors) && isRecord(value.typography) && isRecord(value.shape)
  );
}

export async function GET(_request: NextRequest) {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(npSettings)
      .where(eq(npSettings.key, "theme"))
      .limit(1);
    return npSuccessResponse(row?.value ?? DEFAULT_THEME);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!can(user, "admin.manage")) throw new NpForbiddenError("settings/theme", "update");

    const theme = await request.json();
    if (!isValidTheme(theme)) {
      throw new NpValidationError("Invalid input", [
        { field: "theme", message: "Theme must have colors, typography, and shape objects" },
      ]);
    }

    const db = getDb();
    const now = new Date();
    await db
      .insert(npSettings)
      .values({ key: "theme", value: theme, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: npSettings.key,
        set: { value: theme, updatedAt: now, updatedBy: user.id },
      });

    const { revalidatePath } = await import("next/cache");
    revalidatePath("/", "layout");

    return npSuccessResponse(theme);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };
