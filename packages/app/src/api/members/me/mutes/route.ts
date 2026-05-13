import { NpValidationError, listMutes, muteMember } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireMember } from "../../../../lib/member-auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

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
    return npSuccessResponse({ mutes });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const targetId = body.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "targetId", message: "targetId is required" },
      ]);
    }
    await muteMember({ memberId: member.id, targetId });
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
