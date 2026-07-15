import { listMutes, muteMember } from "@nexpress/core/community";
import {
  npRequireMuteListWire,
  npRequireMuteRequest,
  npRequireOkWire,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireMember } from "../../../../lib/member-auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";

/**
 * Phase 16.1 — self-service mute list.
 *
 *   GET    → the muter's current list, with @handle joined in
 *   POST   → mute a target by id
 *
 * Companion DELETE lives at the per-id route below this one
 * so callers can `DELETE /api/members/me/mutes/<id>` cleanly.
 *
 * Member-only (no anonymous mutes), CSRF on writes.
 */

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const member = await requireMember(request);
    const mutes = await listMutes(member.id);
    return npSuccessResponse(npRequireMuteListWire({ mutes }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { targetId } = npRequireCommunityRequest(
      npRequireMuteRequest,
      await readJsonBody(request),
    );
    await muteMember({ memberId: member.id, targetId });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
