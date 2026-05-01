import {
  NxValidationError,
  hashPassword,
  invalidateAllMemberSessions,
  nxMembers,
  verifyPassword,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";
import { NextResponse } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { clearMemberAuthCookies, requireMember } from "@/lib/member-auth-helpers";
import { ensureFor } from "@/lib/init-core";

const MIN_PASSWORD_LENGTH = 8;

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const member = await requireMember(request);

    const db = getDb();
    const [row] = await db
      .select({
        id: nxMembers.id,
        handle: nxMembers.handle,
        email: nxMembers.email,
        emailVerified: nxMembers.emailVerified,
        displayName: nxMembers.displayName,
        avatar: nxMembers.avatar,
        bio: nxMembers.bio,
        status: nxMembers.status,
        reputation: nxMembers.reputation,
        createdAt: nxMembers.createdAt,
      })
      .from(nxMembers)
      .where(eq(nxMembers.id, member.id))
      .limit(1);

    if (!row) throw new Error("Member row vanished mid-request");
    return nxSuccessResponse({ member: row });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

interface PatchBody {
  displayName?: string;
  bio?: string | null;
  avatar?: string | null;
  /** Optional password change. Requires `currentPassword`. */
  newPassword?: string;
  currentPassword?: string;
}

function validatePatch(raw: unknown): PatchBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const out: PatchBody = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      throw new NxValidationError("Invalid input", [
        { field: "displayName", message: "Display name must be a non-empty string" },
      ]);
    }
    out.displayName = body.displayName.trim().slice(0, 80);
  }
  if (body.bio !== undefined) {
    out.bio = body.bio === null ? null : typeof body.bio === "string" ? body.bio.slice(0, 500) : null;
  }
  if (body.avatar !== undefined) {
    out.avatar = body.avatar === null ? null : typeof body.avatar === "string" ? body.avatar : null;
  }
  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new NxValidationError("Invalid input", [
        {
          field: "newPassword",
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        },
      ]);
    }
    if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) {
      throw new NxValidationError("Invalid input", [
        { field: "currentPassword", message: "Current password required to change password" },
      ]);
    }
    out.newPassword = body.newPassword;
    out.currentPassword = body.currentPassword;
  }
  return out;
}

export async function PATCH(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const patch = validatePatch(await readJsonBody(request));
    const db = getDb();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.bio !== undefined) updates.bio = patch.bio;
    if (patch.avatar !== undefined) updates.avatar = patch.avatar;

    let mustReauth = false;
    if (patch.newPassword) {
      const [row] = await db
        .select({ password: nxMembers.password })
        .from(nxMembers)
        .where(eq(nxMembers.id, member.id))
        .limit(1);
      if (!row?.password) {
        throw new NxValidationError("Invalid input", [
          { field: "currentPassword", message: "Account has no password set (SSO-only)" },
        ]);
      }
      const ok = await verifyPassword(row.password, patch.currentPassword!);
      if (!ok) {
        throw new NxValidationError("Invalid input", [
          { field: "currentPassword", message: "Current password is incorrect" },
        ]);
      }
      updates.password = await hashPassword(patch.newPassword);
      mustReauth = true;
    }

    if (Object.keys(updates).length === 1) {
      // Only updatedAt — nothing to do.
      return nxSuccessResponse({ ok: true });
    }

    await db.update(nxMembers).set(updates).where(eq(nxMembers.id, member.id));

    if (mustReauth) {
      // Bumps tokenVersion + drops sessions so existing JWTs are
      // invalidated. Caller has to log in again.
      await invalidateAllMemberSessions(db as never, member.id);
      const response = NextResponse.json({ ok: true, mustReauth: true }, { status: 200 });
      clearMemberAuthCookies(response);
      return response;
    }

    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

/**
 * Soft-delete: status='deleted', anonymise display_name + email so the
 * unique constraints don't block the user from re-registering with the
 * same email later. Sessions revoked, password nulled.
 */
export async function DELETE(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const db = getDb();

    await db
      .update(nxMembers)
      .set({
        status: "deleted",
        // Append the id to email + handle so the unique constraints free
        // up the original strings — re-registration with the same email
        // works for the same human if they ever come back.
        email: `deleted+${member.id}@deleted.local`,
        handle: `deleted-${member.id.slice(0, 8)}`,
        displayName: "Deleted member",
        password: null,
        bio: null,
        avatar: null,
        emailVerified: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        emailVerifyTokenHash: null,
        emailVerifyExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(nxMembers.id, member.id));

    await invalidateAllMemberSessions(db as never, member.id);

    const response = NextResponse.json({ ok: true }, { status: 200 });
    clearMemberAuthCookies(response);
    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
