import {
  addReaction,
  countReactions,
  listMemberReactions,
  removeReaction,
} from "@nexpress/core/community";
import {
  npRequireOkWire,
  npRequireReactionSummaryWire,
  npRequireReactionTarget,
  npToReactionWireRow,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { npRequireCommunityRequest } from "../../lib/community-contract";
import { optionalMember, requireMember } from "../../lib/member-auth-helpers";

/**
 * Polymorphic reactions over comments and collection documents that enable
 * `community.reactions`. The DELETE leg uses query parameters so the same
 * path can both add and remove without hard-coupling the wire shape to a row id.
 */

function readTargetFromQuery(request: NextRequest) {
  const url = request.nextUrl;
  return npRequireCommunityRequest(npRequireReactionTarget, {
    targetType: url.searchParams.get("targetType"),
    targetId: url.searchParams.get("targetId"),
    ...(url.searchParams.has("kind") ? { kind: url.searchParams.get("kind") } : {}),
  });
}

/**
 * GET — public-readable reaction summary for a target. Returns
 * `{ counts: { like: 12 }, mine: ["like"] | [] }`. The `mine`
 * field is only populated when a member is authenticated.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const target = readTargetFromQuery(request);
    const member = await optionalMember(request);
    const counts = await countReactions(target.targetType, target.targetId, {
      ...(member ? { viewerMemberId: member.id } : {}),
    });
    const mine = member
      ? await listMemberReactions(target.targetType, target.targetId, member.id)
      : [];
    return npSuccessResponse(npRequireReactionSummaryWire({ counts, mine }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const target = npRequireCommunityRequest(npRequireReactionTarget, await readJsonBody(request));
    const row = await addReaction({
      targetType: target.targetType,
      targetId: target.targetId,
      memberId: member.id,
      kind: target.kind,
    });
    return npSuccessResponse(npToReactionWireRow(row), { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const target = readTargetFromQuery(request);
    await removeReaction({
      targetType: target.targetType,
      targetId: target.targetId,
      memberId: member.id,
      kind: target.kind,
    });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
