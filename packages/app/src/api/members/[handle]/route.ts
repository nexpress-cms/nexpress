import { NpNotFoundError, npMembers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

/**
 * Public profile read. Returns the columns safe for unauthenticated
 * eyes — no email, no internal flags. Inactive (pending / suspended /
 * deleted) members 404 so non-existent and not-yet-verified handles
 * look identical to the outside.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    await ensureFor("read");
    const { handle } = await params;
    const db = getDb();
    const [member] = await db
      .select({
        id: npMembers.id,
        handle: npMembers.handle,
        displayName: npMembers.displayName,
        avatar: npMembers.avatar,
        bio: npMembers.bio,
        status: npMembers.status,
        reputation: npMembers.reputation,
        createdAt: npMembers.createdAt,
      })
      .from(npMembers)
      .where(eq(npMembers.handle, handle.toLowerCase()))
      .limit(1);

    if (!member || member.status !== "active") {
      throw new NpNotFoundError("member", handle);
    }

    return npSuccessResponse({
      member: {
        handle: member.handle,
        displayName: member.displayName,
        avatar: member.avatar,
        bio: member.bio,
        reputation: member.reputation,
        createdAt: member.createdAt,
      },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
