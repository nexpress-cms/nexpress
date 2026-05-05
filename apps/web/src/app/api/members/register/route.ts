import {
  NpForbiddenError,
  NpValidationError,
  createMemberEmailVerifyToken,
  enqueueJob,
  getCommunitySettings,
  hashPassword,
  npMembers,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor, nexpressConfig } from "@/lib/init-core";
import { verifyTtlMs } from "@/lib/token-ttl";

const MIN_PASSWORD_LENGTH = 8;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

interface RegisterBody {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}

function validate(raw: unknown): RegisterBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
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

  if (errors.length > 0) throw new NpValidationError("Invalid input", errors);
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
    await ensureFor("write");

    // Registration gate. Sites that run invite-only flip
    // `community.registrationEnabled` to false in the admin
    // settings page; we surface a 403 here. Existing members can
    // still sign in — the gate is on /register only.
    const settings = await getCommunitySettings();
    if (!settings.registrationEnabled) {
      throw new NpForbiddenError("members", "register");
    }

    const body = validate(await readJsonBody(request));
    const db = getDb();

    const [existingByEmail] = await db
      .select({ id: npMembers.id })
      .from(npMembers)
      .where(eq(npMembers.email, body.email))
      .limit(1);
    const [existingByHandle] = await db
      .select({ id: npMembers.id })
      .from(npMembers)
      .where(eq(npMembers.handle, body.handle))
      .limit(1);

    if (existingByEmail || existingByHandle) {
      // Constant-time-ish: still pretend to enqueue. Caller can't tell
      // a collision from a fresh registration.
      return npSuccessResponse({ ok: true });
    }

    const passwordHash = await hashPassword(body.password);

    let created: { id: string } | undefined;
    try {
      [created] = await db
        .insert(npMembers)
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
        .returning({ id: npMembers.id });
    } catch (err) {
      // Two concurrent registrations for the same email/handle could
      // both pass the preflight select; one insert wins, the other
      // hits a unique violation (Postgres SQLSTATE 23505). Without
      // catching it the loser leaks the collision via a 500.
      // Constant-time anti-enumeration response: same `{ ok: true }`
      // shape as the preflight collision branch. (#51)
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        return npSuccessResponse({ ok: true });
      }
      throw err;
    }

    if (!created) throw new Error("Failed to create member");

    const issued = await createMemberEmailVerifyToken(db, created.id, verifyTtlMs);

    await enqueueJob("members:sendVerifyEmail", {
      email: body.email,
      displayName: body.displayName,
      verifyUrl: buildVerifyUrl(request, issued.token),
      siteName: nexpressConfig.site.name,
    });

    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
