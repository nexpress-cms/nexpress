import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import { grantMemberRole, listMemberRoleGrants } from "@nexpress/core/community";
import {
  npRequireCommunityId,
  npRequireRoleGrantListWire,
  npRequireRoleGrantRequest,
  npToMemberRoleGrantWireRow,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";

/**
 * Member role grants admin API. Read is staff-mod gated (so the
 * member detail page can render the active list); write is
 * admin-only because granting moderation capabilities to a member
 * is a privilege escalation action — editors and staff-mods can
 * already moderate from their own login, they don't get to deputize
 * other accounts.
 */

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      // `can(user, "content.author")` is NOT the right gate here —
      // it accepts `author` thanks to parallel rank-1 in the
      // hierarchy (see 9.6h memory note). `isStaffMod` is the
      // staff-mod predicate that resolves admin / editor / moderator.
      throw new NpForbiddenError("memberRoleGrants", "list");
    }
    const memberId = request.nextUrl.searchParams.get("memberId");
    const checkedMemberId = npRequireCommunityRequest(
      (value) => npRequireCommunityId(value, "community.memberId"),
      memberId,
    );
    const rows = await listMemberRoleGrants(checkedMemberId);
    return npSuccessResponse(
      npRequireRoleGrantListWire({ docs: rows.map(npToMemberRoleGrantWireRow) }),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("memberRoleGrants", "create");
    }

    const checked = npRequireCommunityRequest(
      npRequireRoleGrantRequest,
      await readJsonBody(request),
    );
    const expiresAt = checked.expiresAt === null ? null : new Date(checked.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new NpValidationError("Invalid input", [
        { field: "expiresAt", message: "expiresAt must be in the future" },
      ]);
    }

    const row = await grantMemberRole({
      memberId: checked.memberId,
      role: checked.role,
      scopeType: checked.scopeType,
      scopeId: checked.scopeId,
      expiresAt,
      grantedByUserId: user.id,
    });

    return npSuccessResponse(npToMemberRoleGrantWireRow(row), { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
