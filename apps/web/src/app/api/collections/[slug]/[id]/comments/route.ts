import { createComment, listComments, memberCan } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";
import { optionalMember, requireMember, requireMemberCsrf } from "@/lib/member-auth-helpers";

/**
 * Comment list + create for documents in any collection. The list
 * endpoint is anonymous-readable (filters to `status='visible'`); the
 * create endpoint needs a member session + CSRF and a collection
 * that opted in via `community.comments=true`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureWriteReady();
    const { slug, id } = await params;
    const member = await optionalMember(request);

    const url = request.nextUrl;
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const order = url.searchParams.get("order") === "oldest" ? "oldest" : "newest";

    // Hidden rows are mod-only. The original guard only checked
    // "is any member logged in?", which leaked hidden/deleted/pending
    // rows to ordinary members (#46). Now we require an actual
    // `restore-comment` capability in the collection scope, the same
    // permission a mod needs to un-hide a comment.
    let includeHidden = false;
    if (url.searchParams.get("includeHidden") === "1" && member) {
      includeHidden = await memberCan(member.id, "restore-comment", {
        type: "comment-list",
        id,
        scopes: [{ type: "collection", id: slug }],
      });
    }

    const result = await listComments(slug, id, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      order,
      includeHidden,
    });
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    requireMemberCsrf(request);

    const { slug, id } = await params;
    const body = (await readJsonBody(request)) as
      | { bodyMd?: unknown; parentId?: unknown }
      | null;
    const bodyMd = typeof body?.bodyMd === "string" ? body.bodyMd : "";
    const parentId =
      typeof body?.parentId === "string" && body.parentId.length > 0 ? body.parentId : null;

    const created = await createComment({
      targetType: slug,
      targetId: id,
      memberId: member.id,
      parentId,
      bodyMd,
    });
    return nxSuccessResponse(created, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
