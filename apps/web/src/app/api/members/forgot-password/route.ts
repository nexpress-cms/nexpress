import {
  NpValidationError,
  enqueueJob,
  requestMemberPasswordReset,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor, nexpressConfig } from "@/lib/init-core";
import { resetTtlMs } from "@/lib/token-ttl";

function buildResetUrl(request: NextRequest, token: string): string {
  const base = process.env.SITE_URL ? new URL(process.env.SITE_URL) : new URL(request.url);
  const url = new URL("/members/reset-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const body = (await readJsonBody(request)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";
    if (!email.includes("@")) {
      throw new NpValidationError("Invalid input", [
        { field: "email", message: "Valid email required" },
      ]);
    }

    const result = await requestMemberPasswordReset(getDb(), email, resetTtlMs);
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
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
