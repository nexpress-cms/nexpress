import {
  NpForbiddenError,
  getPluginRegistration,
  listPluginStates,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins", "read");
    }

    await ensureFor("plugins");
    const states = await listPluginStates(getDb());

    const items = states
      .map((state) => {
        const reg = getPluginRegistration(state.id);
        return {
          id: state.id,
          name: reg?.name ?? state.id,
          version: reg?.version ?? null,
          description: reg?.description ?? null,
          capabilities: reg ? [...reg.capabilities].sort() : [],
          hooks: reg ? [...reg.hooks.keys()].sort() : [],
          routes: reg
            ? reg.routes.map((route) => ({
                method: route.method.toUpperCase(),
                path: route.path,
              }))
            : [],
          hasAdmin: reg?.admin !== undefined,
          enabled: state.enabled,
          config: state.config,
          installedAt: state.installedAt,
          updatedAt: state.updatedAt,
          loaded: reg !== undefined,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    return npSuccessResponse({ items });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
