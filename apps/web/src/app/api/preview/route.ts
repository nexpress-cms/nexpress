import { draftMode } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, NxAuthError } from "@nexpress/core";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const draft = await draftMode();
    draft.enable();

    const redirectTo = request.nextUrl.searchParams.get("path") || "/";
    return NextResponse.redirect(new URL(redirectTo, request.url));
  } catch (err) {
    if (err instanceof NxAuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
