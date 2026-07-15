import { NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import { issueBan, listBansForMember } from "@nexpress/core/community";
import {
  npRequireBanListWire,
  npRequireBanRequest,
  npRequireCommunityId,
  npToBanWireRow,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("bans", "list");
    }

    const memberId = request.nextUrl.searchParams.get("memberId");
    const checkedMemberId = npRequireCommunityRequest(
      (value) => npRequireCommunityId(value, "community.memberId"),
      memberId,
    );

    const rows = await listBansForMember(checkedMemberId);
    return npSuccessResponse(npRequireBanListWire({ docs: rows.map(npToBanWireRow) }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("bans", "create");
    }

    const checked = npRequireCommunityRequest(npRequireBanRequest, await readJsonBody(request));
    const expiresAt = checked.expiresAt === null ? null : new Date(checked.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new NpValidationError("Invalid input", [
        { field: "expiresAt", message: "expiresAt must be in the future" },
      ]);
    }

    const row = await issueBan({
      memberId: checked.memberId,
      scopeType: checked.scopeType,
      scopeId: checked.scopeId,
      kind: checked.kind,
      expiresAt,
      reason: checked.reason,
      actor: { kind: "staff", user },
    });

    return npSuccessResponse(npToBanWireRow(row), { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
