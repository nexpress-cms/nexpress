import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getOptionalJobQueue,
  getPluginAdminExtension,
  getPluginRegistration,
  getPluginState,
  verifyTokenFull,
  can,
  type NpPluginScheduleStats,
} from "@nexpress/core";
import { PluginAdminPage } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ pluginId: string }>;
}

export default async function PluginAdminRoute({ params }: PageProps) {
  await ensureFor("plugins");

  const token = (await cookies()).get("np-session")?.value;
  const { secret } = getAuthRuntimeConfig();
  const user = token ? await verifyTokenFull(token, secret, getDb()) : null;
  if (!user || !can(user, "admin.manage")) {
    notFound();
  }

  const { pluginId } = await params;
  const registration = getPluginRegistration(pluginId);
  const adminExt = getPluginAdminExtension(pluginId);
  const state = await getPluginState(getDb(), pluginId);

  if (!registration || !adminExt) {
    notFound();
  }

  // Phase 4.2 — overlay queue history on top of the registry's static
  // schedule list. Pulled in the server component so the client gets
  // pre-rendered data on first paint and can re-fetch via the API on
  // demand (e.g. after a "Run now" click).
  const registeredSchedules = [...registration.schedules.values()];
  let scheduleStats = new Map<string, NpPluginScheduleStats>();
  if (registeredSchedules.length > 0) {
    const queue = getOptionalJobQueue();
    if (queue && typeof queue.getPluginScheduleStats === "function") {
      try {
        const stats = await queue.getPluginScheduleStats(pluginId);
        scheduleStats = new Map(stats.map((s) => [s.taskId, s] as const));
      } catch {
        // Queue not ready / pg-boss schema missing — fall through with
        // empty stats so the registered schedules still render.
      }
    }
  }
  const schedules = registeredSchedules
    .map((s) => {
      const stats = scheduleStats.get(s.taskId);
      return {
        taskId: s.taskId,
        cron: s.cron,
        description: s.description ?? null,
        lastRunAt: stats?.lastRunAt ?? null,
        lastSuccessAt: stats?.lastSuccessAt ?? null,
        lastFailureAt: stats?.lastFailureAt ?? null,
        completedCount: stats?.completedCount ?? 0,
        failedCount: stats?.failedCount ?? 0,
        windowDays: stats?.windowDays ?? 7,
      };
    })
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  return (
    <PluginAdminPage
      pluginId={pluginId}
      pluginName={registration.name}
      admin={adminExt}
      initialConfig={state?.config ?? {}}
      schedules={schedules}
    />
  );
}
