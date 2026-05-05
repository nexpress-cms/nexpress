import {
  NpValidationError,
  addReaction,
  assertReactableExists,
  countReactions,
  listMemberReactions,
  removeReaction,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";
import {
  optionalMember,
  requireMember,
} from "@/lib/member-auth-helpers";

/**
 * Polymorphic reactions over the community surface. v1 supports
 * `targetType: "comment"` only. The DELETE leg uses `?targetType=…&
 * targetId=…&kind=…` query params so the same path can both add and
 * remove without hard-coupling the wire shape to a per-row id.
 */

interface ReactionTarget {
  targetType: string;
  targetId: string;
  kind: string;
}

function readTargetFromBody(raw: unknown): ReactionTarget {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const targetType = typeof body.targetType === "string" ? body.targetType : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const kind = typeof body.kind === "string" ? body.kind : "like";
  if (!targetType || !targetId) {
    throw new NpValidationError("Invalid input", [
      { field: "target", message: "targetType and targetId required" },
    ]);
  }
  return { targetType, targetId, kind };
}

function readTargetFromQuery(request: NextRequest): ReactionTarget {
  const url = request.nextUrl;
  const targetType = url.searchParams.get("targetType") ?? "";
  const targetId = url.searchParams.get("targetId") ?? "";
  const kind = url.searchParams.get("kind") ?? "like";
  if (!targetType || !targetId) {
    throw new NpValidationError("Invalid input", [
      { field: "target", message: "targetType and targetId query params required" },
    ]);
  }
  return { targetType, targetId, kind };
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
    const counts = await countReactions(target.targetType, target.targetId);
    const member = await optionalMember(request);
    const mine = member
      ? await listMemberReactions(target.targetType, target.targetId, member.id)
      : [];
    return npSuccessResponse({ counts, mine });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const target = readTargetFromBody(await readJsonBody(request));
    await assertReactableExists(target.targetType, target.targetId);
    const row = await addReaction({
      targetType: target.targetType,
      targetId: target.targetId,
      memberId: member.id,
      kind: target.kind,
    });
    return npSuccessResponse(row, { status: 201 });
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
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
