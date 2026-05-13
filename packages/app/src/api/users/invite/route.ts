import { randomBytes } from "node:crypto";

import {
  NpForbiddenError,
  NpValidationError,
  createPasswordResetToken,
  enqueueJob,
  hashPassword,
  npUsers,
  runHook,
  type NpUserRole,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { parseBodyRecord } from "../../../lib/collection-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor, nexpressConfig } from "../../../lib/init-core";
import { inviteTtlMs } from "../../../lib/token-ttl";

const VALID_ROLES: readonly NpUserRole[] = [
  "admin",
  "editor",
  "moderator",
  "author",
  "viewer",
];

// Invited users never log in with the placeholder password — they set their
// own via the reset link before the hash is ever verified. Compute one
// unrecoverable Argon2 hash per process and reuse it instead of paying
// ~100ms on every invite for a hash that nobody will ever verify against.
let invitePlaceholderHashPromise: Promise<string> | null = null;
function getInvitePlaceholderHash(): Promise<string> {
  if (!invitePlaceholderHashPromise) {
    invitePlaceholderHashPromise = hashPassword(randomBytes(32).toString("hex"));
  }
  return invitePlaceholderHashPromise;
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
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("users", "create");
    }

    await ensureFor("write");
    const body = parseBodyRecord(await readJsonBody(request));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = typeof body.role === "string" ? (body.role as NpUserRole) : "author";

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
      throw new NpValidationError("Invalid input", errors);
    }

    const db = getDb();
    const hashed = await getInvitePlaceholderHash();

    let created: { id: string; email: string; name: string; role: NpUserRole };
    try {
      const [row] = await db
        .insert(npUsers)
        .values({
          email,
          name,
          password: hashed,
          role,
        })
        .returning({
          id: npUsers.id,
          email: npUsers.email,
          name: npUsers.name,
          role: npUsers.role,
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
        throw new NpValidationError("Invalid input", [
          { field: "email", message: "A user with this email already exists" },
        ]);
      }
      throw error;
    }

    const issued = await createPasswordResetToken(db, {
      userId: created.id,
      purpose: "invite",
      ttlMs: inviteTtlMs,
    });

    await enqueueJob("auth:sendPasswordReset", {
      email: created.email,
      name: created.name,
      token: issued.token,
      purpose: "invite",
      resetUrl: buildResetUrl(request, issued.token),
      siteName: nexpressConfig.site.name,
    });

    await runHook("auth:afterRegister", {
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
      },
      origin: "invite",
    });

    return npSuccessResponse(
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
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
