import {
  NxValidationError,
  enqueueJob,
  requestMemberPasswordReset,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady, nexpressConfig } from "@/lib/init-core";

const RESET_TTL_MS = 1000 * 60 * 60; // 1h

function buildResetUrl(request: NextRequest, token: string): string {
  const base = process.env.SITE_URL ? new URL(process.env.SITE_URL) : new URL(request.url);
  const url = new URL("/members/reset-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const body = (await request.json()) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";
    if (!email.includes("@")) {
      throw new NxValidationError("Invalid input", [
        { field: "email", message: "Valid email required" },
      ]);
    }

    const result = await requestMemberPasswordReset(getDb(), email, RESET_TTL_MS);
    if (result.issued && result.email && result.displayName) {
      await enqueueJob("members:sendPasswordReset", {
        email: result.email,
        displayName: result.displayName,
        resetUrl: buildResetUrl(request, result.issued.token),
        siteName: nexpressConfig.site.name,
      });
    }
    // Constant response regardless of whether the email matched a
    // member — anti-enumeration.
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
