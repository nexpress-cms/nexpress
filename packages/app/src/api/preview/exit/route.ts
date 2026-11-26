import { npWithAgentGuardianHttpResponseV1 } from "../../../lib/agents/guardian-http-observer";
import { draftMode } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

async function npGuardianGET(request: NextRequest) {
  const draft = await draftMode();
  draft.disable();

  return NextResponse.redirect(new URL("/", request.url));
}

export const GET = npWithAgentGuardianHttpResponseV1("cms", npGuardianGET);
