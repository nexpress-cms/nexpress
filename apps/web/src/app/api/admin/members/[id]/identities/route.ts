import {
  NxForbiddenError,
  listMemberIdentities,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Lists OAuth identity links for a member. Editor-and-up — members'
 * provider subjects are sensitive but the moderation surface needs
 * read access to investigate ban-evasion / linked-account patterns.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("member.identities", "list");
    }
    const { id } = await context.params;
    const rows = await listMemberIdentities(id);
    return nxSuccessResponse({
      identities: rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        provider: row.provider,
        subject: row.subject,
        email: row.email,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
