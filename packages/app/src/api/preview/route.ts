import { draftMode } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, NpForbiddenError } from "@nexpress/core";
import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";

// `new URL(redirectTo, request.url)` preserves an external origin when
// `redirectTo` is absolute or protocol-relative, so an editor with
// `content.publish` could be bounced from the trusted admin to an
// attacker-controlled domain. Constrain the input to a same-origin
// pathname (must start with a single `/`, and not `//` or `/\`).
function sanitizeRedirectPath(raw: string | null): string {
  if (!raw) return "/";
  if (raw.length < 2 || raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("preview", "enable");
    }

    const draft = await draftMode();
    draft.enable();

    const redirectTo = sanitizeRedirectPath(request.nextUrl.searchParams.get("path"));
    return NextResponse.redirect(new URL(redirectTo, request.url));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
