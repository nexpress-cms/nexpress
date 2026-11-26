import { npWithAgentGuardianHttpResponseV1 } from "../../../lib/agents/guardian-http-observer";
import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  getCurrentSiteId,
  getTheme,
  setTheme,
  can,
} from "@nexpress/core";
import { bustThemeCache, readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";

async function npGuardianGET(_request: NextRequest) {
  try {
    return npSuccessResponse(await getTheme());
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

async function npGuardianPUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings/theme", "update");
    }

    const theme = await readJsonBody(request);

    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    await setTheme(theme, user);

    // Phase 14.3 — site-scoped tag matches the cache helpers in
    // `@nexpress/next`. `bustThemeCache` also forwards the same
    // hints to any configured CDN purge adapter.
    await bustThemeCache(siteId);

    return npSuccessResponse(theme);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };

export const GET = npWithAgentGuardianHttpResponseV1("cms", npGuardianGET);
export const PUT = npWithAgentGuardianHttpResponseV1("cms", npGuardianPUT);
