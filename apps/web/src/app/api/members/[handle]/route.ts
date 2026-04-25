import { NxNotFoundError, nxMembers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureCoreServices } from "@/lib/init-core";

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
    ensureCoreServices();
    const { handle } = await params;
    const db = getDb();
    const [member] = await db
      .select({
        id: nxMembers.id,
        handle: nxMembers.handle,
        displayName: nxMembers.displayName,
        avatar: nxMembers.avatar,
        bio: nxMembers.bio,
        status: nxMembers.status,
        reputation: nxMembers.reputation,
        createdAt: nxMembers.createdAt,
      })
      .from(nxMembers)
      .where(eq(nxMembers.handle, handle.toLowerCase()))
      .limit(1);

    if (!member || member.status !== "active") {
      throw new NxNotFoundError("member", handle);
    }

    return nxSuccessResponse({
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
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
