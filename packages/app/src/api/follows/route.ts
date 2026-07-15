import { NpValidationError } from "@nexpress/core";
import { follow, listFollowing, unfollow } from "@nexpress/core/community";
import {
  npCommunityFollowTargets,
  npRequireFollowListWire,
  npRequireFollowTarget,
  npRequireOkWire,
  npToFollowWireRow,
  type NpFollowTarget,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { npReadCommunityWindow, npRequireCommunityRequest } from "../../lib/community-contract";
import { requireMember } from "../../lib/member-auth-helpers";

const SUPPORTED = npCommunityFollowTargets;
type FollowTarget = NpFollowTarget;

function readTarget(raw: unknown) {
  return npRequireCommunityRequest(npRequireFollowTarget, raw);
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const url = request.nextUrl;
    const targetType = url.searchParams.get("targetType");
    const { limit, offset } = npReadCommunityWindow(url.searchParams);
    if (targetType !== null && !(SUPPORTED as readonly string[]).includes(targetType)) {
      throw new NpValidationError("Invalid input", [
        { field: "targetType", message: `Must be one of: ${SUPPORTED.join(", ")}` },
      ]);
    }
    const rows = await listFollowing(member.id, {
      targetType:
        targetType && (SUPPORTED as readonly string[]).includes(targetType)
          ? (targetType as FollowTarget)
          : undefined,
      limit,
      offset,
    });
    return npSuccessResponse(npRequireFollowListWire({ follows: rows.map(npToFollowWireRow) }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { targetType, targetId } = readTarget(await readJsonBody(request));
    const row = await follow({ followerId: member.id, targetType, targetId });
    return npSuccessResponse(npToFollowWireRow(row), { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const url = request.nextUrl;
    const targetType = url.searchParams.get("targetType");
    const targetId = url.searchParams.get("targetId");
    if (!targetType || !targetId || !(SUPPORTED as readonly string[]).includes(targetType)) {
      throw new NpValidationError("Invalid input", [
        { field: "target", message: "targetType and targetId query params required" },
      ]);
    }
    await unfollow({
      followerId: member.id,
      targetType: targetType as FollowTarget,
      targetId,
    });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
