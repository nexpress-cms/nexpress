import {
  NpForbiddenError,
  listUserIdentities,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Lists OAuth identity links for a staff user. Admin role only —
 * identity reveal is sensitive (provider subjects can be used to
 * pivot back to provider accounts).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("user.identities", "list");
    }
    const { id } = await context.params;
    const rows = await listUserIdentities(id);
    return npSuccessResponse({
      identities: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        provider: row.provider,
        providerUserId: row.providerUserId,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
