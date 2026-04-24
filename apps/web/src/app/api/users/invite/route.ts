import { randomBytes } from "node:crypto";

import {
  NxForbiddenError,
  NxValidationError,
  createPasswordResetToken,
  enqueueJob,
  hasRole,
  hashPassword,
  nxUsers,
  type NxUserRole,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

const VALID_ROLES: readonly NxUserRole[] = ["admin", "editor", "author", "viewer"];

// 7 days to complete initial password setup.
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function buildResetUrl(request: NextRequest, token: string): string {
  const configured = process.env.SITE_URL;
  const base = configured ? new URL(configured) : new URL(request.url);
  const url = new URL("/admin/set-password", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("users", "create");
    }

    await ensureWriteReady();
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = typeof body.role === "string" ? (body.role as NxUserRole) : "author";

    const errors: Array<{ field: string; message: string }> = [];
    if (!email || !email.includes("@")) {
      errors.push({ field: "email", message: "Valid email is required" });
    }
    if (!name) {
      errors.push({ field: "name", message: "Name is required" });
    }
    if (!VALID_ROLES.includes(role)) {
      errors.push({ field: "role", message: `Role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    if (errors.length > 0) {
      throw new NxValidationError("Invalid input", errors);
    }

    const db = getDb();
    // Placeholder password — the invitee overwrites it via the reset link. Use
    // argon2 over a throwaway secret so the column constraint holds without
    // leaving a guessable hash.
    const placeholder = randomBytes(32).toString("hex");
    const hashed = await hashPassword(placeholder);

    let created: { id: string; email: string; name: string; role: NxUserRole };
    try {
      const [row] = await db
        .insert(nxUsers)
        .values({
          email,
          name,
          password: hashed,
          role,
        })
        .returning({
          id: nxUsers.id,
          email: nxUsers.email,
          name: nxUsers.name,
          role: nxUsers.role,
        });

      if (!row) {
        throw new Error("Failed to create invited user.");
      }
      created = row;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new NxValidationError("Invalid input", [
          { field: "email", message: "A user with this email already exists" },
        ]);
      }
      throw error;
    }

    const issued = await createPasswordResetToken(db, {
      userId: created.id,
      purpose: "invite",
      ttlMs: INVITE_TTL_MS,
    });

    await enqueueJob("auth:sendPasswordReset", {
      email: created.email,
      name: created.name,
      token: issued.token,
      purpose: "invite",
      resetUrl: buildResetUrl(request, issued.token),
    });

    return nxSuccessResponse(
      {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        inviteExpiresAt: issued.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
