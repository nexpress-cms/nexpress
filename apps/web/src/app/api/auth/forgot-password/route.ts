import { NxValidationError, enqueueJob, requestPasswordReset } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

// Browser typically completes password recovery within the hour.
const RESET_TTL_MS = 1000 * 60 * 60;

function validateBody(body: unknown): { email: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }

  const { email } = body as { email?: unknown };
  if (typeof email !== "string" || !email.includes("@")) {
    throw new NxValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }

  return { email };
}

function buildResetUrl(request: NextRequest, token: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  const url = new URL("/admin/set-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const { email } = validateBody(await request.json());

    const result = await requestPasswordReset(getDb(), email, RESET_TTL_MS);

    if (result.issued) {
      await enqueueJob("auth:sendPasswordReset", {
        email: email.trim().toLowerCase(),
        name: email.trim().toLowerCase(),
        token: result.issued.token,
        purpose: result.issued.purpose,
        resetUrl: buildResetUrl(request, result.issued.token),
      });
    }

    // Response is identical whether or not the email matched an account —
    // prevents enumeration of which emails are registered.
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
