import {
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  getOptionalJobQueue,
  getPluginConfig,
  getPluginRegistration,
  getPluginState,
  updatePluginState,
  type NpPluginScheduleStats,
  type NpPluginStateUpdate,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth, requireGlobalAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { parseBodyRecord } from "../../../lib/collection-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";

interface ScheduleDetail {
  taskId: string;
  cron: string;
  description: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  completedCount: number;
  failedCount: number;
  windowDays: number;
}

/**
 * Joins the registry's static schedule list with the queue's per-(pluginId,
 * taskId) execution history. Falls back gracefully when no queue is wired or
 * the adapter doesn't implement `getPluginScheduleStats` (e.g. test stubs):
 * we still return the registered schedules so the admin UI can render the
 * cadence even without history.
 */
async function buildScheduleDetails(pluginId: string): Promise<ScheduleDetail[]> {
  const reg = getPluginRegistration(pluginId);
  if (!reg) return [];
  const schedules = [...reg.schedules.values()];
  if (schedules.length === 0) return [];

  const queue = getOptionalJobQueue();
  let statsByTask = new Map<string, NpPluginScheduleStats>();
  if (queue && typeof queue.getPluginScheduleStats === "function") {
    try {
      const stats = await queue.getPluginScheduleStats(pluginId);
      statsByTask = new Map(stats.map((s) => [s.taskId, s] as const));
    } catch {
      // History query failure should not 500 the detail endpoint — we'd
      // rather show "no history" than break the whole page. Pg-boss errors
      // here typically mean the schema isn't installed yet.
    }
  }

  return schedules
    .map((schedule) => {
      const stats = statsByTask.get(schedule.taskId);
      return {
        taskId: schedule.taskId,
        cron: schedule.cron,
        description: schedule.description ?? null,
        lastRunAt: stats?.lastRunAt ?? null,
        lastSuccessAt: stats?.lastSuccessAt ?? null,
        lastFailureAt: stats?.lastFailureAt ?? null,
        completedCount: stats?.completedCount ?? 0,
        failedCount: stats?.failedCount ?? 0,
        windowDays: stats?.windowDays ?? 7,
      };
    })
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
}

async function toDetail(state: {
  id: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
}) {
  const reg = getPluginRegistration(state.id);
  const schedules = await buildScheduleDetails(state.id);
  // G.1 — config moved to np_settings; read it through the new
  // service so the response shape (config field) stays the same
  // for callers (admin detail page, internal scripts).
  const config = (await getPluginConfig(state.id)) ?? {};
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
    schedules,
    enabled: state.enabled,
    config,
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
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins", "read");
    }

    await ensureFor("plugins");
    const { pluginId } = await params;
    const state = await getPluginState(getDb(), pluginId);
    if (!state) {
      throw new NpNotFoundError("plugin", pluginId);
    }

    return npSuccessResponse(await toDetail(state));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  try {
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins", "update");
    }

    const { pluginId } = await params;
    const body = parseBodyRecord(await readJsonBody(request));
    const patch: NpPluginStateUpdate = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        throw new NpValidationError("Invalid input", [
          { field: "enabled", message: "Must be a boolean" },
        ]);
      }
      patch.enabled = body.enabled;
    }

    if (body.config !== undefined) {
      // G.1 — plugin config writes moved to a dedicated route
      // (`PUT /api/admin/plugins/[id]/config`) so they can flow
      // through `setPluginConfig` (zod validation + envelope wrap +
      // `np:plugin:<id>` cache invalidation). This route now only
      // toggles the enable flag; reject `config` patches with a
      // pointer to the new endpoint so callers update sooner.
      throw new NpValidationError("Invalid input", [
        {
          field: "config",
          message: "Plugin config writes moved to PUT /api/admin/plugins/<id>/config (G.1)",
        },
      ]);
    }

    if (patch.enabled === undefined) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Provide enabled to update" },
      ]);
    }

    await ensureFor("plugins");
    const updated = await updatePluginState(getDb(), pluginId, patch);
    if (!updated) {
      throw new NpNotFoundError("plugin", pluginId);
    }

    return npSuccessResponse(await toDetail(updated));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
