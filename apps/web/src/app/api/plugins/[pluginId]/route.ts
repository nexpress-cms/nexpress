import {
  NxForbiddenError,
  NxNotFoundError,
  NxValidationError,
  getPluginRegistration,
  getPluginState,
  hasRole,
  updatePluginState,
  type NxPluginStateUpdate,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { parseBodyRecord } from "@/lib/collection-helpers";
import { getDb } from "@/lib/db";
import { ensurePluginsLoaded } from "@/lib/init-core";

function toDetail(state: {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}) {
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
    admin: reg?.admin ?? null,
    enabled: state.enabled,
    config: state.config,
    installedAt: state.installedAt,
    updatedAt: state.updatedAt,
    loaded: reg !== undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  try {
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("plugins", "read");
    }

    await ensurePluginsLoaded();
    const { pluginId } = await params;
    const state = await getPluginState(getDb(), pluginId);
    if (!state) {
      throw new NxNotFoundError("plugin", pluginId);
    }

    return nxSuccessResponse(toDetail(state));
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  try {
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("plugins", "update");
    }


    const { pluginId } = await params;
    const body = parseBodyRecord(await readJsonBody(request));
    const patch: NxPluginStateUpdate = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        throw new NxValidationError("Invalid input", [
          { field: "enabled", message: "Must be a boolean" },
        ]);
      }
      patch.enabled = body.enabled;
    }

    if (body.config !== undefined) {
      if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
        throw new NxValidationError("Invalid input", [
          { field: "config", message: "Must be a JSON object" },
        ]);
      }
      patch.config = body.config as Record<string, unknown>;
    }

    if (patch.enabled === undefined && patch.config === undefined) {
      throw new NxValidationError("Invalid input", [
        { field: "body", message: "Provide enabled or config to update" },
      ]);
    }

    await ensurePluginsLoaded();
    const updated = await updatePluginState(getDb(), pluginId, patch);
    if (!updated) {
      throw new NxNotFoundError("plugin", pluginId);
    }

    return nxSuccessResponse(toDetail(updated));
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
