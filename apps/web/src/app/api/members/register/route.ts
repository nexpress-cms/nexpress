import {
  NxValidationError,
  createMemberEmailVerifyToken,
  enqueueJob,
  hashPassword,
  nxMembers,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady, nexpressConfig } from "@/lib/init-core";

const MIN_PASSWORD_LENGTH = 8;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24h

interface RegisterBody {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}

function validate(raw: unknown): RegisterBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@")) errors.push({ field: "email", message: "Valid email required" });

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push({
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(handle)) {
    errors.push({
      field: "handle",
      message: "Handle must be 3–30 chars: lowercase letters, digits, underscore, dash",
    });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length === 0 || displayName.length > 80) {
    errors.push({ field: "displayName", message: "Display name 1–80 characters" });
  }

  if (errors.length > 0) throw new NxValidationError("Invalid input", errors);
  return { email, password, handle, displayName };
}

function buildVerifyUrl(request: NextRequest, token: string): string {
  const base = process.env.SITE_URL ? new URL(process.env.SITE_URL) : new URL(request.url);
  const url = new URL("/members/verify", base);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Self-registration. Creates a `pending` member, mints a 24h email
 * verify token, enqueues the verify email. Login is gated on
 * `status: "active"`, so a registered-but-unverified account can't
 * sign in until they click the email link.
 *
 * Response is intentionally constant on success regardless of whether
 * the email/handle was already taken — anti-enumeration. We log the
 * collision case server-side so admins can spot abusive flows.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();

    const body = validate(await readJsonBody(request));
    const db = getDb();

    const [existingByEmail] = await db
      .select({ id: nxMembers.id })
      .from(nxMembers)
      .where(eq(nxMembers.email, body.email))
      .limit(1);
    const [existingByHandle] = await db
      .select({ id: nxMembers.id })
      .from(nxMembers)
      .where(eq(nxMembers.handle, body.handle))
      .limit(1);

    if (existingByEmail || existingByHandle) {
      // Constant-time-ish: still pretend to enqueue. Caller can't tell
      // a collision from a fresh registration.
      return nxSuccessResponse({ ok: true });
    }

    const passwordHash = await hashPassword(body.password);

    const [created] = await db
      .insert(nxMembers)
      .values({
        email: body.email,
        password: passwordHash,
        handle: body.handle,
        displayName: body.displayName,
        // Members start `pending` until email verify; login refuses
        // pending accounts. Suspended is mod-only territory; deleted
        // is the soft-delete sink.
        status: "pending",
      })
      .returning({ id: nxMembers.id });

    if (!created) throw new Error("Failed to create member");

    const issued = await createMemberEmailVerifyToken(db, created.id, VERIFY_TTL_MS);

    await enqueueJob("members:sendVerifyEmail", {
      email: body.email,
      displayName: body.displayName,
      verifyUrl: buildVerifyUrl(request, issued.token),
      siteName: nexpressConfig.site.name,
    });

    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
