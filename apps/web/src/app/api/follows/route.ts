import { NxValidationError, follow, listFollowing, unfollow } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";
import { requireMember } from "@/lib/member-auth-helpers";

const SUPPORTED = ["member", "thread", "tag"] as const;
type FollowTarget = (typeof SUPPORTED)[number];

function readTarget(raw: unknown): { targetType: FollowTarget; targetId: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const targetType =
    typeof body.targetType === "string" && (SUPPORTED as readonly string[]).includes(body.targetType)
      ? (body.targetType as FollowTarget)
      : null;
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  if (!targetType || !targetId) {
    throw new NxValidationError("Invalid input", [
      { field: "target", message: `targetType (${SUPPORTED.join("|")}) and targetId required` },
    ]);
  }
  return { targetType, targetId };
}

export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    const url = request.nextUrl;
    const targetType = url.searchParams.get("targetType");
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const rows = await listFollowing(member.id, {
      targetType:
        targetType && (SUPPORTED as readonly string[]).includes(targetType)
          ? (targetType as FollowTarget)
          : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    return nxSuccessResponse({ follows: rows });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    const { targetType, targetId } = readTarget(await readJsonBody(request));
    const row = await follow({ followerId: member.id, targetType, targetId });
    return nxSuccessResponse(row, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    const url = request.nextUrl;
    const targetType = url.searchParams.get("targetType");
    const targetId = url.searchParams.get("targetId");
    if (!targetType || !targetId || !(SUPPORTED as readonly string[]).includes(targetType)) {
      throw new NxValidationError("Invalid input", [
        { field: "target", message: "targetType and targetId query params required" },
      ]);
    }
    await unfollow({
      followerId: member.id,
      targetType: targetType as FollowTarget,
      targetId,
    });
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
