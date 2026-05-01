import {
  NxForbiddenError,
  NxValidationError,
  grantMemberRole,
  listMemberRoleGrants,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Member role grants admin API. Read is staff-mod gated (so the
 * member detail page can render the active list); write is
 * admin-only because granting moderation capabilities to a member
 * is a privilege escalation action — editors and staff-mods can
 * already moderate from their own login, they don't get to deputize
 * other accounts.
 */

const VALID_SCOPES = ["site", "category", "collection", "thread"] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface GrantBody {
  memberId?: unknown;
  role?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  expiresAt?: unknown;
}

export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      // `can(user, "content.author")` is NOT the right gate here —
      // it accepts `author` thanks to parallel rank-1 in the
      // hierarchy (see 9.6h memory note). `isStaffMod` is the
      // staff-mod predicate that resolves admin / editor / moderator.
      throw new NxForbiddenError("memberRoleGrants", "list");
    }
    const memberId = request.nextUrl.searchParams.get("memberId");
    if (!memberId) {
      throw new NxValidationError("Invalid input", [
        { field: "memberId", message: "memberId query param required" },
      ]);
    }
    const rows = await listMemberRoleGrants(memberId);
    return nxSuccessResponse({ docs: rows });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("memberRoleGrants", "create");
    }

    const body = (await readJsonBody(request)) as GrantBody | null;
    const memberId = typeof body?.memberId === "string" ? body.memberId : "";
    const role = typeof body?.role === "string" ? body.role : "";
    const scopeTypeRaw = typeof body?.scopeType === "string" ? body.scopeType : "";
    const scopeId = typeof body?.scopeId === "string" ? body.scopeId : null;
    const expiresAtRaw = typeof body?.expiresAt === "string" ? body.expiresAt : null;

    const errors: Array<{ field: string; message: string }> = [];
    if (!memberId) errors.push({ field: "memberId", message: "memberId required" });
    if (!role) errors.push({ field: "role", message: "role required" });
    if (!(VALID_SCOPES as readonly string[]).includes(scopeTypeRaw)) {
      errors.push({
        field: "scopeType",
        message: `scopeType must be one of: ${VALID_SCOPES.join(", ")}`,
      });
    }
    let expiresAt: Date | null = null;
    if (expiresAtRaw) {
      const parsed = new Date(expiresAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        errors.push({
          field: "expiresAt",
          message: "expiresAt must be a valid ISO timestamp",
        });
      } else if (parsed.getTime() <= Date.now()) {
        errors.push({ field: "expiresAt", message: "expiresAt must be in the future" });
      } else {
        expiresAt = parsed;
      }
    }
    if (errors.length > 0) {
      throw new NxValidationError("Invalid input", errors);
    }

    const row = await grantMemberRole({
      memberId,
      role,
      scopeType: scopeTypeRaw as Scope,
      scopeId,
      expiresAt,
      grantedByUserId: user.id,
    });

    return nxSuccessResponse(row, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
