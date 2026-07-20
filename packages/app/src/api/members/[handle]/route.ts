import { getMemberProfile, npToPublicMemberProfileWire } from "@nexpress/core/community";
import { NpNotFoundError } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";

/** Exact PII-free public profile read shared with `/u/:handle`. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    await ensureFor("read");
    const { handle } = await params;
    const member = await getMemberProfile(handle, { avatarVariant: "small" });
    if (!member) throw new NpNotFoundError("member", handle);
    return npSuccessResponse(npToPublicMemberProfileWire(member));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
